import { randomUUID } from 'node:crypto';
import { shardRouter } from '../src/database/shard-router.js';
import { shardManager } from '../src/database/shard-manager.js';

interface TestOrder {
  order_id: string;
  customer_id: string;
  order_date: string;
  order_amount: number;
  status: string;
}

async function runVerification() {
  console.log('='.repeat(60));
  console.log('PostgreSQL Sharding Verification Script');
  console.log('='.repeat(60));

  // Step 1: Test DB Connections
  await shardManager.testAllConnections();

  console.log('\n--- Step 1: Generating 100 Test Orders Across 20 Distinct Customers ---');
  // 20 distinct customers, 5 orders each = 100 orders
  const customers = Array.from({ length: 20 }, (_, i) => `CUST_${String(i + 1).padStart(3, '0')}`);
  const testOrders: TestOrder[] = [];

  for (let i = 0; i < 100; i++) {
    const customerId = customers[i % customers.length]!;
    testOrders.push({
      order_id: randomUUID(),
      customer_id: customerId,
      order_date: new Date(Date.now() - Math.floor(Math.random() * 10000000)).toISOString(),
      order_amount: parseFloat((Math.random() * 500 + 10).toFixed(2)),
      status: i % 2 === 0 ? 'completed' : 'pending',
    });
  }

  console.log(`Generated ${testOrders.length} orders for ${customers.length} unique customers.`);

  // Step 2: Insert each order through application-level routing
  console.log('\n--- Step 2: Inserting Orders via ShardRouter & ShardManager ---');
  let insertedCount = 0;

  for (const order of testOrders) {
    const { shardId, pool } = shardManager.getPoolForCustomer(order.customer_id);

    await pool.query(
      `INSERT INTO orders (order_id, customer_id, order_date, order_amount, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (order_id) DO NOTHING;`,
      [order.order_id, order.customer_id, order.order_date, order.order_amount, order.status]
    );

    insertedCount++;
  }

  console.log(`Successfully inserted ${insertedCount} orders.`);

  // Step 3: Query each shard container independently
  console.log('\n--- Step 3: Querying Each Shard Independently to Verify Distribution ---');

  const shardEntries = shardManager.getAllShardEntries();
  let allValid = true;

  for (const { shardId, config, pool } of shardEntries) {
    const totalRes = await pool.query('SELECT COUNT(*) AS total FROM orders;');
    const customerRes = await pool.query(
      'SELECT customer_id, COUNT(*) AS count FROM orders GROUP BY customer_id ORDER BY customer_id;'
    );

    const totalOrdersInShard = parseInt(totalRes.rows[0].total, 10);
    console.log(`\nShard ${shardId} (${config.host}:${config.port}/${config.database}):`);
    console.log(`  Total Orders in Shard: ${totalOrdersInShard}`);
    console.log(`  Unique Customers in Shard: ${customerRes.rows.length}`);

    // Verify that every single customer in this shard actually routes to this shard
    for (const row of customerRes.rows) {
      const computedShard = shardRouter.getShard(row.customer_id);
      const isCorrect = computedShard === shardId;
      if (!isCorrect) {
        console.error(`  [MISMATCH] Customer ${row.customer_id} is in Shard ${shardId}, but router computed Shard ${computedShard}!`);
        allValid = false;
      }
    }

    if (customerRes.rows.length > 0) {
      const sampleCustomers = customerRes.rows.slice(0, 5).map((r) => `${r.customer_id} (${r.count} orders)`).join(', ');
      console.log(`  Sample Customer Breakdown: ${sampleCustomers}`);
    }
  }

  // Step 4: Verify that no customer is split across multiple shards
  console.log('\n--- Step 4: Verifying Deterministic Routing (No Customer Partition Leaks) ---');
  for (const customerId of customers) {
    const targetShard = shardRouter.getShard(customerId);
    
    // Check all other shards to ensure 0 orders exist for this customer on non-target shards
    for (const { shardId, pool } of shardEntries) {
      if (shardId !== targetShard) {
        const leakCheck = await pool.query('SELECT COUNT(*) AS count FROM orders WHERE customer_id = $1;', [customerId]);
        const leakCount = parseInt(leakCheck.rows[0].count, 10);
        if (leakCount > 0) {
          console.error(`  [LEAK ERROR] Found ${leakCount} orders for ${customerId} on Shard ${shardId} (should only be on Shard ${targetShard})!`);
          allValid = false;
        }
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  if (allValid) {
    console.log('SUCCESS: All orders routed deterministically without leaks or data fragmentation!');
  } else {
    console.log('FAILURE: Sharding verification encountered integrity mismatches.');
  }
  console.log('='.repeat(60) + '\n');

  await shardManager.closeAll();
  process.exit(allValid ? 0 : 1);
}

runVerification().catch(async (err) => {
  console.error('Verification failed with error:', err);
  await shardManager.closeAll();
  process.exit(1);
});
