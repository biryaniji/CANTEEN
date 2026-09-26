const assert = require('assert');
const http = require('http');
const db = require('../db/database');
const { seed } = require('../db/seed');
const orderService = require('../services/orderService');
const stockService = require('../services/stockService');

async function runTests() {
  console.log('--- STARTING MASTERS UNION CANTEEN VERIFICATION SUITE ---');

  // 1. Reset and Seed Database
  console.log('1. Seeding fresh database for testing...');
  await seed(true);

  // 2. Test Atomic Stock Reservation Under Concurrency
  console.log('2. Testing concurrent atomic checkout on scarce stock...');
  // Find an item and set its stock to 1
  const scarceItem = await db.get(`SELECT * FROM menu_items WHERE vendor_id = 'cds' AND stock_qty > 0 LIMIT 1`);
  await db.run(`UPDATE menu_items SET stock_qty = 1 WHERE id = ?`, [scarceItem.id]);

  const attempts = 5;
  const results = await Promise.allSettled(
    Array.from({ length: attempts }).map((_, idx) =>
      orderService.checkoutCart({
        studentId: `student_concurrent_${idx}`,
        studentName: `Student ${idx}`,
        cartItems: [{ itemId: scarceItem.id, qty: 1 }],
        pickupSlot: 'ASAP'
      })
    )
  );

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');

  console.log(`   Concurrent checkout results: ${fulfilled.length} succeeded, ${rejected.length} failed.`);
  assert.strictEqual(fulfilled.length, 1, 'Exactly one order should succeed for 1 unit of stock');
  assert.strictEqual(rejected.length, 4, 'Four orders should be rejected due to stock depletion');

  const afterItem = await db.get(`SELECT stock_qty FROM menu_items WHERE id = ?`, [scarceItem.id]);
  assert.strictEqual(afterItem.stock_qty, 0, 'Stock must now be exactly 0 (no oversell)');
  console.log('   ✓ Atomic reservation verified: 0 oversell!');

  // 3. Test Pre-Booking for Out-of-Stock Item
  console.log('3. Testing out-of-stock pre-booking...');
  // Find item with stock=0 and eta!=null (e.g. Chole Bhature or Samosa)
  let oosItem = await db.get(`SELECT * FROM menu_items WHERE stock_qty = 0 AND restock_eta_minutes IS NOT NULL LIMIT 1`);
  if (!oosItem) {
    await db.run(`UPDATE menu_items SET stock_qty = 0, restock_eta_minutes = 20 WHERE id = 2`);
    oosItem = await db.get(`SELECT * FROM menu_items WHERE id = 2`);
  }

  const prebookOrders = [];
  // Place 2 pre-booked orders
  for (let i = 1; i <= 2; i++) {
    const orders = await orderService.checkoutCart({
      studentId: `student_prebook_${i}`,
      studentName: `Prebooker ${i}`,
      cartItems: [{ itemId: oosItem.id, qty: 1 }],
      pickupSlot: 'ASAP'
    });
    assert.strictEqual(orders[0].status, 'queued', 'Prebooked order must have status queued');
    prebookOrders.push(orders[0]);
  }
  console.log(`   ✓ Successfully queued ${prebookOrders.length} pre-booked orders.`);

  // 4. Test FIFO Auto-Release on Vendor Restock
  console.log('4. Testing FIFO auto-release on vendor restock...');
  // Restock exactly 1 unit of oosItem. Only order 1 should be released; order 2 must remain queued!
  const restock1 = await stockService.updateStockQty({
    itemId: oosItem.id,
    vendorId: oosItem.vendor_id,
    delta: 1,
    reason: 'test_restock_1'
  });

  const checkOrder1 = await orderService.getOrderById(prebookOrders[0].id);
  const checkOrder2 = await orderService.getOrderById(prebookOrders[1].id);

  assert.strictEqual(checkOrder1.status, 'preparing', 'First order should be automatically flipped to preparing');
  assert.strictEqual(checkOrder2.status, 'queued', 'Second order must remain queued due to insufficient stock');
  console.log('   ✓ Partial fulfillment correctly kept order #2 queued!');

  // Restock 1 more unit -> order 2 should now be released
  await stockService.updateStockQty({
    itemId: oosItem.id,
    vendorId: oosItem.vendor_id,
    delta: 1,
    reason: 'test_restock_2'
  });
  const checkOrder2After = await orderService.getOrderById(prebookOrders[1].id);
  assert.strictEqual(checkOrder2After.status, 'preparing', 'Second order must now flip to preparing');
  console.log('   ✓ Second order released after additional stock added!');

  // 5. Test Status Lifecycle and units_sold_today Counting
  console.log('5. Testing order status progression and units_sold_today...');
  // Advance checkOrder1: preparing -> ready -> collected
  const testItem = await db.get(`SELECT * FROM menu_items WHERE id = ?`, [oosItem.id]);
  const soldBefore = testItem.units_sold_today;

  const readyOrder = await orderService.advanceOrderStatus({ orderId: checkOrder1.id, vendorId: oosItem.vendor_id });
  assert.strictEqual(readyOrder.status, 'ready');

  // Sold count should NOT have changed yet
  const itemAtReady = await db.get(`SELECT units_sold_today FROM menu_items WHERE id = ?`, [oosItem.id]);
  assert.strictEqual(itemAtReady.units_sold_today, soldBefore, 'Sold count must NOT increment before collected');

  const collectedOrder = await orderService.advanceOrderStatus({ orderId: checkOrder1.id, vendorId: oosItem.vendor_id });
  assert.strictEqual(collectedOrder.status, 'collected');

  const itemAtCollected = await db.get(`SELECT units_sold_today FROM menu_items WHERE id = ?`, [oosItem.id]);
  assert.strictEqual(itemAtCollected.units_sold_today, soldBefore + 1, 'Sold count MUST increment by order qty at collected');
  console.log('   ✓ units_sold_today strictly increments ONLY on collected!');

  // 6. Test Cancellation Stock Release
  console.log('6. Testing order cancellation releases stock...');
  const newOrder = await orderService.checkoutCart({
    studentId: 'student_cancel_test',
    studentName: 'Cancel Tester',
    cartItems: [{ itemId: 6, qty: 2 }], // Masala Chai
    pickupSlot: 'ASAP'
  });
  const chaiBefore = await db.get(`SELECT stock_qty FROM menu_items WHERE id = 6`);
  await orderService.cancelOrder({ orderId: newOrder[0].id, actorId: 'student_cancel_test', actorRole: 'student' });
  const chaiAfter = await db.get(`SELECT stock_qty FROM menu_items WHERE id = 6`);
  assert.strictEqual(chaiAfter.stock_qty, chaiBefore.stock_qty + 2, 'Stock must be returned on cancellation');
  console.log('   ✓ Cancelled order returned reserved stock to counter!');

  // 7. Verify Stock Ledger Audit Trail
  console.log('7. Verifying stock ledger audit records...');
  const ledgerEntries = await db.all(`SELECT * FROM stock_ledger WHERE menu_item_id = ?`, [oosItem.id]);
  assert.ok(ledgerEntries.length >= 3, 'Ledger should record initial, restock, and auto-releases');
  console.log(`   ✓ Found ${ledgerEntries.length} ledger audit entries for item ${oosItem.id}.`);

  // 8. Test Vendor Menu Reset
  console.log('8. Testing vendor menu reset restores full capacity...');
  const resetRes = await stockService.resetVendorMenu('cds');
  assert.ok(resetRes.items.length > 0, 'Reset should return items');
  for (const item of resetRes.items) {
    assert.strictEqual(item.stock_qty, item.max_capacity, `Item ${item.name} stock must equal max capacity`);
    assert.strictEqual(item.restock_eta_minutes, null, `Item ${item.name} eta must be null`);
  }
  console.log(`   ✓ Successfully reset ${resetRes.items.length} items to full capacity for CDS!`);

  console.log('--- ALL BACKEND CONCURRENCY & BUSINESS LOGIC TESTS PASSED! ---');
}

if (require.main === module) {
  runTests()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Test failed:', err);
      process.exit(1);
    });
}

module.exports = { runTests };
