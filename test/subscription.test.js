const http = require('http');
const assert = require('assert');
const WebSocket = require('ws');
const { app, server } = require('../server');
const db = require('../db/database');
const { seed } = require('../db/seed');

// Helper to make HTTP requests
function request(port, path, options = {}, data = null) {
  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: 'localhost',
      port,
      path,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    let postBody = null;
    if (data) {
      postBody = typeof data === 'string' ? data : JSON.stringify(data);
      reqOptions.headers['Content-Type'] = 'application/json';
      reqOptions.headers['Content-Length'] = Buffer.byteLength(postBody);
    }

    const req = http.request(reqOptions, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, text: body });
        }
      });
    });

    req.on('error', reject);
    if (postBody) req.write(postBody);
    req.end();
  });
}

async function runSubscriptionTests() {
  console.log('--- STARTING STORE SUBSCRIPTION TEST SUITE ---');

  // Ensure DB initialized and seeded
  await db.initSchema();
  await seed(false);

  // Start test server on dynamic free port if server is not already listening
  let testServer = server;
  let port = 3000;
  let didStartServer = false;

  if (!server.listening) {
    await new Promise((resolve) => {
      server.listen(0, () => {
        port = server.address().port;
        didStartServer = true;
        resolve();
      });
    });
    console.log(`✓ Started ephemeral test server on port ${port}`);
  } else {
    port = server.address().port || 3000;
  }

  try {
    // 1. Connect WebSocket to verify realtime broadcast of subscription events
    const ws = new WebSocket(`ws://localhost:${port}/realtime?scope=vendor:cds,student:student_kabir`);
    const wsEvents = [];
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
      ws.on('message', data => {
        try {
          wsEvents.push(JSON.parse(data));
        } catch (e) {}
      });
    });
    console.log('✓ WebSocket connected for subscription event verification');

    // 2. GET /api/subscriptions - Fetch all active plans
    console.log('1. Testing GET /api/subscriptions (all active plans)...');
    const allRes = await request(port, '/api/subscriptions');
    assert.strictEqual(allRes.status, 200);
    assert.ok(allRes.body.success);
    assert.ok(Array.isArray(allRes.body.subscriptions));
    assert.ok(allRes.body.subscriptions.length >= 1, 'Should have initial seeded subscriptions');
    console.log(`✓ Fetched ${allRes.body.subscriptions.length} active subscription plans`);

    // 3. GET /api/subscriptions with vendorId filter
    console.log('2. Testing GET /api/subscriptions?vendorId=cds...');
    const cdsRes = await request(port, '/api/subscriptions?vendorId=cds');
    assert.strictEqual(cdsRes.status, 200);
    assert.ok(cdsRes.body.subscriptions.every(s => s.vendor_id === 'cds' || s.v === 'cds'));
    console.log(`✓ Verified vendor filter: ${cdsRes.body.subscriptions.length} plans for CDS Canteen`);

    // 4. POST /api/vendors/cds/subscriptions - Vendor creates new subscription plan
    console.log('3. Testing POST /api/vendors/cds/subscriptions (Create plan)...');
    const newPlanPayload = {
      name: 'Weekly CDS Super Snack Pass',
      period: 'weekly',
      price: 499,
      description: 'Fresh evening snacks and filter coffee daily at the ground floor counter. Flash pass to redeem.',
      itemsIncluded: '1 Samosa/Dosa + 1 Beverage daily',
      isVeg: 1,
      emoji: '🥞'
    };

    const createRes = await request(port, '/api/vendors/cds/subscriptions', {
      method: 'POST'
    }, newPlanPayload);

    assert.strictEqual(createRes.status, 201);
    assert.ok(createRes.body.success);
    assert.ok(createRes.body.plan.id);
    assert.strictEqual(createRes.body.plan.name, newPlanPayload.name);
    assert.strictEqual(createRes.body.plan.description, newPlanPayload.description);
    const createdPlanId = createRes.body.plan.id;
    console.log(`✓ Created plan ID ${createdPlanId}: ${createRes.body.plan.name}`);

    // 5. PUT /api/vendors/cds/subscriptions/:id - Vendor updates plan description & price
    console.log('4. Testing PUT /api/vendors/cds/subscriptions/:id (Update plan description)...');
    const updatedDesc = 'Updated offline redemption: Flash pass at CDS Canteen counter. Skip the line instantly.';
    const updateRes = await request(port, `/api/vendors/cds/subscriptions/${createdPlanId}`, {
      method: 'PUT'
    }, {
      ...newPlanPayload,
      price: 520,
      description: updatedDesc
    });

    assert.strictEqual(updateRes.status, 200);
    assert.ok(updateRes.body.success);
    assert.strictEqual(updateRes.body.plan.price, 520);
    assert.strictEqual(updateRes.body.plan.description, updatedDesc);
    console.log('✓ Successfully updated plan price and description');

    // 6. PATCH /api/vendors/cds/subscriptions/:id/toggle - Toggle active status
    console.log('5. Testing PATCH /api/vendors/cds/subscriptions/:id/toggle (Pause plan)...');
    const toggleRes = await request(port, `/api/vendors/cds/subscriptions/${createdPlanId}/toggle`, {
      method: 'PATCH'
    });
    assert.strictEqual(toggleRes.status, 200);
    assert.strictEqual(toggleRes.body.plan.active, 0, 'Plan should be paused');
    console.log('✓ Successfully paused plan (active = 0)');

    const resumeRes = await request(port, `/api/vendors/cds/subscriptions/${createdPlanId}/toggle`, {
      method: 'PATCH'
    });
    assert.strictEqual(resumeRes.status, 200);
    assert.strictEqual(resumeRes.body.plan.active, 1, 'Plan should be resumed');
    console.log('✓ Successfully resumed plan (active = 1)');

    // 7. POST /api/subscriptions/subscribe - Student subscribes to the plan
    console.log('6. Testing POST /api/subscriptions/subscribe (Student subscription)...');
    const subRes = await request(port, '/api/subscriptions/subscribe', {
      method: 'POST',
      headers: { 'x-student-id': 'student_kabir' }
    }, {
      studentId: 'student_kabir',
      studentName: 'Kabir Ahuja',
      planId: createdPlanId
    });

    assert.strictEqual(subRes.status, 200);
    assert.ok(subRes.body.success);
    assert.ok(subRes.body.subscription.id.startsWith('MU-SUB-'));
    assert.strictEqual(subRes.body.subscription.status, 'active');
    const subId = subRes.body.subscription.id;
    console.log(`✓ Student subscribed successfully! Generated Pass Token: ${subId}`);

    // 8. GET /api/subscriptions/mine - Student retrieves active passes
    console.log('7. Testing GET /api/subscriptions/mine...');
    const mineRes = await request(port, '/api/subscriptions/mine', {
      headers: { 'x-student-id': 'student_kabir' }
    });
    assert.strictEqual(mineRes.status, 200);
    assert.ok(mineRes.body.success);
    const foundSub = mineRes.body.subscriptions.find(s => s.id === subId);
    assert.ok(foundSub, 'Created subscription should be in student pass list');
    assert.strictEqual(foundSub.status, 'active');
    assert.ok(foundSub.days_left >= 6, 'Weekly pass should have 6-7 days left');
    console.log(`✓ Student active passes verified: ${foundSub.plan_name} (${foundSub.days_left}d remaining)`);

    // 9. GET /api/vendors/cds/subscribers - Vendor retrieves subscriber roster
    console.log('8. Testing GET /api/vendors/cds/subscribers...');
    const vendorSubsRes = await request(port, '/api/vendors/cds/subscribers');
    assert.strictEqual(vendorSubsRes.status, 200);
    assert.ok(vendorSubsRes.body.success);
    const subscriberInList = vendorSubsRes.body.subscribers.find(s => s.id === subId);
    assert.ok(subscriberInList, 'Subscribed student should be in vendor subscriber list');
    console.log(`✓ Vendor subscriber list verified: found ${subscriberInList.student_name}`);

    // 10. POST /api/subscriptions/mine/:id/renew - Student renews pass
    console.log('9. Testing POST /api/subscriptions/mine/:id/renew (Pass renewal)...');
    const renewRes = await request(port, `/api/subscriptions/mine/${subId}/renew`, {
      method: 'POST',
      headers: { 'x-student-id': 'student_kabir' }
    });
    assert.strictEqual(renewRes.status, 200);
    assert.ok(renewRes.body.success);
    assert.ok(renewRes.body.subscription.amount_paid > 520, 'Amount paid should increase upon renewal');
    console.log(`✓ Pass renewed successfully. Total amount paid: ₹${renewRes.body.subscription.amount_paid}`);

    // 11. PATCH /api/subscriptions/mine/:id/cancel - Student cancels pass
    console.log('10. Testing PATCH /api/subscriptions/mine/:id/cancel...');
    const cancelRes = await request(port, `/api/subscriptions/mine/${subId}/cancel`, {
      method: 'PATCH',
      headers: { 'x-student-id': 'student_kabir' }
    });
    assert.strictEqual(cancelRes.status, 200);
    assert.strictEqual(cancelRes.body.subscription.status, 'cancelled');
    console.log('✓ Student pass cancelled successfully');

    // 12. DELETE /api/vendors/cds/subscriptions/:id - Vendor deletes/deactivates the test plan
    console.log('11. Testing DELETE /api/vendors/cds/subscriptions/:id...');
    const deleteRes = await request(port, `/api/vendors/cds/subscriptions/${createdPlanId}`, {
      method: 'DELETE'
    });
    assert.strictEqual(deleteRes.status, 200);
    assert.ok(deleteRes.body.success);
    console.log('✓ Plan deleted/deactivated successfully');

    // Wait briefly for WS events
    await new Promise(r => setTimeout(r, 600));
    console.log(`Captured ${wsEvents.length} WebSocket real-time subscription events`);
    const eventTypes = wsEvents.map(e => e.type);
    assert.ok(eventTypes.includes('SUBSCRIPTION_PLAN_CREATED'), 'Should have received SUBSCRIPTION_PLAN_CREATED');
    assert.ok(eventTypes.includes('SUBSCRIPTION_CREATED'), 'Should have received SUBSCRIPTION_CREATED');
    console.log('✓ Realtime WebSocket subscription event dispatch verified!');

    ws.close();
    console.log('--- ALL STORE SUBSCRIPTION TESTS PASSED SUCCESSFULLY! ---');
  } finally {
    if (didStartServer) {
      await new Promise(resolve => server.close(resolve));
      console.log('✓ Ephemeral test server closed cleanly');
    }
  }
}

runSubscriptionTests()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Subscription tests failed:', err);
    process.exit(1);
  });
