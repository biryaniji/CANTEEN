const db = require('../db/database');
const ledger = require('../db/ledger');
const wsService = require('./wsService');

// Clean payment boundary function
// Currently called immediately upon checkout. In future, gate behind payment webhook.
async function confirmOrder(orderId, tx = null) {
  // If we had payment processing, this is where payment status would be verified.
  // Today it confirms the order in the system.
  return { confirmed: true, orderId, timestamp: new Date().toISOString() };
}

// Generate human-friendly token like MU-430
async function generateToken(tx) {
  const row = await tx.get(
    `SELECT MAX(CAST(SUBSTR(id, 4) AS INTEGER)) as max_num FROM orders WHERE id LIKE 'MU-%'`
  );
  const maxNum = row && row.max_num ? parseInt(row.max_num, 10) : 429;
  return `MU-${maxNum + 1}`;
}

function timeStringToMinutes(str) {
  if (!str) return null;
  const s = str.trim().toLowerCase();
  const ampmMatch = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/);
  if (ampmMatch) {
    let h = parseInt(ampmMatch[1], 10);
    const m = parseInt(ampmMatch[2], 10);
    const ampm = ampmMatch[3];
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    return h * 60 + m;
  }
  const match24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    return parseInt(match24[1], 10) * 60 + parseInt(match24[2], 10);
  }
  return null;
}

function isSlotWithinOperationalHours(slot, openTime = '08:30', closeTime = '21:00') {
  if (!slot || slot === 'ASAP') return true;
  const slotMinutes = timeStringToMinutes(slot);
  if (slotMinutes === null) return true;

  const openMinutes = timeStringToMinutes(openTime) || (8 * 60 + 30);
  const closeMinutes = timeStringToMinutes(closeTime) || (21 * 60);

  return slotMinutes >= openMinutes && slotMinutes <= closeMinutes;
}

