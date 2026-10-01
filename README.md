# PostgreSQL Application-Level Sharding Backend

## 1. Sharding Architecture

- **3 PostgreSQL Shards**: Running on ports `5433` (Shard 0), `5434` (Shard 1), and `5435` (Shard 2).
- **Shard Key**: `customer_id`.
- **Routing Algorithm**: `sha256(customer_id) % 3` guarantees deterministic and uniform order distribution.
- **Transactions & Batching**: Orders are grouped by shard and inserted in configurable batches using PostgreSQL transactions with exponential backoff retries.
- **Idempotency**: Handled at the database level via `ON CONFLICT (order_id) DO NOTHING`.

## 2. Google Cloud & ADC Setup

- Authentication uses Google **Application Default Credentials (ADC)** with zero hardcoded secrets.
- Run `gcloud auth application-default login` for local development.
- Configure `GCS_BUCKET_NAME` and `GCP_PROJECT_ID` in your `.env`.

## 3. Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env

# 3. Start 3 PostgreSQL shard containers
docker compose up -d

# 4. Start the development server
pnpm dev
```

## 4. API Endpoints

- `POST /upload-orders` - Accepts multipart CSV orders file, validates rows, and streams batch inserts across shards.
- `GET /orders?customerId=CUST_001` - Single-shard targeted query for customer orders.
- `GET /orders/:orderId` - Scatter-gather lookup across all database shards.
- `GET /health` - Service health check (and `GET /health/gcs` for GCS status).

## 5. Testing

```bash
# Run all unit and integration tests
pnpm test

# Generate sample CSV datasets
pnpm generate:csv
```
