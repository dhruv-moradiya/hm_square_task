import { app } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { shardManager } from "./database/shard-manager.js";

async function startServer(): Promise<void> {
  try {
    await shardManager.testAllConnections();

    const server = app.listen(env.port, () => {
      logger.info(
        { port: env.port, env: env.nodeEnv },
        `Server running on http://localhost:${env.port}`,
      );
      logger.info(`Health check: http://localhost:${env.port}/health`);
    });

    const shutdown = async (signal: string) => {
      logger.info({ signal }, `Received ${signal}. Shutting down gracefully...`);
      server.close(async () => {
        logger.info("HTTP server closed.");
        try {
          await shardManager.closeAll();
          logger.info("PostgreSQL shard connection pools closed.");
          process.exit(0);
        } catch (err) {
          logger.error({ err }, "Error closing database connections");
          process.exit(1);
        }
      });
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    logger.error({ err: error }, "Server startup aborted due to initialization error");
    process.exit(1);
  }
}

startServer();

