const db = require('../db/database');
const ledger = require('../db/ledger');
const wsService = require('./wsService');

async function updateStockQty({ itemId, vendorId, delta = null, absolute = null, eta = undefined, reason = 'vendor_restocked' }) {
  return await db.withTransaction(async (tx) => {
    const item = await tx.get(
      `SELECT * FROM menu_items WHERE id = ? AND vendor_id = ?`,
      [itemId, vendorId]
    );
    if (!item) {
      throw new Error(`Item ${itemId} not found for vendor ${vendorId}`);
    }

    let newStock;
    if (absolute !== null && absolute !== undefined) {
      newStock = Math.max(0, parseInt(absolute, 10));
    } else if (delta !== null && delta !== undefined) {
      newStock = Math.max(0, item.stock_qty + parseInt(delta, 10));
    } else {
      newStock = item.stock_qty;
    }

    const actualDelta = newStock - item.stock_qty;

    let newEta = item.restock_eta_minutes;
    if (eta !== undefined) {
      newEta = eta === 0 || eta === null ? null : parseInt(eta, 10);
    } else if (newStock > 0) {
      newEta = null; // Clearing ETA when restocked
    }

    await tx.run(
      `UPDATE menu_items
       SET stock_qty = ?, restock_eta_minutes = ?
       WHERE id = ?`,
      [newStock, newEta, itemId]
    );

    if (actualDelta !== 0) {
      await ledger.logStockChange({
        menuItemId: itemId,
        vendorId,
        delta: actualDelta,
        newStock,
        reason,
        tx
      });
    }

    // Now if stock was added, attempt FIFO auto-release of queued pre-orders
    let releasedOrders = [];
    if (actualDelta > 0) {
      releasedOrders = await releasePrebooksInternal({ itemId, tx });
    }

    const updatedItem = await tx.get(`SELECT * FROM menu_items WHERE id = ?`, [itemId]);

    // WebSocket Notifications
    wsService.broadcastToAll('STOCK_UPDATED', {
      item: updatedItem,
      releasedOrders
    });

    return { item: updatedItem, releasedOrders };
  });
}

