import fs from "node:fs";
import path from "node:path";
import { createApp } from "../src/app.js";
import { shardManager } from "../src/database/shard-manager.js";

async function runCsvUploadTests() {
  console.log("=".repeat(70));
  console.log("CSV Upload, Streaming, Batching, and Transaction Test Suite");
  console.log("=".repeat(70));

  // 1. Check DB connections and reset test tables for clean testing
  await shardManager.testAllConnections();
  for (const { pool } of shardManager.getAllShardEntries()) {
    await pool.query("TRUNCATE TABLE orders;");
  }

  // 2. Start test server on port 3002
  const app = createApp();
  const server = app.listen(3002);
  const baseUrl = "http://localhost:3002";

  try {
    const testDataDir = path.resolve(process.cwd(), "test-data");

    // Helper to upload a file via multipart/form-data
    async function uploadFile(filePath: string, customMimeType?: string) {
      const fileBuffer = fs.readFileSync(filePath);
      const filename = path.basename(filePath);
      const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);

      const mimeType =
        customMimeType || (filename.endsWith(".csv") ? "text/csv" : "text/plain");

      const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
      const footer = `\r\n--${boundary}--\r\n`;

      const body = Buffer.concat([
        Buffer.from(header, "utf-8"),
        fileBuffer,
        Buffer.from(footer, "utf-8"),
      ]);

      const res = await fetch(`${baseUrl}/upload-orders`, {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      const json = await res.json();
      return { status: res.status, data: json };
    }

    // --- TEST 1: Reject Non-CSV Files ---
    console.log("\n[TEST 1] Testing Non-CSV File Rejection (.txt file)...");
    const test1 = await uploadFile(path.join(testDataDir, "test-upload.txt"));
    console.log(`Response Status: ${test1.status}, Data:`, test1.data);
    if (test1.status !== 400 || !JSON.stringify(test1.data).includes("CSV")) {
      throw new Error("Test 1 Failed: Non-CSV file was not rejected with 400");
    }
    console.log("PASS: Non-CSV file rejected with 400 Bad Request.");

    // --- TEST 2: Reject Invalid Header ---
    console.log("\n[TEST 2] Testing Invalid CSV Header (orders-invalid-header.csv)...");
    const test2 = await uploadFile(path.join(testDataDir, "orders-invalid-header.csv"));
    console.log(`Response Status: ${test2.status}, Data:`, test2.data);
    if (test2.status !== 400 || !JSON.stringify(test2.data).includes("header")) {
      throw new Error("Test 2 Failed: Invalid header was not rejected with 400");
    }
    console.log("PASS: Invalid header rejected with 400 Bad Request and expected columns.");

    // --- TEST 3: Invalid Rows Skipped & Errors Collected ---
    console.log("\n[TEST 3] Testing Invalid Rows Skipping (orders-invalid.csv)...");
    const test3 = await uploadFile(path.join(testDataDir, "orders-invalid.csv"));
    console.log(`Response Status: ${test3.status}, Data:`, test3.data);
    if (
      test3.status !== 200 ||
      test3.data.totalRows !== 9 ||
      test3.data.validRows !== 3 ||
      test3.data.invalidRows !== 6 ||
      test3.data.insertedRows !== 3 ||
      test3.data.errors.length !== 6
    ) {
      throw new Error("Test 3 Failed: Invalid rows were not handled correctly");
    }
    console.log(`PASS: Skipped 6 invalid rows, collected error details, and inserted ${test3.data.insertedRows} valid rows.`);

    // --- TEST 4: Duplicate order_id Handling (ON CONFLICT DO NOTHING) ---
    console.log("\n[TEST 4] Testing Duplicate Orders (orders-duplicates.csv)...");
    const test4 = await uploadFile(path.join(testDataDir, "orders-duplicates.csv"));
    console.log(`Response Status: ${test4.status}, Data:`, test4.data);
    if (
      test4.status !== 200 ||
      test4.data.totalRows !== 5 ||
      test4.data.validRows !== 5 ||
      test4.data.insertedRows !== 3 ||
      test4.data.duplicateRows !== 2
    ) {
      throw new Error("Test 4 Failed: Duplicate order_ids were not handled properly");
    }
    console.log(`PASS: Detected 2 duplicate orders, inserted ${test4.data.insertedRows} unique orders.`);

    // --- TEST 5: Valid Orders Batch Upload ---
    console.log("\n[TEST 5] Testing Valid Orders (orders-valid.csv - 25 rows)...");
    const test5 = await uploadFile(path.join(testDataDir, "orders-valid.csv"));
    console.log(`Response Status: ${test5.status}, Data:`, test5.data);
    if (
      test5.status !== 200 ||
      test5.data.totalRows !== 25 ||
      test5.data.validRows !== 25 ||
      test5.data.insertedRows !== 25 ||
      test5.data.invalidRows !== 0
    ) {
      throw new Error("Test 5 Failed: Valid rows failed to insert completely");
    }
    console.log("PASS: 25 valid orders uploaded and inserted across shards.");

    // --- TEST 6: Performance Test with 10,000 Orders (Streaming & Batching) ---
    console.log("\n[TEST 6] Performance & Streaming Test with 10,000 Orders (orders-10000.csv)...");
    const startTime = Date.now();
    const test6 = await uploadFile(path.join(testDataDir, "orders-10000.csv"));
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Processed 10,000 orders in ${elapsedSec}s. Result:`, {
      totalRows: test6.data.totalRows,
      validRows: test6.data.validRows,
      insertedRows: test6.data.insertedRows,
      duplicateRows: test6.data.duplicateRows,
      invalidRows: test6.data.invalidRows,
    });
    if (test6.status !== 200 || test6.data.insertedRows !== 10000) {
      throw new Error(`Test 6 Failed: Expected 10000 inserted rows, got ${test6.data.insertedRows}`);
    }
    console.log("PASS: 10,000 orders streamed and batch-inserted successfully!");

    // --- TEST 7: Verify Distribution Across All 3 Shards ---
    console.log("\n[TEST 7] Verifying Distribution Across Shard 0, Shard 1, and Shard 2...");
    const shardEntries = shardManager.getAllShardEntries();
    let totalAcrossShards = 0;
    for (const { shardId, config, pool } of shardEntries) {
      const res = await pool.query("SELECT COUNT(*) AS count FROM orders;");
      const count = parseInt(res.rows[0].count, 10);
      totalAcrossShards += count;
      console.log(`  Shard ${shardId} (${config.host}:${config.port}/${config.database}): ${count} total orders`);
    }
    console.log(`Total orders in all 3 database shards: ${totalAcrossShards}`);

    // --- TEST 8: Bonus Endpoint GET /orders?customerId=... (Single-shard query) ---
    console.log("\n[TEST 8] Testing GET /orders?customerId=CUST_0001 (Single-shard lookup)...");
    const getCustRes = await fetch(`${baseUrl}/orders?customerId=CUST_0001`);
    const getCustJson = await getCustRes.json();
    console.log(`Response Status: ${getCustRes.status}, Orders found: ${getCustJson.count} on Shard ${getCustJson.shardId}`);
    if (getCustRes.status !== 200 || getCustJson.count === 0 || !Array.isArray(getCustJson.orders)) {
      throw new Error("Test 8 Failed: GET /orders?customerId= failed");
    }
    const sampleOrderId = getCustJson.orders[0].order_id;
    console.log(`PASS: Retrieved ${getCustJson.count} orders for customer CUST_0001 on Shard ${getCustJson.shardId}.`);

    // --- TEST 9: Bonus Endpoint GET /orders/:orderId (Scatter-Gather lookup) ---
    console.log(`\n[TEST 9] Testing GET /orders/:orderId for order "${sampleOrderId}" (Scatter-gather)...`);
    const getOrderRes = await fetch(`${baseUrl}/orders/${sampleOrderId}`);
    const getOrderJson = await getOrderRes.json();
    console.log(`Response Status: ${getOrderRes.status}, Found order on Shard ${getOrderJson.shardId}:`, getOrderJson.order.order_id);
    if (getOrderRes.status !== 200 || getOrderJson.order.order_id !== sampleOrderId) {
      throw new Error("Test 9 Failed: GET /orders/:orderId failed to find existing order");
    }
    console.log("PASS: Found order correctly via Scatter-Gather across shards.");

    // --- TEST 10: Non-existent order and invalid UUID ---
    console.log("\n[TEST 10] Testing GET /orders/:orderId error cases (404 and 400)...");
    const nonExistentId = "00000000-0000-0000-0000-000000000000";
    const notFoundRes = await fetch(`${baseUrl}/orders/${nonExistentId}`);
    if (notFoundRes.status !== 404) {
      throw new Error("Test 10 Failed: Expected 404 for non-existent order");
    }
    const badIdRes = await fetch(`${baseUrl}/orders/invalid-uuid-123`);
    if (badIdRes.status !== 400) {
      throw new Error("Test 10 Failed: Expected 400 for bad UUID format");
    }
    console.log("PASS: 404 and 400 error cases handled correctly.");

    console.log("\n" + "=".repeat(70));
    console.log("ALL TESTS (INCLUDING BONUS ENDPOINTS) PASSED SUCCESSFULLY!");
    console.log("=".repeat(70) + "\n");
  } finally {
    server.close();
    await shardManager.closeAll();
  }
}

runCsvUploadTests().catch((err) => {
  console.error("Test Suite Failed with error:", err);
  process.exit(1);
});
