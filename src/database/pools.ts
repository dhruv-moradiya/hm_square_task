import pg from "pg";
import { env, ShardDbConfig } from "../config/env.js";

const { Pool } = pg;

export interface ShardPoolEntry {
  shardId: number;
  config: ShardDbConfig;
  pool: pg.Pool;
}

export function createShardPools(
  shardConfigs: ShardDbConfig[] = env.shards,
): Map<number, ShardPoolEntry> {
  const pools = new Map<number, ShardPoolEntry>();

  for (const config of shardConfigs) {
    const pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on("error", (err) => {
      console.error(
        `[Shard ${config.id}] Unexpected error on idle PostgreSQL client:`,
        err.message,
      );
    });

    pools.set(config.id, {
      shardId: config.id,
      config,
      pool,
    });
  }

  return pools;
}

export const shardPools = createShardPools(env.shards);