// FIFO pre-book release walker within an active transaction
async function releasePrebooksInternal({ itemId, tx }) {
  const released = [];

  // Get current stock
  const currentItem = await tx.get(`SELECT stock_qty FROM menu_items WHERE id = ?`, [itemId]);
  let availableStock = currentItem.stock_qty;

  if (availableStock <= 0) return released;

  // Find all queued orders containing this item, ordered strictly FIFO by placed_at ASC
  const queuedOrders = await tx.all(
    `SELECT DISTINCT o.id, o.student_id, o.vendor_id, o.placed_at
     FROM orders o
     JOIN order_items oi ON o.id = oi.order_id
     WHERE o.status = 'queued' AND oi.menu_item_id = ?
     ORDER BY o.placed_at ASC, o.id ASC`,
    [itemId]
  );

  for (const o of queuedOrders) {
    // Check all items in this order to ensure all items have enough stock to satisfy the whole order
    const orderItems = await tx.all(
      `SELECT oi.menu_item_id, oi.qty, mi.stock_qty, mi.name
       FROM order_items oi
       JOIN menu_items mi ON oi.menu_item_id = mi.id
       WHERE oi.order_id = ?`,
      [o.id]
    );

    const canFulfill = orderItems.every(oi => {
      if (oi.menu_item_id === itemId) {
        return availableStock >= oi.qty;
      }
      return oi.stock_qty >= oi.qty;
    });

    if (canFulfill) {
      // Decrement stock for all items in the order
      for (const oi of orderItems) {
        if (oi.menu_item_id === itemId) {
          availableStock -= oi.qty;
          await tx.run(
            `UPDATE menu_items SET stock_qty = stock_qty - ? WHERE id = ?`,
            [oi.qty, oi.menu_item_id]
          );
        } else {
          await tx.run(
            `UPDATE menu_items SET stock_qty = stock_qty - ? WHERE id = ?`,
            [oi.qty, oi.menu_item_id]
          );
        }

        const refreshed = await tx.get(`SELECT stock_qty FROM menu_items WHERE id = ?`, [oi.menu_item_id]);
        await ledger.logStockChange({
          menuItemId: oi.menu_item_id,
          vendorId: o.vendor_id,
          delta: -oi.qty,
          newStock: refreshed.stock_qty,
          reason: 'prebook_auto_release',
          referenceOrderId: o.id,
          tx
        });
      }

      // Advance order status from queued to preparing
      await tx.run(
        `UPDATE orders
         SET status = 'preparing', status_updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [o.id]
      );

      released.push({
        orderId: o.id,
        studentId: o.student_id,
        vendorId: o.vendor_id
      });

      // WebSocket notifications for this released order
      wsService.broadcastToStudent(o.student_id, 'ORDER_STATUS_CHANGED', {
        orderId: o.id,
        oldStatus: 'queued',
        newStatus: 'preparing',
        note: 'Item restocked — order moved straight to cooking!'
      });
      wsService.broadcastToVendor(o.vendor_id, 'ORDER_STATUS_CHANGED', {
        orderId: o.id,
        oldStatus: 'queued',
        newStatus: 'preparing',
        note: 'Pre-booked order automatically released to preparing queue'
      });
    }

    if (availableStock <= 0) break;
  }

  return released;
}

async function refillItem(itemId, vendorId) {
  const item = await db.get(`SELECT * FROM menu_items WHERE id = ? AND vendor_id = ?`, [itemId, vendorId]);
  if (!item) throw new Error('Item not found');
  return await updateStockQty({
    itemId,
    vendorId,
    absolute: item.max_capacity,
    eta: null,
    reason: 'vendor_refill'
  });
}

async function markSoldOut(itemId, vendorId, eta = 15) {
  return await updateStockQty({
    itemId,
    vendorId,
    absolute: 0,
    eta: eta,
    reason: 'vendor_sellout'
  });
}

async function updateEta(itemId, vendorId, eta) {
  return await updateStockQty({
    itemId,
    vendorId,
    eta: eta,
    reason: 'eta_update'
  });
}

async function createMenuItem(vendorId, { name, price, stock, category, emoji, isVeg, imageUrl = null }) {
  return await db.withTransaction(async (tx) => {
    const stockQty = Math.max(0, parseInt(stock || 0, 10));
    const maxCap = Math.max(stockQty, 15);
    const eta = stockQty > 0 ? null : 15;

    const result = await tx.run(
      `INSERT INTO menu_items (vendor_id, name, emoji, price, is_veg, category, stock_qty, max_capacity, restock_eta_minutes, image_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [vendorId, name, emoji || '🍽️', parseInt(price, 10), isVeg ? 1 : 0, category, stockQty, maxCap, eta, imageUrl]
    );

    const newItem = await tx.get(`SELECT * FROM menu_items WHERE id = ?`, [result.lastID]);

    await ledger.logStockChange({
      menuItemId: newItem.id,
      vendorId,
      delta: stockQty,
      newStock: stockQty,
      reason: 'item_created',
      tx
    });

    wsService.broadcastToAll('ITEM_CREATED', { item: newItem });
    return newItem;
  });
}

async function resetVendorMenu(vendorId) {
  return await db.withTransaction(async (tx) => {
    const items = await tx.all(`SELECT * FROM menu_items WHERE vendor_id = ?`, [vendorId]);
    if (!items || !items.length) {
      throw new Error(`No items found for vendor ${vendorId}`);
    }

    const updatedItems = [];
    const allReleasedOrders = [];

    for (const item of items) {
      const targetStock = item.max_capacity || 20;
      const actualDelta = targetStock - item.stock_qty;

      await tx.run(
        `UPDATE menu_items
         SET stock_qty = ?, restock_eta_minutes = NULL
         WHERE id = ?`,
        [targetStock, item.id]
      );

      if (actualDelta !== 0) {
        await ledger.logStockChange({
          menuItemId: item.id,
          vendorId,
          delta: actualDelta,
          newStock: targetStock,
          reason: 'vendor_reset_menu',
          tx
        });
      }

      if (actualDelta > 0) {
        const released = await releasePrebooksInternal({ itemId: item.id, tx });
        allReleasedOrders.push(...released);
      }

      const updated = await tx.get(`SELECT * FROM menu_items WHERE id = ?`, [item.id]);
      updatedItems.push(updated);
    }

    wsService.broadcastToAll('VENDOR_MENU_RESET', {
      vendorId,
      items: updatedItems,
      releasedOrders: allReleasedOrders
    });

    return {
      vendorId,
      items: updatedItems,
      releasedOrders: allReleasedOrders
    };
  });
}

module.exports = {
  updateStockQty,
  refillItem,
  markSoldOut,
  updateEta,
  createMenuItem,
  resetVendorMenu
};
