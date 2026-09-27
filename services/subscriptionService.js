const db = require('../db/database');
const wsService = require('./wsService');

// Generate friendly subscription token like MU-SUB-101
async function generateSubscriptionId(tx) {
  const row = await tx.get(
    `SELECT MAX(CAST(SUBSTR(id, 8) AS INTEGER)) as max_num FROM student_subscriptions WHERE id LIKE 'MU-SUB-%'`
  );
  const maxNum = row && row.max_num ? parseInt(row.max_num, 10) : 100;
  return `MU-SUB-${maxNum + 1}`;
}

/**
 * Get all available subscription plans with vendor details
 */
async function getAllPlans({ vendorId = null, period = null, activeOnly = true } = {}) {
  let sql = `
    SELECT 
      vs.*,
      v.name as vendor_name,
      v.emoji as vendor_emoji,
      v.floor as vendor_floor,
      v.open as vendor_open,
      (SELECT COUNT(*) FROM student_subscriptions ss WHERE ss.plan_id = vs.id AND ss.status = 'active') as active_subscribers_count
    FROM vendor_subscriptions vs
    JOIN vendors v ON vs.vendor_id = v.id
    WHERE 1=1
  `;
  const params = [];

  if (activeOnly) {
    sql += ' AND vs.active = 1';
  }
  if (vendorId && vendorId !== 'all') {
    sql += ' AND vs.vendor_id = ?';
    params.push(vendorId);
  }
  if (period && period !== 'all') {
    sql += ' AND vs.period = ?';
    params.push(period);
  }

  sql += ' ORDER BY vs.vendor_id ASC, vs.period DESC, vs.price ASC';

  const rows = await db.all(sql, params);
  return rows;
}

/**
 * Get plan by ID
 */
async function getPlanById(id) {
  const sql = `
    SELECT 
      vs.*,
      v.name as vendor_name,
      v.emoji as vendor_emoji,
      v.floor as vendor_floor,
      v.open as vendor_open
    FROM vendor_subscriptions vs
    JOIN vendors v ON vs.vendor_id = v.id
    WHERE vs.id = ?
  `;
  return await db.get(sql, [id]);
}

/**
 * Vendor creates a new subscription plan
 */
async function createPlan(vendorId, { name, period, price, description, itemsIncluded = null, isVeg = 1, emoji = '🍱' }) {
  if (!vendorId) throw new Error('Vendor ID is required');
  if (!name || !name.trim()) throw new Error('Plan name is required');
  if (!['weekly', 'monthly'].includes(period)) throw new Error('Period must be either "weekly" or "monthly"');
  if (!price || isNaN(price) || price <= 0) throw new Error('Valid price is required');
  if (!description || !description.trim()) throw new Error('Description/detail is required');

  const v = await db.get('SELECT * FROM vendors WHERE id = ?', [vendorId]);
  if (!v) throw new Error('Vendor not found');

  const result = await db.run(
    `INSERT INTO vendor_subscriptions 
      (vendor_id, name, period, price, description, items_included, is_veg, emoji, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [vendorId, name.trim(), period, Math.round(price), description.trim(), itemsIncluded ? itemsIncluded.trim() : null, isVeg ? 1 : 0, emoji || '🍱']
  );

  const plan = await getPlanById(result.lastID);

  // Broadcast realtime event
  wsService.broadcastToAll('SUBSCRIPTION_PLAN_CREATED', { plan });

  return plan;
}

/**
 * Vendor toggles plan active status
 */
async function togglePlan(planId, vendorId) {
  const plan = await db.get('SELECT * FROM vendor_subscriptions WHERE id = ? AND vendor_id = ?', [planId, vendorId]);
  if (!plan) throw new Error('Subscription plan not found or vendor mismatch');

  const newActive = plan.active ? 0 : 1;
  await db.run('UPDATE vendor_subscriptions SET active = ? WHERE id = ?', [newActive, planId]);

  const updated = await getPlanById(planId);
  wsService.broadcastToAll('SUBSCRIPTION_PLAN_UPDATED', { plan: updated });
  return updated;
}

/**
 * Student subscribes to a weekly/monthly plan
 */
async function subscribeStudent({ studentId, studentName = 'Kabir Ahuja', planId }) {
  if (!studentId) throw new Error('Student ID is required');
  if (!planId) throw new Error('Plan ID is required');

  const plan = await getPlanById(planId);
  if (!plan) throw new Error('Subscription plan not found');
  if (!plan.active) throw new Error('This subscription plan is currently not accepting new subscribers');

  return await db.withTransaction(async (tx) => {
    // Ensure student exists
    await tx.run('INSERT OR IGNORE INTO students (id, name) VALUES (?, ?)', [studentId, studentName]);

    const subId = await generateSubscriptionId(tx);

    const now = new Date();
    const durationDays = plan.period === 'weekly' ? 7 : 30;
    const endDate = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const startDateStr = now.toISOString();
    const endDateStr = endDate.toISOString();

    await tx.run(
      `INSERT INTO student_subscriptions 
        (id, student_id, plan_id, vendor_id, status, start_date, end_date, amount_paid)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
      [subId, studentId, plan.id, plan.vendor_id, startDateStr, endDateStr, plan.price]
    );

    const createdSub = await tx.get(
      `SELECT ss.*, 
              vs.name as plan_name, vs.period, vs.description, vs.items_included, vs.emoji, vs.is_veg,
              v.name as vendor_name, v.emoji as vendor_emoji, v.floor as vendor_floor,
              s.name as student_name
       FROM student_subscriptions ss
       JOIN vendor_subscriptions vs ON ss.plan_id = vs.id
       JOIN vendors v ON ss.vendor_id = v.id
       JOIN students s ON ss.student_id = s.id
       WHERE ss.id = ?`,
      [subId]
    );

    // Realtime notification to vendor and student
    wsService.broadcastToVendor(plan.vendor_id, 'SUBSCRIPTION_CREATED', { subscription: createdSub, plan });
    wsService.broadcastToStudent(studentId, 'SUBSCRIPTION_CREATED', { subscription: createdSub, plan });

    return createdSub;
  });
}

