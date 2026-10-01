-- Orders table schema for application-level PostgreSQL shards
CREATE TABLE IF NOT EXISTS orders (
    id BIGSERIAL PRIMARY KEY,
    order_id UUID NOT NULL UNIQUE,
    customer_id VARCHAR(100) NOT NULL,
    order_date TIMESTAMPTZ NOT NULL,
    order_amount NUMERIC(12, 2) NOT NULL,
    status VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index on customer_id: Optimizes shard-level queries filtering by customer (our shard key)
CREATE INDEX IF NOT EXISTS idx_orders_customer_id
ON orders(customer_id);

-- Index on order_date: Optimizes chronological queries and date range analytics
CREATE INDEX IF NOT EXISTS idx_orders_order_date
ON orders(order_date);
