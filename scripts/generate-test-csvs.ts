import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const testDataDir = path.resolve(process.cwd(), "test-data");
if (!fs.existsSync(testDataDir)) {
  fs.mkdirSync(testDataDir, { recursive: true });
}

/**
 * Parses simple CLI arguments like --rows 5000 --out custom.csv --invalid 5
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg && arg.startsWith("--")) {
      const key = arg.slice(2);
      const nextVal = args[i + 1];
      if (nextVal && !nextVal.startsWith("--")) {
        options[key] = nextVal;
        i++;
      } else {
        options[key] = "true";
      }
    }
  }
  return options;
}

/**
 * Generates a custom CSV file with specified row count, invalid rows, and duplicates.
 */
function generateCustomCsv(
  outputPath: string,
  rowCount: number,
  customerCount: number = 500,
  invalidPercent: number = 0,
  duplicatePercent: number = 0,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(outputPath);
    stream.write("order_id,customer_id,order_date,order_amount,status\n");

    const customers = Array.from(
      { length: customerCount },
      (_, i) => `CUST_${String(i + 1).padStart(4, "0")}`,
    );

    const baseTimestamp = Date.now();
    const generatedUuids: string[] = [];
    const statuses = ["completed", "pending", "shipped", "processing"];

    for (let i = 0; i < rowCount; i++) {
      const custId = customers[i % customers.length]!;
      const date = new Date(baseTimestamp - (i % 86400) * 1000).toISOString();
      const amount = (Math.random() * 800 + 5).toFixed(2);
      const status = statuses[i % statuses.length]!;

      let orderId = randomUUID();

      // Duplicate injection
      if (
        duplicatePercent > 0 &&
        Math.random() * 100 < duplicatePercent &&
        generatedUuids.length > 0
      ) {
        orderId =
          generatedUuids[Math.floor(Math.random() * generatedUuids.length)]!;
      } else {
        generatedUuids.push(orderId);
      }

      // Invalid row injection
      if (invalidPercent > 0 && Math.random() * 100 < invalidPercent) {
        const errorType = i % 4;
        if (errorType === 0) {
          // Invalid UUID
          stream.write(
            `invalid-uuid-${i},${custId},${date},${amount},${status}\n`,
          );
        } else if (errorType === 1) {
          // Missing customer ID
          stream.write(`${orderId},,${date},${amount},${status}\n`);
        } else if (errorType === 2) {
          // Invalid amount
          stream.write(`${orderId},${custId},${date},-49.99,${status}\n`);
        } else {
          // Invalid date
          stream.write(
            `${orderId},${custId},invalid-date,${amount},${status}\n`,
          );
        }
      } else {
        stream.write(`${orderId},${custId},${date},${amount},${status}\n`);
      }
    }

    stream.end(() => {
      console.log(
        `Generated CSV: ${outputPath} (${rowCount.toLocaleString()} rows)`,
      );
      resolve();
    });

    stream.on("error", reject);
  });
}

async function main() {
  const options = parseArgs();

  // If custom CLI parameters are provided (e.g. --rows 5000 or --out my-file.csv)
  if (options.rows || options.out) {
    const rowCount = options.rows ? parseInt(options.rows, 10) : 10000;
    const outFile = options.out
      ? path.resolve(process.cwd(), options.out)
      : path.join(testDataDir, `orders-${rowCount}.csv`);
    const invalidPercent = options.invalid ? parseFloat(options.invalid) : 0;
    const duplicatePercent = options.duplicates
      ? parseFloat(options.duplicates)
      : 0;
    const customerCount = options.customers
      ? parseInt(options.customers, 10)
      : 500;

    await generateCustomCsv(
      outFile,
      rowCount,
      customerCount,
      invalidPercent,
      duplicatePercent,
    );
    return;
  }

  // Default: Generate all standard test suite CSV files
  console.log("Generating standard test CSV files in test-data/...\n");

  // 1. Valid orders CSV (25 valid rows)
  await generateCustomCsv(
    path.join(testDataDir, "orders-valid.csv"),
    25,
    10,
    0,
    0,
  );

  // 2. Invalid rows CSV (contains valid and invalid rows)
  const invalidRowsContent = [
    "order_id,customer_id,order_date,order_amount,status",
    `${randomUUID()},CUST_001,2026-10-01T10:00:00Z,499.99,completed`,
    `invalid-uuid-format,CUST_002,2026-10-01T10:00:00Z,299.50,pending`,
    `${randomUUID()},,2026-10-01T10:00:00Z,150.00,completed`,
    `${randomUUID()},CUST_004,invalid-date-string,199.99,completed`,
    `${randomUUID()},CUST_005,2026-10-01T10:00:00Z,-50.00,completed`,
    `${randomUUID()},CUST_006,2026-10-01T10:00:00Z,abc,completed`,
    `${randomUUID()},CUST_007,2026-10-01T10:00:00Z,99.99,`,
    `${randomUUID()},CUST_008,2026-10-01T11:00:00Z,350.00,completed`,
    `${randomUUID()},CUST_009,2026-10-01T12:00:00Z,125.75,shipped`,
  ].join("\n");
  fs.writeFileSync(
    path.join(testDataDir, "orders-invalid.csv"),
    invalidRowsContent,
  );
  console.log(
    "Generated CSV: test-data/orders-invalid.csv (contains valid & invalid rows)",
  );

  // 3. Invalid header CSV (misspelled column header)
  const invalidHeaderContent = [
    "order_id,customer_id,order_date,order_amout,status",
    `${randomUUID()},CUST_001,2026-10-01T10:00:00Z,499.99,completed`,
  ].join("\n");
  fs.writeFileSync(
    path.join(testDataDir, "orders-invalid-header.csv"),
    invalidHeaderContent,
  );
  console.log(
    "Generated CSV: test-data/orders-invalid-header.csv (misspelled header)",
  );

  // 4. Duplicate orders CSV
  const sharedUUID1 = randomUUID();
  const sharedUUID2 = randomUUID();
  const duplicateRowsContent = [
    "order_id,customer_id,order_date,order_amount,status",
    `${sharedUUID1},CUST_001,2026-10-01T10:00:00Z,100.00,completed`,
    `${sharedUUID1},CUST_001,2026-10-01T10:00:00Z,100.00,completed`,
    `${sharedUUID2},CUST_002,2026-10-01T11:00:00Z,200.00,completed`,
    `${sharedUUID2},CUST_002,2026-10-01T11:00:00Z,200.00,completed`,
    `${randomUUID()},CUST_003,2026-10-01T12:00:00Z,300.00,completed`,
  ].join("\n");
  fs.writeFileSync(
    path.join(testDataDir, "orders-duplicates.csv"),
    duplicateRowsContent,
  );
  console.log(
    "Generated CSV: test-data/orders-duplicates.csv (contains duplicate order_ids)",
  );

  // 5. 10,000 rows CSV for Performance / Streaming test
  await generateCustomCsv(
    path.join(testDataDir, "orders-10000.csv"),
    10000,
    500,
    0,
    0,
  );

  console.log(
    "\nAll CSV files generated successfully in test-data/ (0 database connections made).",
  );
}

main().catch((err) => {
  console.error("Error generating CSVs:", err);
  process.exit(1);
});