/**
 * Get student's subscriptions
 */
async function getStudentSubscriptions(studentId) {
  const sql = `
    SELECT ss.*, 
           vs.name as plan_name, vs.period, vs.description, vs.items_included, vs.emoji, vs.is_veg,
           v.name as vendor_name, v.emoji as vendor_emoji, v.floor as vendor_floor,
           s.name as student_name,
           ROUND((julianday(ss.end_date) - julianday('now'))) as days_left
    FROM student_subscriptions ss
    JOIN vendor_subscriptions vs ON ss.plan_id = vs.id
    JOIN vendors v ON ss.vendor_id = v.id
    JOIN students s ON ss.student_id = s.id
    WHERE ss.student_id = ?
    ORDER BY CASE WHEN ss.status = 'active' THEN 0 ELSE 1 END, ss.end_date DESC
  `;
  const rows = await db.all(sql, [studentId]);
  return rows.map(r => ({
    ...r,
    days_left: Math.max(0, Math.ceil(r.days_left || 0)),
    is_active: r.status === 'active' && new Date(r.end_date) > new Date()
  }));
}

/**
 * Get vendor's subscribers
 */
async function getVendorSubscribers(vendorId) {
  const sql = `
    SELECT ss.*, 
           vs.name as plan_name, vs.period, vs.price as plan_price, vs.emoji,
           s.name as student_name,
           ROUND((julianday(ss.end_date) - julianday('now'))) as days_left
    FROM student_subscriptions ss
    JOIN vendor_subscriptions vs ON ss.plan_id = vs.id
    JOIN students s ON ss.student_id = s.id
    WHERE ss.vendor_id = ?
    ORDER BY CASE WHEN ss.status = 'active' THEN 0 ELSE 1 END, ss.start_date DESC
  `;
  const rows = await db.all(sql, [vendorId]);
  return rows.map(r => ({
    ...r,
    days_left: Math.max(0, Math.ceil(r.days_left || 0)),
    is_active: r.status === 'active' && new Date(r.end_date) > new Date()
  }));
}

/**
 * Cancel a student subscription
 */
async function cancelSubscription(subId, studentId) {
  const sub = await db.get(
    'SELECT * FROM student_subscriptions WHERE id = ? AND student_id = ?',
    [subId, studentId]
  );
  if (!sub) throw new Error('Subscription not found or unauthorized');

  await db.run(
    `UPDATE student_subscriptions SET status = 'cancelled' WHERE id = ?`,
    [subId]
  );

  const updated = await db.get('SELECT * FROM student_subscriptions WHERE id = ?', [subId]);
  wsService.broadcastToVendor(sub.vendor_id, 'SUBSCRIPTION_CANCELLED', { subId, studentId });
  return updated;
}

/**
 * Vendor updates an existing subscription plan
 */
