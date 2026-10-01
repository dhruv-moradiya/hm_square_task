import { describe, it, expect, vi } from "vitest";
import { isTransientError, withRetry } from "../src/utils/retry.js";
import { withTransaction } from "../src/database/transaction.js";

describe("Retry Handling Unit Tests", () => {
  describe("isTransientError", () => {
    it("should identify transient PostgreSQL connection and serialization error codes", () => {
      // Connection errors (Class 08)
      expect(isTransientError({ code: "08000" })).toBe(true);
      expect(isTransientError({ code: "08006" })).toBe(true);
      expect(isTransientError({ code: "08P01" })).toBe(true);

      // Serialization & Deadlock (Class 40)
      expect(isTransientError({ code: "40001" })).toBe(true);
      expect(isTransientError({ code: "40P01" })).toBe(true);

      // Server shutdown / cannot connect (Class 57)
      expect(isTransientError({ code: "57P01" })).toBe(true);
      expect(isTransientError({ code: "57P03" })).toBe(true);

      // Too many connections (Class 53)
      expect(isTransientError({ code: "53300" })).toBe(true);
    });

    it("should identify transient Node.js network error codes", () => {
      expect(isTransientError({ code: "ECONNRESET" })).toBe(true);
      expect(isTransientError({ code: "ECONNREFUSED" })).toBe(true);
      expect(isTransientError({ code: "ETIMEDOUT" })).toBe(true);
      expect(isTransientError({ code: "EPIPE" })).toBe(true);
    });

    it("should identify transient connection termination error messages", () => {
      expect(
        isTransientError(new Error("Connection terminated unexpectedly")),
      ).toBe(true);
      expect(
        isTransientError(new Error("Client has encountered a connection error")),
      ).toBe(true);
      expect(isTransientError(new Error("Socket closed"))).toBe(true);
    });

    it("should NOT treat permanent errors as transient", () => {
      // Invalid UUID / data syntax (Class 22)
      expect(isTransientError({ code: "22P02" })).toBe(false);

      // Syntax error / invalid SQL (Class 42)
      expect(isTransientError({ code: "42601" })).toBe(false);
      expect(isTransientError({ code: "42P01" })).toBe(false); // undefined table

      // Integrity constraint violation (Class 23)
      expect(isTransientError({ code: "23502" })).toBe(false); // not null violation
      expect(isTransientError({ code: "23514" })).toBe(false); // check violation

      // Generic application error
      expect(isTransientError(new Error("Validation failed: invalid email"))).toBe(
        false,
      );
      expect(isTransientError(null)).toBe(false);
      expect(isTransientError(undefined)).toBe(false);
    });
  });

  describe("withRetry", () => {
    it("should return the result directly if operation succeeds on first attempt", async () => {
      const op = vi.fn().mockResolvedValue("success");

      const result = await withRetry(op, { maxRetries: 3, baseDelayMs: 10 });

      expect(result).toBe("success");
      expect(op).toHaveBeenCalledTimes(1);
      expect(op).toHaveBeenCalledWith(1);
    });

    it("should retry transient error and succeed on second attempt", async () => {
      const transientErr = { code: "ECONNRESET", message: "Connection reset by peer" };
      const op = vi
        .fn()
        .mockRejectedValueOnce(transientErr)
        .mockResolvedValueOnce("recovered");

      const result = await withRetry(op, { maxRetries: 3, baseDelayMs: 10 });

      expect(result).toBe("recovered");
      expect(op).toHaveBeenCalledTimes(2);
      expect(op).toHaveBeenNthCalledWith(1, 1);
      expect(op).toHaveBeenNthCalledWith(2, 2);
    });

    it("should fail immediately on permanent error without retrying", async () => {
      const permanentErr = { code: "22P02", message: "invalid input syntax for type uuid" };
      const op = vi.fn().mockRejectedValue(permanentErr);

      await expect(
        withRetry(op, { maxRetries: 3, baseDelayMs: 10 }),
      ).rejects.toEqual(permanentErr);

      expect(op).toHaveBeenCalledTimes(1);
    });

    it("should throw after exhausting maxRetries on persistent transient errors", async () => {
      const transientErr = { code: "40001", message: "could not serialize access due to concurrent update" };
      const op = vi.fn().mockRejectedValue(transientErr);

      await expect(
        withRetry(op, { maxRetries: 2, baseDelayMs: 10 }),
      ).rejects.toEqual(transientErr);

      // Attempt 1 + 2 retries = 3 calls total
      expect(op).toHaveBeenCalledTimes(3);
    });
  });

  describe("withTransaction with fresh client per retry", () => {
    it("should acquire a new client and rollback on retryable failure", async () => {
      const mockClients: any[] = [];

      const createMockClient = (id: number) => {
        const client = {
          id,
          query: vi.fn().mockImplementation(async (sql: string) => {
            if (sql === "BEGIN") return { rows: [] };
            if (sql === "COMMIT") return { rows: [] };
            if (sql === "ROLLBACK") return { rows: [] };
            return { rows: [] };
          }),
          release: vi.fn(),
        };
        mockClients.push(client);
        return client;
      };

      let clientCounter = 0;
      const mockPool: any = {
        connect: vi.fn().mockImplementation(async () => {
          clientCounter++;
          return createMockClient(clientCounter);
        }),
      };

      let attempts = 0;
      const callback = vi.fn().mockImplementation(async (client: any) => {
        attempts++;
        if (attempts === 1) {
          const err: any = new Error("Connection reset");
          err.code = "ECONNRESET";
          throw err;
        }
        return { success: true, clientId: client.id };
      });

      const result = await withTransaction(mockPool, callback, {
        maxRetries: 2,
        baseDelayMs: 10,
      });

      expect(result).toEqual({ success: true, clientId: 2 });
      expect(mockPool.connect).toHaveBeenCalledTimes(2);

      // Client 1 should have had BEGIN, ROLLBACK, and RELEASE
      expect(mockClients[0].query).toHaveBeenCalledWith("BEGIN");
      expect(mockClients[0].query).toHaveBeenCalledWith("ROLLBACK");
      expect(mockClients[0].release).toHaveBeenCalledTimes(1);

      // Client 2 (new fresh client) should have had BEGIN, COMMIT, and RELEASE
      expect(mockClients[1].query).toHaveBeenCalledWith("BEGIN");
      expect(mockClients[1].query).toHaveBeenCalledWith("COMMIT");
      expect(mockClients[1].release).toHaveBeenCalledTimes(1);
    });
  });
});
