import { shardManager, ShardManager } from "../../database/shard-manager.js";
import { withTransaction } from "../../database/transaction.js";
import { logger } from "../../config/logger.js";
import { BatchInsertResult, ValidOrder } from "./order.schema.js";

export class OrderRepository {
  private readonly shardManager: ShardManager;

  constructor(shardMgr: ShardManager = shardManager) {
    this.shardManager = shardMgr;
  }

  public async insertBatchToShard(
    shardId: number,
    orders: ValidOrder[],
    context: Record<string, any> = {},
  ): Promise<BatchInsertResult> {
    if (orders.length === 0) {
      return { insertedCount: 0, duplicateCount: 0 };
    }

    const pool = this.shardManager.getPool(shardId);

    return withTransaction(
      pool,
      async (client) => {
        const valueClauses: string[] = [];
        const queryParams: any[] = [];

        for (let i = 0; i < orders.length; i++) {
          const order = orders[i]!;
          const offset = i * 5;
          valueClauses.push(
            `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`,
          );
          queryParams.push(
            order.order_id,
            order.customer_id,
            order.order_date,
            order.order_amount,
            order.status,
          );
        }

        const insertQuery = `
          INSERT INTO orders (
            order_id,
            customer_id,
            order_date,
            order_amount,
            status
          )
          VALUES ${valueClauses.join(", ")}
          ON CONFLICT (order_id) DO NOTHING
          RETURNING order_id;
        `;

        const result = await client.query(insertQuery, queryParams);
        const insertedCount = result.rowCount ?? result.rows.length;
        const duplicateCount = orders.length - insertedCount;

        return {
          insertedCount,
          duplicateCount,
        };
      },
      {
        context: {
          shardId,
          rowCount: orders.length,
          ...context,
        },
      },
    ).catch((err) => {
      logger.error(
        {
          err,
          shardId,
          rowCount: orders.length,
          ...context,
        },
        "Batch insertion failed permanently on shard",
      );
      throw err;
    });
  }

  public async findOrdersByCustomerId(
    customerId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<{ shardId: number; orders: any[]; totalCount: number }> {
    const { shardId, pool } = this.shardManager.getPoolForCustomer(customerId);

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM orders
      WHERE customer_id = $1;
    `;
    const countResult = await pool.query(countQuery, [customerId]);
    const totalCount = parseInt(countResult.rows[0]?.total || "0", 10);

    const dataQuery = `
      SELECT id, order_id, customer_id, order_date, order_amount, status, created_at
      FROM orders
      WHERE customer_id = $1
      ORDER BY order_date DESC
      LIMIT $2 OFFSET $3;
    `;
    const dataResult = await pool.query(dataQuery, [customerId, limit, offset]);

    return {
      shardId,
      orders: dataResult.rows,
      totalCount,
    };
  }

  public async findOrderByOrderId(
    orderId: string,
  ): Promise<{ shardId: number; order: any } | null> {
    const shardEntries = this.shardManager.getAllShardEntries();

    const query = `
      SELECT id, order_id, customer_id, order_date, order_amount, status, created_at
      FROM orders
      WHERE order_id = $1
      LIMIT 1;
    `;

    // Query all shards in parallel
    const searchPromises = shardEntries.map(async ({ shardId, pool }) => {
      const result = await pool.query(query, [orderId]);
      if (result.rows.length > 0) {
        return { shardId, order: result.rows[0] };
      }
      return null;
    });

    const results = await Promise.all(searchPromises);
    const found = results.find((r) => r !== null);

    return found || null;
  }
}

export const orderRepository = new OrderRepository();
