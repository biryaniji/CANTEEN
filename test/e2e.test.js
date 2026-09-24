const http = require('http');
const WebSocket = require('ws');
const assert = require('assert');

async function testE2E() {
  console.log('Testing E2E Endpoints and Realtime Synchronization...');

  // 1. Connect WebSocket
  const ws = new WebSocket('ws://localhost:3000/realtime?scope=vendor:cds,student:student_kabir');
  const receivedEvents = [];

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
    ws.on('message', data => {
      const parsed = JSON.parse(data);
      receivedEvents.push(parsed);
    });
  });

  console.log('✓ WebSocket connected to localhost:3000/realtime');

  // 2. Multi-stall Checkout: 1 item from CDS (id: 1) and 1 item from Chai Adda (id: 6)
  console.log('Placing multi-stall cart checkout...');
  const postData = JSON.stringify({
    studentId: 'student_kabir',
    studentName: 'Kabir Ahuja',
    cartItems: [
      { itemId: 1, qty: 1 }, // CDS
      { itemId: 6, qty: 1 }  // Chai Adda
    ],
    pickupSlot: 'ASAP'
  });

  const checkoutRes = await new Promise((resolve, reject) => {
    const req = http.request('http://localhost:3000/api/cart/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'x-student-id': 'student_kabir'
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });

  assert.ok(checkoutRes.success, 'Checkout should succeed');
  assert.strictEqual(checkoutRes.orders.length, 2, 'Should split into exactly 2 vendor orders');
  console.log(`✓ Cart split verified: Orders created ${checkoutRes.orders.map(o=>o.id).join(' and ')}`);

  const cdsOrder = checkoutRes.orders.find(o => o.vendor_id === 'cds');
  const chaiOrder = checkoutRes.orders.find(o => o.vendor_id === 'chai');
  assert.ok(cdsOrder && chaiOrder);

  // 3. Advance CDS Order: placed -> preparing -> ready -> collected
  console.log(`Advancing CDS order ${cdsOrder.id} status...`);
  const advanceRes1 = await new Promise((resolve, reject) => {
    const req = http.request(`http://localhost:3000/api/orders/${cdsOrder.id}/advance`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-vendor-id': 'cds'
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.write(JSON.stringify({ vendorId: 'cds' }));
    req.end();
  });
  assert.strictEqual(advanceRes1.order.status, 'preparing');
  console.log(`✓ Order advanced to preparing`);

  // Wait a bit for WS messages
  await new Promise(r => setTimeout(r, 600));

  console.log(`Total WebSocket events captured: ${receivedEvents.length}`);
  const eventTypes = receivedEvents.map(e => e.type);
  assert.ok(eventTypes.includes('ORDER_CREATED'), 'Should have received ORDER_CREATED over WS');
  assert.ok(eventTypes.includes('ORDER_STATUS_CHANGED'), 'Should have received ORDER_STATUS_CHANGED over WS');
  console.log('✓ Real-time WebSocket event dispatch verified!');

  ws.close();
  console.log('--- ALL E2E VERIFICATION CHECKS PASSED! ---');
}

testE2E()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('E2E test failed:', err);
    process.exit(1);
  });
