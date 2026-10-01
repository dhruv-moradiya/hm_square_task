import pg from "pg";
import { ShardRouter, shardRouter as defaultRouter } from "./shard-router.js";
import { ShardPoolEntry, shardPools as defaultPools } from "./pools.js";

export interface ShardConnectionStatus {
  shardId: number;
  host: string;
  port: number;
  database: string;
  connected: boolean;
  error?: string;
}

export class ShardManager {
  private readonly router: ShardRouter;
  private readonly pools: Map<number, ShardPoolEntry>;

  constructor(
    pools: Map<number, ShardPoolEntry> = defaultPools,
    router: ShardRouter = defaultRouter,
  ) {
    this.pools = pools;
    this.router = router;
  }

  /**
   * Retrieves the PostgreSQL Pool for a specific shard index.
   * @param shardId - Shard number (0, 1, 2)
   */
  public getPool(shardId: number): pg.Pool {
    const entry = this.pools.get(shardId);
    if (!entry) {
      throw new Error(
        `No database pool found for shard ID ${shardId}. Configured shards: [${Array.from(this.pools.keys()).join(", ")}]`,
      );
    }
    return entry.pool;
  }

  /**
   * Routes a customerId to its designated shard and returns the corresponding Pool.
   * @param customerId - Customer identifier (shard key)
   */
  public getPoolForCustomer(customerId: string): {
    shardId: number;
    pool: pg.Pool;
  } {
    const shardId = this.router.getShard(customerId);
    const pool = this.getPool(shardId);
    return { shardId, pool };
  }

  public getAllShardEntries(): ShardPoolEntry[] {
    return Array.from(this.pools.values());
  }

  public async testAllConnections(): Promise<ShardConnectionStatus[]> {
    console.log("Connecting to PostgreSQL shards...");

    const statuses: ShardConnectionStatus[] = [];
    const shardEntries = this.getAllShardEntries();

    for (const entry of shardEntries) {
      const { shardId, config, pool } = entry;
      try {
        const client = await pool.connect();
        try {
          await client.query("SELECT 1");
          console.log(
            `Shard ${shardId}: Connected (${config.host}:${config.port}/${config.database})`,
          );
          statuses.push({
            shardId,
            host: config.host,
            port: config.port,
            database: config.database,
            connected: true,
          });
        } finally {
          client.release();
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(
          `Shard ${shardId}: Connection Failed (${config.host}:${config.port}/${config.database}) - ${errorMessage}`,
        );
        statuses.push({
          shardId,
          host: config.host,
          port: config.port,
          database: config.database,
          connected: false,
          error: errorMessage,
        });
      }
    }

    const failedShards = statuses.filter((s) => !s.connected);
    if (failedShards.length > 0) {
      const failedIds = failedShards
        .map((s) => `Shard ${s.shardId} (${s.host}:${s.port})`)
        .join(", ");
      throw new Error(
        `Failed to connect to one or more PostgreSQL shards: ${failedIds}`,
      );
    }

    return statuses;
  }

  /**
   * Gracefully drains and closes all shard connection pools.
   */
  public async closeAll(): Promise<void> {
    for (const entry of this.pools.values()) {
      await entry.pool.end();
    }
  }
}

// Singleton ShardManager instance
export const shardManager = new ShardManager();
