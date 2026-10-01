import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

const TRANSIENT_PG_ERROR_CODES = new Set([
  // Connection Exceptions
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  // Transaction Rollback / Concurrency (Class 40)
  "40001",
  "40P01", 
  // Operator Intervention / Server Shutdown (Class 57)
  "57P01",
  "57P02",
  "57P03", 
  // Insufficient Resources (Class 53)
  "53300", 
]);

const TRANSIENT_SYSTEM_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "EAI_AGAIN",
]);


export function isTransientError(error: any): boolean {
  if (!error) return false;

  // 1. Check PostgreSQL error code
  if (error.code && TRANSIENT_PG_ERROR_CODES.has(String(error.code))) {
    return true;
  }

  // 2. Check Node.js system error code
  if (error.code && TRANSIENT_SYSTEM_ERROR_CODES.has(String(error.code))) {
    return true;
  }

  // 3. Check error message patterns for connection drops
  const message = (error.message || "").toLowerCase();
  if (
    message.includes("connection terminated") ||
    message.includes("connection reset") ||
    message.includes("client has encountered a connection error") ||
    message.includes("timeout") ||
    message.includes("socket closed") ||
    message.includes("connection closed")
  ) {
    return true;
  }

  return false;
}

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  context?: Record<string, any>;
  isRetryable?: (error: any) => boolean;
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? env.retry.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? env.retry.baseDelayMs ?? 200;
  const checkRetryable = options.isRetryable ?? isTransientError;
  const context = options.context ?? {};

  let lastError: any;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await operation(attempt);
    } catch (error: any) {
      lastError = error;

      // If we've reached max attempts or the error is not transient, do not retry
      if (attempt > maxRetries || !checkRetryable(error)) {
        throw error;
      }

      // Exponential backoff: attempt 1 -> baseDelay * 1, attempt 2 -> baseDelay * 2, etc.
      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);

      logger.warn(
        {
          err: error,
          attempt,
          maxRetries,
          delayMs,
          errorCode: error?.code,
          ...context,
        },
        "database operation failed, retrying",
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
