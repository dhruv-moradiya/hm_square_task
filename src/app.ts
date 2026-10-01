import express, { Express, Request, Response, NextFunction } from "express";
import { httpLogger, logger } from "./config/logger.js";
import { ApiResponse } from "./utils/api-response.js";
import { healthRouter } from "./routes/health.routes.js";
import { orderRouter } from "./routes/order.routes.js";

export function createApp(): Express {
  const app = express();

  app.use(httpLogger);
  app.use(express.json());

  app.use("/health", healthRouter);
  app.use("/orders", orderRouter);
  app.use("/upload-orders", orderRouter);

  app.use((req: Request, res: Response) => {
    ApiResponse.error(res, "Not Found", 404, {
      message: `Cannot ${req.method} ${req.url}`,
    });
  });

  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const requestId = (req as any).id || req.headers["x-request-id"];
    logger.error(
      {
        err,
        requestId,
        method: req.method,
        url: req.url,
      },
      "Unhandled server error",
    );
    ApiResponse.error(res, "Internal Server Error", err.status || 500, {
      message: err.message || "An unexpected error occurred",
    });
  });

  return app;
}

export const app = createApp();

