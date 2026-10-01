import pino from "pino";
import { pinoHttp } from "pino-http";
import { randomUUID } from "node:crypto";
import { env } from "./env.js";

const isDevelopment = env.nodeEnv === "development" || env.nodeEnv === "test";

export const logger = pino({
  level: env.logLevel || "info",
  redact: {
    paths: [
      "password",
      "user.password",
      "*.password",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    remove: true,
  },
  ...(isDevelopment && process.env.NODE_ENV !== "test"
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:yyyy-mm-dd HH:MM:ss",
            ignore: "pid,hostname",
          },
        },
      }
    : {}),
});

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const existingId = req.headers["x-request-id"] as string;
    if (existingId) return existingId;
    const newId = `req-${randomUUID().slice(0, 8)}`;
    res.setHeader("x-request-id", newId);
    return newId;
  },
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 500 || err) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  customSuccessMessage: (req, res, responseTime) => {
    return `${req.method} ${req.url} ${res.statusCode} - ${responseTime}ms`;
  },
  customErrorMessage: (req, res, err) => {
    return `${req.method} ${req.url} ${res.statusCode} failed: ${err.message}`;
  },
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: req.url,
      };
    },
    res(res) {
      return {
        statusCode: res.statusCode,
      };
    },
  },
});
