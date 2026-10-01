import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { app } from "../src/app.js";
import { shardManager } from "../src/database/shard-manager.js";

describe("Upload Orders Endpoint & Lifecycle Tests", () => {
  beforeAll(async () => {
    await shardManager.testAllConnections();
  });

  afterAll(async () => {
    await shardManager.closeAll();
  });

  it("should reject upload without multipart/form-data", async () => {
    const res = await request(app)
      .post("/upload-orders")
      .send({ some: "data" })
      .set("Content-Type", "application/json");

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Invalid Content-Type");
  });

  it("should reject non-CSV file uploads", async () => {
    const res = await request(app)
      .post("/upload-orders")
      .attach("file", Buffer.from("dummy text content"), "orders.txt");

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Only CSV files are allowed");
  });

  it("should upload a valid CSV and return request ID and processing summary", async () => {
    const orderId1 = randomUUID();
    const orderId2 = randomUUID();

    const csvContent = [
      "order_id,customer_id,order_date,order_amount,status",
      `${orderId1},CUST-HTTP-01,2026-10-01T10:00:00Z,123.45,completed`,
      `${orderId2},CUST-HTTP-02,2026-10-01T11:00:00Z,67.89,pending`,
    ].join("\n");

    const customReqId = "req-test-trace-123";

    const res = await request(app)
      .post("/upload-orders")
      .set("x-request-id", customReqId)
      .attach("file", Buffer.from(csvContent), "test_orders.csv");

    expect(res.status).toBe(200);
    expect(res.body.totalRows).toBe(2);
    expect(res.body.validRows).toBe(2);
    expect(res.body.insertedRows).toBe(2);
    expect(res.body.duplicateRows).toBe(0);

    // Verify GET /orders/:orderId works
    const getRes = await request(app).get(`/orders/${orderId1}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.order.order_id).toBe(orderId1);
  });

  it("should handle CSV with duplicate order_id idempotently", async () => {
    const duplicateOrderId = randomUUID();

    const csvWithDuplicate = [
      "order_id,customer_id,order_date,order_amount,status",
      `${duplicateOrderId},CUST-DUP-01,2026-10-01T10:00:00Z,499.99,completed`,
      `${duplicateOrderId},CUST-DUP-01,2026-10-01T10:00:00Z,499.99,completed`,
    ].join("\n");

    // First upload
    const res1 = await request(app)
      .post("/upload-orders")
      .attach("file", Buffer.from(csvWithDuplicate), "duplicates.csv");

    expect(res1.status).toBe(200);
    expect(res1.body.totalRows).toBe(2);
    expect(res1.body.validRows).toBe(2);
    expect(res1.body.insertedRows).toBe(1);
    expect(res1.body.duplicateRows).toBe(1);

    // Uploading the EXACT same file again: 0 inserted, 2 duplicates skipped
    const res2 = await request(app)
      .post("/upload-orders")
      .attach("file", Buffer.from(csvWithDuplicate), "duplicates.csv");

    expect(res2.status).toBe(200);
    expect(res2.body.totalRows).toBe(2);
    expect(res2.body.validRows).toBe(2);
    expect(res2.body.insertedRows).toBe(0);
    expect(res2.body.duplicateRows).toBe(2);
  });

  it("should process 10,000-row test CSV file correctly", async () => {
    const csvPath = path.resolve(process.cwd(), "test-data/orders-10000.csv");
    expect(fs.existsSync(csvPath)).toBe(true);

    const res = await request(app)
      .post("/upload-orders")
      .attach("file", csvPath);

    expect(res.status).toBe(200);
    expect(res.body.totalRows).toBe(10000);
    expect(res.body.validRows).toBe(10000);
    expect(res.body.insertedRows + res.body.duplicateRows).toBe(10000);
  }, 30000);
});
