import { app } from "./app.js";
import { env } from "./config/env.js";
import { shardManager } from "./database/shard-manager.js";

async function startServer(): Promise<void> {
  try {
    await shardManager.testAllConnections();

    const server = app.listen(env.port, () => {
      console.log(`\nServer running on http://localhost:${env.port}`);
      console.log(`Health check: http://localhost:${env.port}/health\n`);
    });

    const shutdown = async (signal: string) => {
      console.log(`\nReceived ${signal}. Shutting down gracefully...`);
      server.close(async () => {
        console.log("HTTP server closed.");
        try {
          await shardManager.closeAll();
          console.log("PostgreSQL shard connection pools closed.");
          process.exit(0);
        } catch (err) {
          console.error("Error closing database connections:", err);
          process.exit(1);
        }
      });
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    console.error("\nServer startup aborted due to initialization error:");
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

startServer();
