const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');

const db = require('./db/database');
const wsService = require('./services/wsService');
const orderService = require('./services/orderService');
const stockService = require('./services/stockService');
const subscriptionService = require('./services/subscriptionService');
const ledger = require('./db/ledger');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------- REST API ROUTES ----------------

// GET /api/vendors
app.get('/api/vendors', async (req, res) => {
  try {
    const vendors = await db.all('SELECT * FROM vendors');
    res.json({ success: true, vendors });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/items (all or filtered by vendor)
app.get('/api/items', async (req, res) => {
  try {
    const { vendorId } = req.query;
    let sql = 'SELECT * FROM menu_items';
    const params = [];
    if (vendorId) {
      sql += ' WHERE vendor_id = ?';
      params.push(vendorId);
    }
    sql += ' ORDER BY id ASC';
    const items = await db.all(sql, params);
    res.json({ success: true, items });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/vendors/:id/items
app.get('/api/vendors/:id/items', async (req, res) => {
  try {
    const items = await db.all(
      'SELECT * FROM menu_items WHERE vendor_id = ? ORDER BY id ASC',
      [req.params.id]
    );
    res.json({ success: true, items });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/cart/checkout
app.post('/api/cart/checkout', async (req, res) => {
  try {
    const studentId = req.headers['x-student-id'] || req.body.studentId || 'student_kabir';
    const studentName = req.body.studentName || 'Kabir Ahuja';
    const { cartItems, pickupSlot, paymentId, paymentMethod, paymentStatus } = req.body;

    if (!cartItems || !cartItems.length) {
      return res.status(400).json({ success: false, error: 'cartItems is required and must not be empty' });
    }

    const orders = await orderService.checkoutCart({
      studentId,
      studentName,
      cartItems,
      pickupSlot: pickupSlot || 'ASAP',
      paymentId,
      paymentMethod,
      paymentStatus
    });

    res.json({ success: true, orders });
  } catch (err) {
    const isConflict = err.message.includes('Insufficient stock');
    res.status(isConflict ? 409 : 400).json({ success: false, error: err.message });
  }
});

// POST /api/payment/create-order (Razorpay Sandbox Order API)
app.post('/api/payment/create-order', (req, res) => {
  try {
    const { amount, currency = 'INR', receipt, notes } = req.body;
    const rzpOrderId = 'order_sbx_' + Math.random().toString(36).substring(2, 12);
    res.json({
      success: true,
      order: {
        id: rzpOrderId,
        entity: 'order',
        amount: Math.round((Number(amount) || 0) * 100), // in paise
        amount_paid: 0,
        amount_due: Math.round((Number(amount) || 0) * 100),
        currency: currency.toUpperCase(),
        receipt: receipt || ('rcpt_' + Date.now()),
        status: 'created',
        attempts: 0,
        notes: notes || {},
        created_at: Math.floor(Date.now() / 1000)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/payment/verify (Razorpay Sandbox Signature Verification)
app.post('/api/payment/verify', (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, method } = req.body;
    const paymentId = razorpay_payment_id || ('pay_sbx_' + Math.random().toString(36).substring(2, 12));
    res.json({
      success: true,
      verified: true,
      payment_id: paymentId,
      order_id: razorpay_order_id,
      status: 'captured',
      method: method || 'UPI - Google Pay',
      message: 'Payment verified and captured via Razorpay Sandbox'
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/orders/mine
app.get('/api/orders/mine', async (req, res) => {
  try {
    const studentId = req.headers['x-student-id'] || req.query.studentId || 'student_kabir';
    const orders = await orderService.getOrdersByStudent(studentId);
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/vendors/:id/orders
app.get('/api/vendors/:id/orders', async (req, res) => {
  try {
    const vendorId = req.params.id;
    const { status } = req.query;
    const orders = await orderService.getOrdersByVendor(vendorId, status);
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/orders/:id/advance (Vendor-only)
app.patch('/api/orders/:id/advance', async (req, res) => {
  try {
    const orderId = req.params.id;
    const vendorId = req.headers['x-vendor-id'] || req.body.vendorId;
    if (!vendorId) {
      return res.status(400).json({ success: false, error: 'Vendor ID is required in headers (x-vendor-id) or body' });
    }

    const order = await orderService.advanceOrderStatus({ orderId, vendorId });
    res.json({ success: true, order });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// PATCH /api/orders/:id/cancel
app.patch('/api/orders/:id/cancel', async (req, res) => {
  try {
    const orderId = req.params.id;
    const studentId = req.headers['x-student-id'] || req.body.studentId;
    const vendorId = req.headers['x-vendor-id'] || req.body.vendorId;

    const actorId = vendorId || studentId || 'student_kabir';
    const actorRole = vendorId ? 'vendor' : 'student';

    const order = await orderService.cancelOrder({ orderId, actorId, actorRole });
    res.json({ success: true, order });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// PATCH /api/vendors/:id/items/:itemId/stock
app.patch('/api/vendors/:id/items/:itemId/stock', async (req, res) => {
  try {
    const vendorId = req.params.id;
    const itemId = parseInt(req.params.itemId, 10);
    const { delta, absolute, eta } = req.body;

    const result = await stockService.updateStockQty({
      itemId,
      vendorId,
      delta,
      absolute,
      eta
    });

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/vendors/:id/items/:itemId/refill
app.post('/api/vendors/:id/items/:itemId/refill', async (req, res) => {
  try {
    const vendorId = req.params.id;
    const itemId = parseInt(req.params.itemId, 10);
    const result = await stockService.refillItem(itemId, vendorId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/vendors/:id/items/:itemId/sellout
app.post('/api/vendors/:id/items/:itemId/sellout', async (req, res) => {
  try {
    const vendorId = req.params.id;
    const itemId = parseInt(req.params.itemId, 10);
    const eta = req.body.eta !== undefined ? req.body.eta : 15;
    const result = await stockService.markSoldOut(itemId, vendorId, eta);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/vendors/:id/reset-menu (Reset vendor menu to full capacity)
app.post('/api/vendors/:id/reset-menu', async (req, res) => {
  try {
    const vendorId = req.params.id;
    const result = await stockService.resetVendorMenu(vendorId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/vendors/:id/items (Publish new menu item)
app.post('/api/vendors/:id/items', async (req, res) => {
  try {
    const vendorId = req.params.id;
    const { name, price, stock, category, emoji, isVeg, imageUrl, image_url } = req.body;

    if (!name || price === undefined) {
      return res.status(400).json({ success: false, error: 'Name and price are required' });
    }

    const item = await stockService.createMenuItem(vendorId, {
      name,
      price,
      stock,
      category: category || 'Meals',
      emoji: emoji || 'ðŸ½ï¸',
      isVeg: isVeg !== undefined ? isVeg : 1,
      imageUrl: imageUrl || image_url || null
    });

    res.status(201).json({ success: true, item });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// DELETE /api/vendors/:id/items/:itemId (Delete menu item)
app.delete('/api/vendors/:id/items/:itemId', async (req, res) => {
  try {
    const vendorId = req.params.id;
    const itemId = parseInt(req.params.itemId, 10);
    const result = await stockService.deleteMenuItem(itemId, vendorId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/vendors/:id/sales (Historical and date-filtered sales report)
app.get('/api/vendors/:id/sales', async (req, res) => {
  try {
    const vendorId = req.params.id;
    // Default to today in local date
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const targetDate = req.query.date || todayStr;

    const v = await db.get('SELECT * FROM vendors WHERE id = ?', [vendorId]);
    if (!v) return res.status(404).json({ success: false, error: 'Vendor not found' });

    // Fetch all collected orders on targetDate
    const orders = await db.all(
      `SELECT o.*, s.name as student_name
       FROM orders o
       JOIN students s ON o.student_id = s.id
       WHERE o.vendor_id = ? AND DATE(o.placed_at) = ? AND o.status = 'collected'
       ORDER BY o.placed_at DESC`,
      [vendorId, targetDate]
    );

    let totalRevenue = 0;
    let totalItemsSold = 0;

    // Build 9 AM to 8 PM hourly slots
    const hourlyMap = {};
    for (let h = 8; h <= 21; h++) {
      const label = h > 12 ? `${h - 12} PM` : (h === 12 ? '12 PM' : `${h} AM`);
      hourlyMap[h] = { hour: label, h: String(h > 12 ? h - 12 : h), count: 0, revenue: 0 };
    }

    const itemSalesMap = {};
    const detailedOrders = [];

    // Batch query all line items for the collected orders
    let allLines = [];
    if (orders.length > 0) {
      const orderIds = orders.map(o => o.id);
      const placeholders = orderIds.map(() => '?').join(',');
      allLines = await db.all(
        `SELECT oi.*, mi.name as n, mi.emoji as e, mi.category as cat, mi.image_url as img
         FROM order_items oi
         JOIN menu_items mi ON oi.menu_item_id = mi.id
         WHERE oi.order_id IN (${placeholders})`,
        orderIds
      );
    }

    const linesByOrderId = {};
    for (const l of allLines) {
      if (!linesByOrderId[l.order_id]) linesByOrderId[l.order_id] = [];
      linesByOrderId[l.order_id].push(l);
    }

    for (const o of orders) {
      totalRevenue += o.total_amount;
      const orderDate = new Date(o.placed_at);
      const hour = orderDate.getHours();
      if (hourlyMap[hour]) {
        hourlyMap[hour].count += 1;
        hourlyMap[hour].revenue += o.total_amount;
      }

      const lines = linesByOrderId[o.id] || [];

      lines.forEach(l => {
        totalItemsSold += l.qty;
        if (!itemSalesMap[l.menu_item_id]) {
          itemSalesMap[l.menu_item_id] = { id: l.menu_item_id, n: l.n, e: l.e, cat: l.cat, img: l.img, sold: 0, revenue: 0 };
        }
        itemSalesMap[l.menu_item_id].sold += l.qty;
        itemSalesMap[l.menu_item_id].revenue += (l.unit_price_at_order_time * l.qty);
      });

      detailedOrders.push({
        ...o,
        lines
      });
    }

    const topSellers = Object.values(itemSalesMap).sort((a, b) => b.sold - a.sold);
    const hourlyBars = Object.values(hourlyMap).map(h => ({
      h: h.h,
      label: h.hour,
      v: h.count,
      revenue: h.revenue
    }));
    const maxHourly = Math.max(...hourlyBars.map(h => h.v), 1);
    hourlyBars.forEach(h => { h.peak = (h.v === maxHourly && h.v > 0); });

    const aov = orders.length ? Math.round(totalRevenue / orders.length) : 0;

    res.json({
      success: true,
      sales: {
        date: targetDate,
        vendor: v,
        totalRevenue,
        ordersCount: orders.length,
        aov,
        totalItemsSold,
        topSellers,
        hourlyBars,
        orders: detailedOrders,
        eodReport: {
          date: targetDate,
          stallName: v.name,
          settlementTotal: totalRevenue,
          ordersCollected: orders.length,
          unitsSold: totalItemsSold,
          status: targetDate === todayStr ? 'Trading Live' : 'Settled & Reconciled',
          paymentMethod: 'Campus Digital Wallet (100%)'
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/vendors/:id/sales/dates (Available historical dates)
app.get('/api/vendors/:id/sales/dates', async (req, res) => {
  try {
    const vendorId = req.params.id;
    const rows = await db.all(
      `SELECT DISTINCT DATE(placed_at) as date
       FROM orders
       WHERE vendor_id = ?
       ORDER BY date DESC`,
      [vendorId]
    );
    res.json({ success: true, dates: rows.map(r => r.date) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/vendors/:id/ledger
app.get('/api/vendors/:id/ledger', async (req, res) => {
  try {
    const vendorId = req.params.id;
    const entries = await ledger.getLedgerByVendor(vendorId);
    res.json({ success: true, ledger: entries });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------- SUBSCRIPTION ROUTES ----------------

// GET /api/subscriptions (all active plans, optionally filtered by vendorId or period)
app.get('/api/subscriptions', async (req, res) => {
  try {
    const { vendorId, period, all } = req.query;
    const plans = await subscriptionService.getAllPlans({
      vendorId,
      period,
      activeOnly: all !== 'true'
    });
    res.json({ success: true, subscriptions: plans, plans });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/vendors/:id/subscriptions
app.get('/api/vendors/:id/subscriptions', async (req, res) => {
  try {
    const vendorId = req.params.id;
    const plans = await subscriptionService.getAllPlans({ vendorId, activeOnly: false });
    res.json({ success: true, subscriptions: plans, plans });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/vendors/:id/subscriptions (Vendor creates a plan)
app.post('/api/vendors/:id/subscriptions', async (req, res) => {
  try {
    const vendorId = req.params.id;
    const { name, period, price, description, itemsIncluded, items_included, isVeg, is_veg, emoji } = req.body;
    const plan = await subscriptionService.createPlan(vendorId, {
      name,
      period,
      price,
      description,
      itemsIncluded: itemsIncluded || items_included,
      isVeg: isVeg !== undefined ? isVeg : (is_veg !== undefined ? is_veg : 1),
      emoji
    });
    res.status(201).json({ success: true, plan });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// PATCH /api/vendors/:id/subscriptions/:planId/toggle
app.patch('/api/vendors/:id/subscriptions/:planId/toggle', async (req, res) => {
  try {
    const vendorId = req.params.id;
    const planId = parseInt(req.params.planId, 10);
    const plan = await subscriptionService.togglePlan(planId, vendorId);
    res.json({ success: true, plan });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// PUT /api/vendors/:id/subscriptions/:planId (Vendor updates a plan)
app.put('/api/vendors/:id/subscriptions/:planId', async (req, res) => {
  try {
    const vendorId = req.params.id;
    const planId = parseInt(req.params.planId, 10);
    const { name, period, price, description, itemsIncluded, items_included, isVeg, is_veg, emoji } = req.body;
    const plan = await subscriptionService.updatePlan(planId, vendorId, {
      name,
      period,
      price,
      description,
      itemsIncluded: itemsIncluded || items_included,
      isVeg: isVeg !== undefined ? isVeg : (is_veg !== undefined ? is_veg : undefined),
      emoji
    });
    res.json({ success: true, plan });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// DELETE /api/vendors/:id/subscriptions/:planId (Vendor deletes/deactivates a plan)
app.delete('/api/vendors/:id/subscriptions/:planId', async (req, res) => {
  try {
    const vendorId = req.params.id;
    const planId = parseInt(req.params.planId, 10);
    const result = await subscriptionService.deletePlan(planId, vendorId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/vendors/:id/subscribers (Vendor views active subscribers)
app.get('/api/vendors/:id/subscribers', async (req, res) => {
  try {
    const vendorId = req.params.id;
    const subscribers = await subscriptionService.getVendorSubscribers(vendorId);
    res.json({ success: true, subscribers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/subscriptions/subscribe (Student subscribes to a plan)
app.post('/api/subscriptions/subscribe', async (req, res) => {
  try {
    const studentId = req.headers['x-student-id'] || req.body.studentId || 'student_kabir';
    const studentName = req.body.studentName || 'Kabir Ahuja';
    const { planId } = req.body;

    if (!planId) {
      return res.status(400).json({ success: false, error: 'planId is required' });
    }

    const subscription = await subscriptionService.subscribeStudent({
      studentId,
      studentName,
      planId: parseInt(planId, 10)
    });

    res.json({ success: true, subscription });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// GET /api/subscriptions/mine (Student's active & past subscriptions)
app.get('/api/subscriptions/mine', async (req, res) => {
  try {
    const studentId = req.headers['x-student-id'] || req.query.studentId || 'student_kabir';
    const subscriptions = await subscriptionService.getStudentSubscriptions(studentId);
    res.json({ success: true, subscriptions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/subscriptions/mine/:id/cancel
app.patch('/api/subscriptions/mine/:id/cancel', async (req, res) => {
  try {
    const studentId = req.headers['x-student-id'] || req.body.studentId || 'student_kabir';
    const subId = req.params.id;
    const subscription = await subscriptionService.cancelSubscription(subId, studentId);
    res.json({ success: true, subscription });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/subscriptions/mine/:id/renew (Student renews an active or past pass)
app.post('/api/subscriptions/mine/:id/renew', async (req, res) => {
  try {
    const studentId = req.headers['x-student-id'] || req.body.studentId || 'student_kabir';
    const subId = req.params.id;
    const subscription = await subscriptionService.renewSubscription(subId, studentId);
    res.json({ success: true, subscription });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Disable HTML caching so changes reflect immediately upon refresh
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  next();
});

// Explicit frontend routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'mu-canteen.html'));
});

app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'mu-canteen.html'));
});

app.get('/mu-canteen.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'mu-canteen.html'));
});

// Serve frontend single-page app fallback
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'mu-canteen.html'));
});

// ---------------- SERVER STARTUP ----------------
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

// Initialize WebSocket server
wsService.initWebSocket(server);

async function start() {
  await db.initSchema();
  // Check if seed needed
  const vendors = await db.all('SELECT id FROM vendors');
  if (!vendors.length) {
    const { seed } = require('./db/seed');
    await seed();
  } else {
    // Check if subscriptions need initial seed
    const subs = await db.all('SELECT id FROM vendor_subscriptions');
    if (!subs.length) {
      const { seed } = require('./db/seed');
      await seed();
    }
  }

  server.listen(PORT, () => {
    console.log(`Masters Union Canteen server running on http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  start().catch(console.error);
}

module.exports = { app, server, start };

