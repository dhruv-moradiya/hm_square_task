import Busboy from "busboy";
import { Readable } from "node:stream";
import { Request, Response, NextFunction } from "express";
import { ApiResponse } from "../../utils/api-response.js";
import { logger } from "../../config/logger.js";
import { EXPECTED_CSV_COLUMNS } from "./order.schema.js";
import { orderService, OrderService } from "./order.service.js";

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const ALLOWED_MIME_TYPES = new Set([
  "text/csv",
  "text/plain",
  "application/csv",
  "application/x-csv",
  "text/x-csv",
  "text/comma-separated-values",
  "application/vnd.ms-excel",
  "application/octet-stream",
]);

interface MultipartFilePayload {
  fileStream: Readable;
  filename: string;
  mimeType?: string;
}

export class OrderController {
  private readonly orderService: OrderService;

  constructor(service: OrderService = orderService) {
    this.orderService = service;
  }

  public uploadOrders = async (
    req: Request,
    res: Response,
    _next: NextFunction,
  ): Promise<void> => {
    const requestId =
      (req as any).id ||
      (req.headers["x-request-id"] as string) ||
      "req-unknown";
    const uploadStartTime = Date.now();

    try {
      const { fileStream, filename, mimeType } =
        await this.parseMultipartUpload(req, requestId);

      const summary = await this.orderService.ingestOrdersFile(fileStream, {
        filename,
        mimeType,
        requestId,
      });

      const durationMs = Date.now() - uploadStartTime;
      logger.info(
        {
          requestId,
          filename,
          totalRows: summary.totalRows,
          validRows: summary.validRows,
          invalidRows: summary.invalidRows,
          insertedRows: summary.insertedRows,
          duplicateRows: summary.duplicateRows,
          gcs_uploaded: summary.gcs_uploaded,
          durationMs,
        },
        "upload completed",
      );

      ApiResponse.success(res, summary, 200);
    } catch (err: any) {
      this.handleUploadError(res, err, requestId);
    }
  };

  private parseMultipartUpload(
    req: Request,
    requestId: string,
  ): Promise<MultipartFilePayload> {
    return new Promise((resolve, reject) => {
      const contentType = req.headers["content-type"];
      if (!contentType || !contentType.includes("multipart/form-data")) {
        return reject({
          statusCode: 400,
          message: "Invalid Content-Type. Expected multipart/form-data.",
        });
      }

      let fileFound = false;
      let payload: MultipartFilePayload | null = null;

      const bb = Busboy({
        headers: req.headers,
        limits: { files: 1 },
      });

      bb.on("file", (fieldname, fileStream, info) => {
        fileFound = true;
        const { filename, mimeType } = info;

        if (fieldname !== "file") {
          fileStream.resume();
          return reject({
            statusCode: 400,
            message: `Invalid file field name "${fieldname}". The field name must be "file".`,
          });
        }

        if (!filename.toLowerCase().endsWith(".csv")) {
          fileStream.resume();
          return reject({
            statusCode: 400,
            message: "Only CSV files are allowed",
            details: { receivedFile: filename },
          });
        }

        if (mimeType && !ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())) {
          fileStream.resume();
          return reject({
            statusCode: 400,
            message: "Only CSV files are allowed (invalid MIME type)",
            details: { receivedMimeType: mimeType },
          });
        }

        logger.info({ requestId, filename }, "upload started");
        payload = { fileStream, filename, mimeType };
        resolve(payload);
      });

      bb.on("finish", () => {
        if (!fileFound || !payload) {
          reject({
            statusCode: 400,
            message:
              "No file provided. Please attach a CSV file under the field 'file'.",
          });
        }
      });

      bb.on("error", (err: any) => {
        reject({
          statusCode: 400,
          message: err.message || "Failed to process multipart upload",
        });
      });

      req.pipe(bb);
    });
  }

  private handleUploadError(res: Response, err: any, requestId: string): void {
    logger.error({ err, requestId }, "Upload failed");

    if (err?.statusCode) {
      ApiResponse.error(res, err.message, err.statusCode, err.details);
      return;
    }

    const message = err?.message || "Error processing CSV file";

    if (
      message.includes("Missing required column") ||
      message.includes("Unexpected extra column") ||
      message.includes("duplicate column headers") ||
      message.includes("header is empty or missing") ||
      message.includes("Invalid CSV header")
    ) {
      ApiResponse.error(res, "Invalid CSV header", 400, {
        details: message,
        expectedColumns: EXPECTED_CSV_COLUMNS,
      });
      return;
    }

    ApiResponse.error(res, "Internal Server Error", 500, { message });
  }

  public getOrders = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { customerId, limit, offset } = req.query;

      if (
        !customerId ||
        typeof customerId !== "string" ||
        customerId.trim().length === 0
      ) {
        ApiResponse.error(
          res,
          "Query parameter 'customerId' is required (e.g. /orders?customerId=CUST001)",
          400,
        );
        return;
      }

      const parsedLimit = limit
        ? Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 500)
        : 50;
      const parsedOffset = offset
        ? Math.max(parseInt(String(offset), 10) || 0, 0)
        : 0;

      const result = await this.orderService.getOrdersByCustomerId(
        customerId.trim(),
        parsedLimit,
        parsedOffset,
      );

      ApiResponse.success(res, result, 200);
    } catch (err) {
      next(err);
    }
  };

  public getOrderById = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const orderIdParam = req.params.orderId;
      const orderId = Array.isArray(orderIdParam)
        ? orderIdParam[0]
        : orderIdParam;

      if (!orderId) {
        ApiResponse.error(res, "Parameter 'orderId' is required", 400);
        return;
      }

      if (!UUID_REGEX.test(orderId)) {
        ApiResponse.error(
          res,
          "Invalid orderId format. Must be a valid UUID (e.g. 550e8400-e29b-41d4-a716-446655440000)",
          400,
        );
        return;
      }

      const result = await this.orderService.getOrderByOrderId(orderId);
      if (!result) {
        ApiResponse.error(
          res,
          `Order not found for orderId "${orderId}"`,
          404,
          { orderId },
        );
        return;
      }

      ApiResponse.success(res, result, 200);
    } catch (err) {
      next(err);
    }
  };
}

export const orderController = new OrderController();
