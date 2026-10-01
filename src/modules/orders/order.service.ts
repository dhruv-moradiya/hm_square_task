import { Readable } from "node:stream";
import { env } from "../../config/env.js";
import { shardRouter, ShardRouter } from "../../database/shard-router.js";
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

  public async processOrdersCsvStream(
    csvStream: Readable,
    customBatchSize?: number,
  ): Promise<OrderProcessingSummary> {
    const batchSize = customBatchSize || env.batchSize || 500;

    const processBatch = async (
      batch: ValidOrder[],
    ): Promise<{ insertedCount: number; duplicateCount: number }> => {
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
          const result = await this.repository.insertBatchToShard(
            shardId,
            ordersForShard,
          );
          return result;
        },
      );

      const results = await Promise.all(shardInserts);
      for (const r of results) {
        batchInserted += r.insertedCount;
        batchDuplicates += r.duplicateCount;
      }

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
