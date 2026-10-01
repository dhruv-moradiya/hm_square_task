# PostgreSQL Application-Level Sharding Infrastructure

This project implements a backend application-level PostgreSQL sharding infrastructure using Node.js, TypeScript, Express, and Docker Compose.

---

## 1. System Architecture

```text
                           +------------------------+
                           |   Express Application  |
                           | (http://localhost:3000)|
                           +-----------+------------+
                                       |
                                       v
                           +------------------------+
                           |      Shard Router      |
                           |  hash(customer_id) % 3 |
                           +-----------+------------+
                                       |
                   +-------------------+-------------------+
                   |                   |                   |
         customer_id mod 3 = 0 customer_id mod 3 = 1 customer_id mod 3 = 2
                   |                   |                   |
                   v                   v                   v
           +---------------+   +---------------+   +---------------+
           |    Shard 0    |   |    Shard 1    |   |    Shard 2    |
           |   PostgreSQL  |   |   PostgreSQL  |   |   PostgreSQL  |
           |  (Port: 5433) |   |  (Port: 5434) |   |  (Port: 5435) |
           |  orders DB    |   |  orders DB    |   |  orders DB    |
           +---------------+   +---------------+   +---------------+
```

### Application-Level Sharding vs Database Table Partitioning

- **Database Table Partitioning**: Managed by a single database instance which divides large tables into smaller physical tables on the same server or storage engine.
- **Application-Level Sharding (Implemented here)**: The application itself determines which independent database instance to write to or read from based on the shard key (`customer_id`). Each shard runs as a completely isolated PostgreSQL database instance with its own compute resources, connection pool, and persistent storage.

---

## 2. Sharding Strategy

We use **application-level sharding** with `customer_id` as the **shard key**.

### Routing Formula

```text
shard_id = sha256(customer_id) % numberOfShards (3)
```

The application hashes the customer ID using a deterministic hash function (`SHA-256`) and computes the modulo over the total number of shards (3).

The result determines which PostgreSQL instance (`Shard 0`, `Shard 1`, or `Shard 2`) stores the customer's orders. This guarantees that all orders belonging to the same customer are consistently routed to and stored on the exact same database shard.

### Advantages

- **Simple and Deterministic Routing**: Routing requires no centralized coordinator or lookup table; the shard is computed in microseconds directly in memory.
- **Single-Shard Targeted Queries**: Any query filtered by `customer_id` (e.g. fetching customer order history) only hits one database shard, avoiding cross-database overhead.
- **Horizontal Scalability**: Write throughput, read capacity, and disk storage are split across multiple independent PostgreSQL server instances.

### Trade-offs

- **Resharding Complexity**: Adding or removing shards changes the hash modulo mapping, requiring a data migration/rebalancing strategy (or consistent hashing).
- **Cross-Shard (Scatter-Gather) Queries**: Queries without a `customer_id` (e.g., global metrics, cross-customer search) require querying all shards in parallel and aggregating the results in application memory.
- **Hotspots**: If a single customer generates a massive volume of orders, that single shard may experience higher load than others.

---

## 3. Database Schema & Design Decisions

