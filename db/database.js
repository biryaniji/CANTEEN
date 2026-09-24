const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, '..', 'canteen.db');

let dbInstance = null;

function getDb() {
  if (!dbInstance) {
    dbInstance = new sqlite3.Database(DB_PATH);
    dbInstance.run('PRAGMA journal_mode = WAL;');
    dbInstance.run('PRAGMA foreign_keys = ON;');
  }
  return dbInstance;
}

function run(sql, params = []) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  const db = getDb();
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

// Transaction helper with BEGIN IMMEDIATE for ACID atomic concurrency control
async function withTransaction(callback) {
  await run('BEGIN IMMEDIATE');
  try {
    const result = await callback({ run, get, all });
    await run('COMMIT');
    return result;
  } catch (err) {
    try {
      await run('ROLLBACK');
    } catch (rbErr) {
      console.error('Rollback error:', rbErr);
    }
    throw err;
  }
}

async function initSchema() {
  getDb();

  // vendors table
  await run(`
    CREATE TABLE IF NOT EXISTS vendors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL,
      floor TEXT NOT NULL,
      open INTEGER NOT NULL DEFAULT 1,
      prep INTEGER NOT NULL DEFAULT 10,
      open_time TEXT NOT NULL DEFAULT '08:30',
      close_time TEXT NOT NULL DEFAULT '21:00'
    )
  `);

  try { await run(`ALTER TABLE vendors ADD COLUMN open_time TEXT DEFAULT '08:30'`); } catch(e) {}
  try { await run(`ALTER TABLE vendors ADD COLUMN close_time TEXT DEFAULT '21:00'`); } catch(e) {}

  // menu_items table
  await run(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id TEXT NOT NULL REFERENCES vendors(id),
      name TEXT NOT NULL,
      emoji TEXT NOT NULL,
      price INTEGER NOT NULL,
      is_veg INTEGER NOT NULL DEFAULT 1,
      category TEXT NOT NULL,
      stock_qty INTEGER NOT NULL DEFAULT 0,
      max_capacity INTEGER NOT NULL DEFAULT 20,
      restock_eta_minutes INTEGER NULL,
      units_sold_today INTEGER NOT NULL DEFAULT 0,
      image_url TEXT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // students table
  await run(`
    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // orders table
  await run(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id),
      vendor_id TEXT NOT NULL REFERENCES vendors(id),
      status TEXT NOT NULL CHECK(status IN ('queued','placed','preparing','ready','collected','cancelled')),
      pickup_slot TEXT NOT NULL,
      total_amount INTEGER NOT NULL,
      placed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status_updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // order_items table
  await run(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
      qty INTEGER NOT NULL,
      unit_price_at_order_time INTEGER NOT NULL
    )
  `);

  // stock_ledger table
  await run(`
    CREATE TABLE IF NOT EXISTS stock_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
      vendor_id TEXT NOT NULL REFERENCES vendors(id),
      delta INTEGER NOT NULL,
      new_stock INTEGER NOT NULL,
      reason TEXT NOT NULL,
      reference_order_id TEXT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Indexes for high performance
  await run(`CREATE INDEX IF NOT EXISTS idx_items_vendor ON menu_items(vendor_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_orders_student ON orders(student_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_orders_vendor ON orders(vendor_id, status)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_orders_placed_at ON orders(vendor_id, placed_at)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_ledger_item ON stock_ledger(menu_item_id)`);
}

module.exports = {
  getDb,
  run,
  get,
  all,
  withTransaction,
  initSchema
};