async function checkoutCart({ studentId, studentName = 'Kabir Ahuja', cartItems, pickupSlot = 'ASAP' }) {
  if (!cartItems || !cartItems.length) {
    throw new Error('Cart is empty');
  }

  return await db.withTransaction(async (tx) => {
    // Ensure student exists
    await tx.run(
      `INSERT OR IGNORE INTO students (id, name) VALUES (?, ?)`,
      [studentId, studentName]
    );

    // Fetch all items from DB
    const itemIds = cartItems.map(c => c.itemId);
    const placeholders = itemIds.map(() => '?').join(',');
    const dbItems = await tx.all(
      `SELECT * FROM menu_items WHERE id IN (${placeholders})`,
      itemIds
    );
    const itemMap = new Map(dbItems.map(i => [i.id, i]));

    // Group cart items by vendor
    const vendorGroups = {};
    for (const c of cartItems) {
      const item = itemMap.get(c.itemId);
      if (!item) throw new Error(`Item ${c.itemId} not found`);
      if (!vendorGroups[item.vendor_id]) vendorGroups[item.vendor_id] = [];
      vendorGroups[item.vendor_id].push({ ...c, item });
    }

    const createdOrders = [];
    const stockUpdatesToBroadcast = [];

    // Create one order per vendor
    for (const [vendorId, lines] of Object.entries(vendorGroups)) {
      // Validate pickup slot against vendor operational hours
      const vRec = await tx.get(`SELECT * FROM vendors WHERE id = ?`, [vendorId]);
      if (vRec && !isSlotWithinOperationalHours(pickupSlot, vRec.open_time, vRec.close_time)) {
        throw new Error(
          `Pickup time "${pickupSlot}" is outside ${vRec.name}'s operational hours (${vRec.open_time || '08:30'} – ${vRec.close_time || '21:00'}).`
        );
      }

      // Check if any item in this vendor's subcart is out of stock (pre-booking)
      let isQueued = false;
      for (const line of lines) {
        if (line.item.stock_qty === 0) {
          if (line.item.restock_eta_minutes === null) {
            throw new Error(`Item "${line.item.name}" is sold out and cannot be ordered or pre-booked.`);
          }
          isQueued = true;
        }
      }

      const status = isQueued ? 'queued' : 'placed';
      const orderId = await generateToken(tx);

      let totalAmount = 0;
      for (const line of lines) {
        totalAmount += line.item.price * line.qty;

        if (!isQueued) {
          // ATOMIC STOCK RESERVATION
          // Conditional update: must have enough stock, otherwise fail
          const res = await tx.run(
            `UPDATE menu_items
             SET stock_qty = stock_qty - ?
             WHERE id = ? AND stock_qty >= ?`,
            [line.qty, line.item.id, line.qty]
          );

          if (res.changes === 0) {
            const currentItem = await tx.get(`SELECT * FROM menu_items WHERE id = ?`, [line.item.id]);
            throw new Error(`Insufficient stock for "${line.item.name}". Only ${currentItem.stock_qty} left.`);
          }

          const updatedItem = await tx.get(`SELECT * FROM menu_items WHERE id = ?`, [line.item.id]);
          await ledger.logStockChange({
            menuItemId: line.item.id,
            vendorId,
            delta: -line.qty,
            newStock: updatedItem.stock_qty,
            reason: 'order_reserved',
            referenceOrderId: orderId,
            tx
          });

          stockUpdatesToBroadcast.push(updatedItem);
        }
      }

      // Insert order record
      await tx.run(
        `INSERT INTO orders (id, student_id, vendor_id, status, pickup_slot, total_amount)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [orderId, studentId, vendorId, status, pickupSlot, totalAmount]
      );

      // Insert order items
      for (const line of lines) {
        await tx.run(
          `INSERT INTO order_items (order_id, menu_item_id, qty, unit_price_at_order_time)
           VALUES (?, ?, ?, ?)`,
          [orderId, line.item.id, line.qty, line.item.price]
        );
      }

      // Clean payment confirmation seam
      await confirmOrder(orderId, tx);

      const orderData = await getOrderByIdInternal(orderId, tx);
      createdOrders.push(orderData);
    }

    // Broadcast WebSocket updates after transaction completes
    for (const order of createdOrders) {
      wsService.broadcastToVendor(order.vendor_id, 'ORDER_CREATED', order);
      wsService.broadcastToStudent(order.student_id, 'ORDER_CREATED', order);
    }

    for (const item of stockUpdatesToBroadcast) {
      wsService.broadcastToAll('STOCK_UPDATED', { item });
    }

    return createdOrders;
  });
}

async function getOrderByIdInternal(orderId, dbOrTx = db) {
  const order = await dbOrTx.get(
    `SELECT o.*, v.name as vendor_name, v.emoji as vendor_emoji, s.name as student_name
     FROM orders o
     JOIN vendors v ON o.vendor_id = v.id
     JOIN students s ON o.student_id = s.id
     WHERE o.id = ?`,
    [orderId]
  );
  if (!order) return null;

  const items = await dbOrTx.all(
    `SELECT oi.id, oi.menu_item_id, oi.qty, oi.unit_price_at_order_time,
            mi.name, mi.emoji, mi.category
     FROM order_items oi
     JOIN menu_items mi ON oi.menu_item_id = mi.id
     WHERE oi.order_id = ?`,
    [orderId]
  );

  return {
    ...order,
    lines: items.map(i => ({
      i: i.menu_item_id,
      q: i.qty,
      p: i.unit_price_at_order_time,
      n: i.name,
      e: i.emoji
    }))
  };
}

async function getOrderById(orderId) {
  return await getOrderByIdInternal(orderId, db);
}

async function getOrdersByStudent(studentId) {
  const orders = await db.all(
    `SELECT o.*, v.name as vendor_name, v.emoji as vendor_emoji
     FROM orders o
     JOIN vendors v ON o.vendor_id = v.id
     WHERE o.student_id = ?
     ORDER BY o.placed_at DESC`,
    [studentId]
  );

  if (!orders.length) return [];

  const orderIds = orders.map(o => o.id);
  const placeholders = orderIds.map(() => '?').join(',');
  const allLines = await db.all(
    `SELECT oi.order_id, oi.menu_item_id as i, oi.qty as q, oi.unit_price_at_order_time as p,
            mi.name as n, mi.emoji as e, mi.image_url as img
     FROM order_items oi
     JOIN menu_items mi ON oi.menu_item_id = mi.id
     WHERE oi.order_id IN (${placeholders})`,
    orderIds
  );

  const linesByOrder = {};
  for (const l of allLines) {
    if (!linesByOrder[l.order_id]) linesByOrder[l.order_id] = [];
    linesByOrder[l.order_id].push({
      i: l.i,
      q: l.q,
      p: l.p,
      n: l.n,
      e: l.e,
      img: l.img
    });
  }

  return orders.map(o => ({
    id: o.id,
    v: o.vendor_id,
    vendor_name: o.vendor_name,
    vendor_emoji: o.vendor_emoji,
    total: o.total_amount,
    status: o.status,
    slot: o.pickup_slot,
    mine: true,
    lines: linesByOrder[o.id] || [],
    placed_at: o.placed_at,
    status_updated_at: o.status_updated_at
  }));
}

async function getOrdersByVendor(vendorId, statusFilter = null) {
  let sql = `
    SELECT o.*, s.name as student_name
    FROM orders o
    JOIN students s ON o.student_id = s.id
    WHERE o.vendor_id = ?
  `;
  const params = [vendorId];

  if (statusFilter === 'active') {
    sql += ` AND o.status IN ('queued','placed','preparing','ready')`;
  } else if (statusFilter) {
    sql += ` AND o.status = ?`;
    params.push(statusFilter);
  }
  sql += ` ORDER BY o.placed_at ASC`;

  const orders = await db.all(sql, params);
  if (!orders.length) return [];

  const orderIds = orders.map(o => o.id);
  const placeholders = orderIds.map(() => '?').join(',');
  const allLines = await db.all(
    `SELECT oi.order_id, oi.menu_item_id as i, oi.qty as q, oi.unit_price_at_order_time as p,
            mi.name as n, mi.emoji as e, mi.image_url as img
     FROM order_items oi
     JOIN menu_items mi ON oi.menu_item_id = mi.id
     WHERE oi.order_id IN (${placeholders})`,
    orderIds
  );

  const linesByOrder = {};
  for (const l of allLines) {
    if (!linesByOrder[l.order_id]) linesByOrder[l.order_id] = [];
    linesByOrder[l.order_id].push({
      i: l.i,
      q: l.q,
      p: l.p,
      n: l.n,
      e: l.e,
      img: l.img
    });
  }

  return orders.map(o => ({
    id: o.id,
    v: o.vendor_id,
    total: o.total_amount,
    status: o.status,
    slot: o.pickup_slot,
    who: o.student_name,
    student_id: o.student_id,
    lines: linesByOrder[o.id] || [],
    placed_at: o.placed_at,
    status_updated_at: o.status_updated_at
  }));
}

// Vendor-only order status advance
async function advanceOrderStatus({ orderId, vendorId }) {
  return await db.withTransaction(async (tx) => {
    const order = await tx.get(
      `SELECT * FROM orders WHERE id = ? AND vendor_id = ?`,
      [orderId, vendorId]
    );

    if (!order) {
      throw new Error(`Order ${orderId} not found for vendor ${vendorId}`);
    }

    const stateTransitions = {
      placed: 'preparing',
      preparing: 'ready',
      ready: 'collected'
    };

    const nextStatus = stateTransitions[order.status];
    if (!nextStatus) {
      throw new Error(`Cannot advance order ${orderId} from status "${order.status}"`);
    }

    // If moving to collected, increment units_sold_today strictly at this transition
    if (nextStatus === 'collected') {
      const lines = await tx.all(
        `SELECT menu_item_id, qty FROM order_items WHERE order_id = ?`,
        [orderId]
      );
      for (const line of lines) {
        await tx.run(
          `UPDATE menu_items SET units_sold_today = units_sold_today + ? WHERE id = ?`,
          [line.qty, line.menu_item_id]
        );
      }
    }

    await tx.run(
      `UPDATE orders SET status = ?, status_updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [nextStatus, orderId]
    );

    const updated = await getOrderByIdInternal(orderId, tx);

    // WebSocket notify
    wsService.broadcastToStudent(order.student_id, 'ORDER_STATUS_CHANGED', {
      orderId,
      oldStatus: order.status,
      newStatus: nextStatus,
      order: updated
    });
    wsService.broadcastToVendor(vendorId, 'ORDER_STATUS_CHANGED', {
      orderId,
      oldStatus: order.status,
      newStatus: nextStatus,
      order: updated
    });

    return updated;
  });
}

// Cancellation logic
async function cancelOrder({ orderId, actorId, actorRole }) {
  return await db.withTransaction(async (tx) => {
    const order = await tx.get(`SELECT * FROM orders WHERE id = ?`, [orderId]);
    if (!order) throw new Error(`Order ${orderId} not found`);

    if (actorRole === 'vendor' && order.vendor_id !== actorId) {
      throw new Error(`Unauthorized to cancel order for another vendor`);
    }
    if (actorRole === 'student' && order.student_id !== actorId) {
      throw new Error(`Unauthorized to cancel order for another student`);
    }

    if (order.status === 'collected' || order.status === 'cancelled') {
      throw new Error(`Order ${orderId} cannot be cancelled (current status: ${order.status})`);
    }

    // Release stock only if the order was NOT queued (since queued orders held no stock)
    if (order.status !== 'queued') {
      const lines = await tx.all(
        `SELECT menu_item_id, qty FROM order_items WHERE order_id = ?`,
        [orderId]
      );

      for (const line of lines) {
        await tx.run(
          `UPDATE menu_items SET stock_qty = stock_qty + ? WHERE id = ?`,
          [line.qty, line.menu_item_id]
        );

        const refreshed = await tx.get(`SELECT stock_qty FROM menu_items WHERE id = ?`, [line.menu_item_id]);
        await ledger.logStockChange({
          menuItemId: line.menu_item_id,
          vendorId: order.vendor_id,
          delta: line.qty,
          newStock: refreshed.stock_qty,
          reason: 'order_cancelled',
          referenceOrderId: orderId,
          tx
        });

        wsService.broadcastToAll('STOCK_UPDATED', { item: refreshed });
      }
    }

    await tx.run(
      `UPDATE orders SET status = 'cancelled', status_updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [orderId]
    );

    const updated = await getOrderByIdInternal(orderId, tx);

    wsService.broadcastToStudent(order.student_id, 'ORDER_STATUS_CHANGED', {
      orderId,
      oldStatus: order.status,
      newStatus: 'cancelled',
      order: updated
    });
    wsService.broadcastToVendor(order.vendor_id, 'ORDER_STATUS_CHANGED', {
      orderId,
      oldStatus: order.status,
      newStatus: 'cancelled',
      order: updated
    });

    return updated;
  });
}

module.exports = {
  checkoutCart,
  confirmOrder,
  getOrderById,
  getOrdersByStudent,
  getOrdersByVendor,
  advanceOrderStatus,
  cancelOrder
};