async function updatePlan(planId, vendorId, { name, period, price, description, itemsIncluded, isVeg, emoji }) {
  const plan = await db.get('SELECT * FROM vendor_subscriptions WHERE id = ? AND vendor_id = ?', [planId, vendorId]);
  if (!plan) throw new Error('Subscription plan not found or vendor mismatch');

  const updatedName = name !== undefined ? name.trim() : plan.name;
  const updatedPeriod = period !== undefined ? period : plan.period;
  const updatedPrice = price !== undefined ? Math.round(Number(price)) : plan.price;
  const updatedDesc = description !== undefined ? description.trim() : plan.description;
  const updatedItems = itemsIncluded !== undefined ? (itemsIncluded ? itemsIncluded.trim() : null) : plan.items_included;
  const updatedVeg = isVeg !== undefined ? (isVeg ? 1 : 0) : plan.is_veg;
  const updatedEmoji = emoji !== undefined ? emoji : plan.emoji;

  await db.run(
    `UPDATE vendor_subscriptions 
     SET name = ?, period = ?, price = ?, description = ?, items_included = ?, is_veg = ?, emoji = ?
     WHERE id = ? AND vendor_id = ?`,
    [updatedName, updatedPeriod, updatedPrice, updatedDesc, updatedItems, updatedVeg, updatedEmoji, planId, vendorId]
  );

  const updated = await getPlanById(planId);
  wsService.broadcastToAll('SUBSCRIPTION_PLAN_UPDATED', { plan: updated });
  return updated;
}

/**
 * Vendor deletes or deactivates a subscription plan
 */
async function deletePlan(planId, vendorId) {
  const plan = await db.get('SELECT * FROM vendor_subscriptions WHERE id = ? AND vendor_id = ?', [planId, vendorId]);
  if (!plan) throw new Error('Subscription plan not found or vendor mismatch');

  // Check if there are active subscribers
  const activeSub = await db.get(
    `SELECT COUNT(*) as count FROM student_subscriptions WHERE plan_id = ? AND status = 'active'`,
    [planId]
  );
  if (activeSub && activeSub.count > 0) {
    // Soft deactivate so existing subscriber passes remain valid
    await db.run('UPDATE vendor_subscriptions SET active = 0 WHERE id = ?', [planId]);
  } else {
    await db.run('DELETE FROM vendor_subscriptions WHERE id = ?', [planId]);
  }

  wsService.broadcastToAll('SUBSCRIPTION_PLAN_UPDATED', { planId, deleted: true });
  return { success: true, planId };
}

/**
 * Renew an existing student subscription pass
 */
async function renewSubscription(subId, studentId) {
  const sub = await db.get(
    `SELECT ss.*, vs.period, vs.price, vs.name as plan_name, vs.active as plan_active
     FROM student_subscriptions ss
     JOIN vendor_subscriptions vs ON ss.plan_id = vs.id
     WHERE ss.id = ? AND ss.student_id = ?`,
    [subId, studentId]
  );
  if (!sub) throw new Error('Subscription not found');

  const durationDays = sub.period === 'weekly' ? 7 : 30;
  const now = new Date();
  const currentEnd = new Date(sub.end_date);
  const baseDate = (sub.status === 'active' && currentEnd > now) ? currentEnd : now;
  const newEnd = new Date(baseDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

  await db.run(
    `UPDATE student_subscriptions 
     SET status = 'active', end_date = ?, amount_paid = amount_paid + ?
     WHERE id = ?`,
    [newEnd.toISOString(), sub.price, subId]
  );

  const updated = await db.get(
    `SELECT ss.*, 
            vs.name as plan_name, vs.period, vs.description, vs.items_included, vs.emoji, vs.is_veg,
            v.name as vendor_name, v.emoji as vendor_emoji, v.floor as vendor_floor,
            s.name as student_name,
            ROUND((julianday(ss.end_date) - julianday('now'))) as days_left
     FROM student_subscriptions ss
     JOIN vendor_subscriptions vs ON ss.plan_id = vs.id
     JOIN vendors v ON ss.vendor_id = v.id
     JOIN students s ON ss.student_id = s.id
     WHERE ss.id = ?`,
    [subId]
  );

  wsService.broadcastToStudent(studentId, 'SUBSCRIPTION_CREATED', { subscription: updated });
  wsService.broadcastToVendor(sub.vendor_id, 'SUBSCRIPTION_CREATED', { subscription: updated });
  return updated;
}

module.exports = {
  getAllPlans,
  getPlanById,
  createPlan,
  updatePlan,
  deletePlan,
  togglePlan,
  subscribeStudent,
  renewSubscription,
  getStudentSubscriptions,
  getVendorSubscribers,
  cancelSubscription
};

