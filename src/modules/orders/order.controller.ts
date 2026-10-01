import Busboy from "busboy";
import { Request, Response, NextFunction } from "express";
import { ApiResponse } from "../../utils/api-response.js";
import {
  EXPECTED_CSV_COLUMNS,
  OrderProcessingSummary,
} from "./order.schema.js";
import { orderService, OrderService } from "./order.service.js";

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export class OrderController {
  private readonly orderService: OrderService;

  constructor(service: OrderService = orderService) {
    this.orderService = service;
  }

  public uploadOrders = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const contentType = req.headers["content-type"];
    if (!contentType || !contentType.includes("multipart/form-data")) {
      ApiResponse.error(
        res,
        "Invalid Content-Type. Expected multipart/form-data.",
        400,
      );
      return;
    }

    let fileFound = false;
    let responseSent = false;
    let processingPromise: Promise<OrderProcessingSummary> | null = null;

    try {
      const bb = Busboy({
        headers: req.headers,
        limits: {
          files: 1,
        },
      });

      bb.on("file", (fieldname, fileStream, info) => {
        const { filename, mimeType } = info;
        fileFound = true;

        // 1. Validate file field name
        if (fieldname !== "file") {
          fileStream.resume();
          if (!responseSent) {
            responseSent = true;
            ApiResponse.error(
              res,
              `Invalid file field name "${fieldname}". The field name must be "file".`,
              400,
            );
          }
          return;
        }

        // 2. Validate file extension
        const lowerFilename = filename.toLowerCase();
        if (!lowerFilename.endsWith(".csv")) {
          fileStream.resume();
          if (!responseSent) {
            responseSent = true;
            ApiResponse.error(res, "Only CSV files are allowed", 400, {
              receivedFile: filename,
            });
          }
          return;
        }

        // 3. Validate MIME type where possible
        const allowedMimeTypes = [
          "text/csv",
          "text/plain",
          "application/csv",
          "application/x-csv",
          "text/x-csv",
          "text/comma-separated-values",
          "application/vnd.ms-excel",
          "application/octet-stream",
        ];

        if (mimeType && !allowedMimeTypes.includes(mimeType.toLowerCase())) {
          fileStream.resume();
          if (!responseSent) {
            responseSent = true;
            ApiResponse.error(
              res,
              "Only CSV files are allowed (invalid MIME type)",
              400,
              { receivedMimeType: mimeType },
            );
          }
          return;
        }

        // 4. Stream file directly into OrderService
        processingPromise =
          this.orderService.processOrdersCsvStream(fileStream);
      });

      bb.on("finish", async () => {
        if (responseSent) return;

        if (!fileFound || !processingPromise) {
          responseSent = true;
          ApiResponse.error(
            res,
            "No file provided. Please attach a CSV file under the field 'file'.",
            400,
          );
          return;
        }

        try {
          const summary = await processingPromise;
          responseSent = true;
          ApiResponse.success(res, summary, 200);
        } catch (err: any) {
          responseSent = true;
          const errorMessage = err?.message || "Error processing CSV file";

          if (
            errorMessage.includes("column") ||
            errorMessage.includes("header") ||
            errorMessage.includes("CSV")
          ) {
            ApiResponse.error(res, "Invalid CSV header", 400, {
              details: errorMessage,
              expectedColumns: EXPECTED_CSV_COLUMNS,
            });
            return;
          }

          console.error("CSV Processing Error:", err);
          ApiResponse.error(res, "Internal Server Error", 500, {
            message: errorMessage,
          });
        }
      });

      bb.on("error", (err: any) => {
        if (!responseSent) {
          responseSent = true;
          console.error("Busboy Upload Error:", err);
          ApiResponse.error(res, "Upload Error", 400, {
            message: err.message || "Failed to process multipart upload",
          });
        }
      });

      req.pipe(bb);
    } catch (err) {
      next(err);
    }
  };

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
