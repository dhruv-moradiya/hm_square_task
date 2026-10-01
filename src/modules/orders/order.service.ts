import { PassThrough, Readable } from "node:stream";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { shardRouter, ShardRouter } from "../../database/shard-router.js";
import { gcsService } from "../../gcs/gcs.service.js";
import {
  csvParserService,
  CsvParserService,
} from "../../services/csv/csv-parser.service.js";
import { orderRepository, OrderRepository } from "./order.repository.js";
import { OrderProcessingSummary, ValidOrder } from "./order.schema.js";

export class OrderService {
  private readonly router: ShardRouter;
  private readonly repository: OrderRepository;
  private readonly parserService: CsvParserService;

  constructor(
    router: ShardRouter = shardRouter,
    repository: OrderRepository = orderRepository,
    parserService: CsvParserService = csvParserService,
  ) {
    this.router = router;
    this.repository = repository;
    this.parserService = parserService;
  }

  public async ingestOrdersFile(
    fileStream: Readable,
    options: {
      filename: string;
      mimeType?: string | undefined;
      requestId?: string | undefined;
      customBatchSize?: number | undefined;
    },
  ): Promise<OrderProcessingSummary> {
    const { filename, mimeType, requestId = "req-unknown", customBatchSize } = options;

    const parserStream = new PassThrough();
    let gcsUploadPromise: Promise<{ uploaded: boolean; error?: string }> | null = null;

    if (gcsService.isConfigured()) {
      const gcsStream = new PassThrough();
      const destination = gcsService.generateObjectPath(filename);
      const { writeStream, promise } = gcsService.createUploadStream(
        destination,
        mimeType || "text/csv",
      );

      fileStream.pipe(parserStream);
      fileStream.pipe(gcsStream);
      gcsStream.pipe(writeStream);

      gcsUploadPromise = promise
        .then(() => ({ uploaded: true }))
        .catch((err) => {
          logger.warn(
            { err: err.message, requestId, filename, destination },
            "GCS upload encountered an error",
          );
          return { uploaded: false, error: err.message };
        });
    } else {
      fileStream.pipe(parserStream);
      gcsUploadPromise = Promise.resolve({
        uploaded: false,
        error: "GCS bucket name not configured in environment (GCS_BUCKET_NAME)",
      });
    }

    const processingPromise = this.processOrdersCsvStream(parserStream, {
      requestId,
      customBatchSize,
    });

    const [summary, gcsResult] = await Promise.all([
      processingPromise,
      gcsUploadPromise,
    ]);

    summary.gcs_uploaded = gcsResult?.uploaded ?? false;

    return summary;
  }

  public async processOrdersCsvStream(
    csvStream: Readable,
    options: {
      customBatchSize?: number | undefined;
      requestId?: string | undefined;
    } = {},
  ): Promise<OrderProcessingSummary> {
    const batchSize = options.customBatchSize || env.batchSize || 500;
    const requestId = options.requestId || "req-unknown";
    let batchNumber = 0;

    const processBatch = async (
      batch: ValidOrder[],
    ): Promise<{ insertedCount: number; duplicateCount: number }> => {
      batchNumber++;
      const currentBatchNo = batchNumber;
      const batchStartTime = Date.now();

      const shardGroups = new Map<number, ValidOrder[]>();

      for (const order of batch) {
        const shardId = this.router.getShard(order.customer_id);
        let group = shardGroups.get(shardId);
        if (!group) {
          group = [];
          shardGroups.set(shardId, group);
        }
        group.push(order);
      }

      let batchInserted = 0;
      let batchDuplicates = 0;

      const shardInserts = Array.from(shardGroups.entries()).map(
        async ([shardId, ordersForShard]) => {
          const shardStartTime = Date.now();

          logger.info(
            {
              requestId,
              batchNumber: currentBatchNo,
              shardId,
              rowCount: ordersForShard.length,
            },
            "processing batch",
          );

          const result = await this.repository.insertBatchToShard(
            shardId,
            ordersForShard,
            {
              requestId,
              batchNumber: currentBatchNo,
            },
          );

          const shardDurationMs = Date.now() - shardStartTime;

          logger.info(
            {
              requestId,
              batchNumber: currentBatchNo,
              shardId,
              rowCount: ordersForShard.length,
              insertedRows: result.insertedCount,
              duplicateRows: result.duplicateCount,
              durationMs: shardDurationMs,
            },
            "batch completed",
          );

          return result;
        },
      );

      const results = await Promise.all(shardInserts);
      for (const r of results) {
        batchInserted += r.insertedCount;
        batchDuplicates += r.duplicateCount;
      }

      const totalBatchDurationMs = Date.now() - batchStartTime;
      logger.debug(
        {
          requestId,
          batchNumber: currentBatchNo,
          totalRows: batch.length,
          insertedRows: batchInserted,
          duplicateRows: batchDuplicates,
          durationMs: totalBatchDurationMs,
        },
        "Full multi-shard batch synchronized",
      );

      return {
        insertedCount: batchInserted,
        duplicateCount: batchDuplicates,
      };
    };

    return this.parserService.processCsvStream(csvStream, processBatch, {
      batchSize,
      maxErrorDetails: 100,
    });
  }

  public async getOrdersByCustomerId(
    customerId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<{
    customerId: string;
    shardId: number;
    totalCount: number;
    count: number;
    orders: any[];
  }> {
    const result = await this.repository.findOrdersByCustomerId(
      customerId,
      limit,
      offset,
    );
    return {
      customerId,
      shardId: result.shardId,
      totalCount: result.totalCount,
      count: result.orders.length,
      orders: result.orders,
    };
  }

  public async getOrderByOrderId(
    orderId: string,
  ): Promise<{ order: any; shardId: number } | null> {
    return this.repository.findOrderByOrderId(orderId);
  }
}

export const orderService = new OrderService();