All three shards have the identical `orders` table schema initialized automatically on startup via [database/schema.sql](file:///d:/projects/hm_square_task/database/schema.sql):

```sql
CREATE TABLE IF NOT EXISTS orders (
    id BIGSERIAL PRIMARY KEY,
    order_id UUID NOT NULL UNIQUE,
    customer_id VARCHAR(100) NOT NULL,
    order_date TIMESTAMPTZ NOT NULL,
    order_amount NUMERIC(12, 2) NOT NULL,
    status VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_date ON orders(order_date);
```

### Rationale:

- **`customer_id` Indexed**: Since `customer_id` is our shard key, queries within a shard frequently filter by customer. A B-Tree index enables fast logarithmic lookups ($O(\log N)$) for customer order history.
- **`order_date` Indexed**: Optimizes time-range queries (e.g., fetching orders placed between specific dates) and chronological sorting (`ORDER BY order_date DESC`).
- **`order_id` Unique Constraint**: Prevents duplicate order records and ensures idempotency at the database level.
- **`NUMERIC(12, 2)` for Monetary Values**: Floating-point types (`FLOAT`, `DOUBLE`) suffer from binary floating-point representation errors (e.g., `0.1 + 0.2 = 0.30000000000000004`). `NUMERIC(12, 2)` provides exact fixed-point decimal arithmetic required for financial amounts up to $9,999,999,999.99$.
- **`TIMESTAMPTZ` for Timestamps**: PostgreSQL's `TIMESTAMPTZ` stores UTC timestamps with timezone awareness, avoiding ambiguities caused by client or server local daylight savings time or timezone differences.

---

## 4. Docker Networking & Port Mapping

Each PostgreSQL container runs an independent instance of PostgreSQL 16 on its default internal port `5432`:

| Container Name | Internal Port | Host Port | Database | Volume Name |
| :--- | :--- | :--- | :--- | :--- |
| `postgres-shard-0` | `5432` | `5433` | `orders` | `postgres-shard-0-data` |
| `postgres-shard-1` | `5432` | `5434` | `orders` | `postgres-shard-1-data` |
| `postgres-shard-2` | `5432` | `5435` | `orders` | `postgres-shard-2-data` |

### Why Host Ports Are Different

On the host machine network interface (`localhost`), multiple processes cannot bind to the same port. To allow the Node.js application running on the host machine to communicate with each container independently, we map each container's internal port `5432` to unique host ports (`5433`, `5434`, and `5435`).

---

## 5. Getting Started

### Prerequisites

- Node.js (v20+)
- pnpm (v10+)
- Docker & Docker Compose

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Configure Environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

### 3. Start PostgreSQL Shard Containers

```bash
docker compose up -d
```

Verify that all 3 containers are running:

```bash
docker ps
```

You should see:
- `postgres-shard-0` (0.0.0.0:5433->5432/tcp)
- `postgres-shard-1` (0.0.0.0:5434->5432/tcp)
- `postgres-shard-2` (0.0.0.0:5435->5432/tcp)

### 4. Start the Express Development Server

```bash
pnpm dev
```

Output on startup:
```text
Connecting to PostgreSQL shards...
Shard 0: Connected (localhost:5433/orders)
Shard 1: Connected (localhost:5434/orders)
Shard 2: Connected (localhost:5435/orders)

Server running on http://localhost:3000
Health check: http://localhost:3000/health
```

---

## 6. Endpoints & Verification

### 1. Health Check
```bash
curl http://localhost:3000/health
```
Response:
```json
{
  "status": "ok"
}
```

### 2. Upload Orders CSV Endpoint
```bash
curl -X POST http://localhost:3000/upload-orders \
  -F "file=@test-data/orders-valid.csv"
```
Response:
```json
{
  "message": "Orders file processed successfully",
  "totalRows": 25,
  "validRows": 25,
  "invalidRows": 0,
  "insertedRows": 25,
  "duplicateRows": 0,
  "errors": []
}
```

### 3. Get Orders by Customer ID (Single-Shard Targeted Query)
```bash
curl "http://localhost:3000/orders?customerId=CUST_0001"
```
Response:
```json
{
  "customerId": "CUST_0001",
  "shardId": 1,
  "totalCount": 23,
  "count": 23,
  "orders": [
    {
      "id": "1",
      "order_id": "92054636-15a9-4b8d-ba47-c356935a4717",
      "customer_id": "CUST_0001",
      "order_date": "2026-10-01T12:00:00.000Z",
      "order_amount": "299.95",
      "status": "completed",
      "created_at": "2026-10-01T12:09:40.123Z"
    }
  ]
}
```

### 4. Get Order by Order ID (Scatter-Gather Query Across Shards)
```bash
curl http://localhost:3000/orders/92054636-15a9-4b8d-ba47-c356935a4717
```
Response:
```json
{
  "shardId": 1,
  "order": {
    "id": "1",
    "order_id": "92054636-15a9-4b8d-ba47-c356935a4717",
    "customer_id": "CUST_0001",
    "order_date": "2026-10-01T12:00:00.000Z",
    "order_amount": "299.95",
    "status": "completed",
    "created_at": "2026-10-01T12:09:40.123Z"
  }
}
```

### 5. Run Automated Verification Tests

We provide a built-in automated verification script:

```bash
pnpm test:shards
```

This script:
1. Generates 100 orders across 20 distinct customers.
2. Routes each order via `ShardRouter` and writes to the correct shard.
3. Queries each PostgreSQL container independently.
4. Asserts that 100% of customer orders reside exclusively on their mapped shard with 0 cross-shard leakage.

---

## 7. CSV Streaming, Validation & Batch Insert Architecture

### Pipeline Flow

```text
POST /upload-orders (multipart/form-data)
                 │
                 ▼
       Busboy Multipart Stream
                 │ (Pipes file stream without loading in RAM)
                 ▼
       @fast-csv/parse Stream
                 │
                 ├──► 1. Header Validation (order_id, customer_id, order_date, order_amount, status)
                 │
                 ▼
       Row-by-Row Validation (UUID, Date, Numeric Amount > 0, Non-empty Strings)
                 │
                 ├──► Invalid Rows: Skipped & logged to validation error list (up to 100 details)
                 │
                 ▼
       Batch Accumulation (Configurable DB_BATCH_SIZE, default 500)
                 │
                 ├──► [Backpressure]: Stream paused when batch is full
                 │
                 ▼
       Shard Grouping (Group rows by Shard 0, Shard 1, Shard 2 using customer_id)
                 │
                 ▼
       PostgreSQL Transactions (per shard)
                 │
                 ├──► BEGIN
                 ├──► Multi-Row Parameterized INSERT with ON CONFLICT (order_id) DO NOTHING
                 ├──► COMMIT (or ROLLBACK on error)
                 │
                 ▼
       [Backpressure]: Resume Stream & repeat until end-of-file
                 │
                 ▼
       Return Upload Summary JSON (totalRows, validRows, invalidRows, insertedRows, duplicateRows, errors)
```

### Why These Patterns Are Used

1. **Node.js Streams (`busboy` + `@fast-csv/parse`)**:
   - **Memory Efficiency ($O(\text{batch\_size})$ vs $O(\text{file\_size})$)**: The entire CSV file is never loaded into memory as a `Buffer` or string. Even for files with millions of rows, memory usage remains strictly bounded.
2. **Backpressure Handling**:
   - When the batch buffer reaches `DB_BATCH_SIZE` (default: 500), `parser.pause()` stops pulling chunks from the underlying network upload stream. Once the database transactions commit, `parser.resume()` allows the stream to continue. This prevents memory leaks and database connection exhaustion.
3. **Batch Inserts**:
   - Replaces thousands of single-row network round trips with multi-row parameterized queries (e.g. `VALUES ($1, ...), ($6, ...)`), improving throughput by over 50x.
4. **PostgreSQL Transactions per Shard**:
   - Uses dedicated clients checked out from connection pools (`client = await pool.connect()`). Each shard batch executes within its own `BEGIN ... COMMIT` block. If an error occurs, `ROLLBACK` guarantees clean transactional isolation.
5. **Shard Grouping**:
   - Respects application-level sharding by routing each row to its deterministic shard (`sha256(customer_id) % 3`).
6. **Duplicate Handling (`ON CONFLICT (order_id) DO NOTHING`)**:
   - Prevents duplicate order records from causing batch rollbacks while accurately reporting `duplicateRows` in the response summary.

---

## 8. CSV Upload Endpoints & Testing

### 1. Upload CSV Orders Endpoint
```bash
curl -X POST http://localhost:3000/upload-orders \
  -F "file=@test-data/orders-valid.csv"
```

Response:
```json
{
  "message": "Orders file processed successfully",
  "totalRows": 25,
  "validRows": 25,
  "invalidRows": 0,
  "insertedRows": 25,
  "duplicateRows": 0,
  "errors": []
}
```

### 2. Run Complete CSV Test Suite
```bash
pnpm test:csv
```

Runs tests for:
- Non-CSV file rejection (400 Bad Request)
- Invalid header rejection (400 Bad Request)
- Invalid row skipping with validation error tracking
- Duplicate `order_id` handling
- 10,000-order streaming and batch performance test
- Shard distribution verification across all 3 databases
