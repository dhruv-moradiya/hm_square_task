import * as fastCsv from "@fast-csv/parse";
import { Readable } from "node:stream";
import {
  OrderProcessingSummary,
  RawCsvOrderRow,
  RowValidationError,
  ValidOrder,
} from "../../modules/orders/order.schema.js";
import { OrderValidator } from "../../modules/orders/order.validator.js";

export type BatchProcessor = (batch: ValidOrder[]) => Promise<{
  insertedCount: number;
  duplicateCount: number;
}>;

export interface CsvStreamOptions {
  batchSize?: number;
  maxErrorDetails?: number;
}

export class CsvParserService {
  public async processCsvStream(
    inputStream: Readable,
    processBatch: BatchProcessor,
    options: CsvStreamOptions = {},
  ): Promise<OrderProcessingSummary> {
    const batchSize = options.batchSize || 500;
    const maxErrorDetails = options.maxErrorDetails || 100;

    let totalRows = 0;
    let validRows = 0;
    let invalidRows = 0;
    let insertedRows = 0;
    let duplicateRows = 0;
    const validationErrors: RowValidationError[] = [];

    let currentBatch: ValidOrder[] = [];
    let headerValidated = false;

    return new Promise<OrderProcessingSummary>((resolve, reject) => {
      let isProcessingBatch = false;
      let streamEnded = false;
      let isAborted = false;

      const csvStream = fastCsv
        .parse({
          headers: true,
          ignoreEmpty: true,
          trim: true,
          discardUnmappedColumns: false,
        })
        .on("headers", (headers: string[]) => {
          const headerCheck = OrderValidator.validateHeaders(headers);
          if (!headerCheck.isValid) {
            isAborted = true;
            csvStream.destroy(
              new Error(headerCheck.error || "Invalid CSV header"),
            );
          } else {
            headerValidated = true;
          }
        })
        .on("data", async (row: RawCsvOrderRow) => {
          if (isAborted) return;
          totalRows++;

          // Validate row data
          const validation = OrderValidator.validateRow(row);
          if (!validation.isValid || !validation.order) {
            invalidRows++;
            if (validationErrors.length < maxErrorDetails) {
              validationErrors.push({
                row: totalRows,
                errors: validation.errors,
              });
            }
            return;
          }

          validRows++;
          currentBatch.push(validation.order);

          // If batch is full, pause stream to handle backpressure and insert
          if (currentBatch.length >= batchSize) {
            csvStream.pause();
            isProcessingBatch = true;

            const batchToInsert = currentBatch;
            currentBatch = [];

            try {
              const res = await processBatch(batchToInsert);
              insertedRows += res.insertedCount;
              duplicateRows += res.duplicateCount;
            } catch (err) {
              isAborted = true;
              csvStream.destroy(
                err instanceof Error ? err : new Error(String(err)),
              );
              return;
            } finally {
              isProcessingBatch = false;
              if (!isAborted) {
                if (streamEnded) {
                  finalize();
                } else {
                  csvStream.resume();
                }
              }
            }
          }
        })
        .on("error", (error: Error) => {
          isAborted = true;
          reject(error);
        })
        .on("end", async () => {
          streamEnded = true;
          if (!headerValidated && totalRows === 0 && !isAborted) {
            reject(new Error("CSV file is empty or missing valid headers"));
            return;
          }

          if (!isProcessingBatch && !isAborted) {
            await finalize();
          }
        });

      async function finalize() {
        if (isAborted) return;

        // Process any remaining rows in the final batch
        if (currentBatch.length > 0) {
          const finalBatch = currentBatch;
          currentBatch = [];
          try {
            const res = await processBatch(finalBatch);
            insertedRows += res.insertedCount;
            duplicateRows += res.duplicateCount;
          } catch (err) {
            isAborted = true;
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
          }
        }

        resolve({
          message: "Orders file processed successfully",
          totalRows,
          validRows,
          invalidRows,
          insertedRows,
          duplicateRows,
          errors: validationErrors,
        });
      }

      // Pipe input stream to csv parser
      inputStream.pipe(csvStream);
    });
  }
}

export const csvParserService = new CsvParserService();
