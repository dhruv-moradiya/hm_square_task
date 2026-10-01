import pg from "pg";
import { withRetry, RetryOptions } from "../utils/retry.js";

export async function withTransaction<T>(
  pool: pg.Pool,
  callback: (client: pg.PoolClient, attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  return withRetry(async (attempt) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client, attempt);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Connection already be closed; ignore rollback errors
      }
      throw error;
    } finally {
      client.release();
    }
  }, options);
}
