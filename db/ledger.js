const db = require('./database');

async function logStockChange({ menuItemId, vendorId, delta, newStock, reason, referenceOrderId = null, tx = null }) {
  const runner = tx ? tx.run : db.run;
  await runner(
    `INSERT INTO stock_ledger (menu_item_id, vendor_id, delta, new_stock, reason, reference_order_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [menuItemId, vendorId, delta, newStock, reason, referenceOrderId]
  );
}

async function getLedgerByVendor(vendorId, limit = 50) {
  return await db.all(
    `SELECT sl.*, mi.name as item_name, mi.emoji as item_emoji
     FROM stock_ledger sl
     JOIN menu_items mi ON sl.menu_item_id = mi.id
     WHERE sl.vendor_id = ?
     ORDER BY sl.created_at DESC
     LIMIT ?`,
    [vendorId, limit]
  );
}

module.exports = {
  logStockChange,
  getLedgerByVendor
};
