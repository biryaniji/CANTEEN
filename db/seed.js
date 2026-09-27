const db = require('./database');
const ledger = require('./ledger');

const VENDORS = [
  { id: "cds", name: "CDS Canteen", emoji: "🍛", floor: "Ground Floor, CDS", open: 1, prep: 12, open_time: "08:30", close_time: "21:00" },
  { id: "chai", name: "Chai Adda", emoji: "☕", floor: "7th Floor Lounge", open: 1, prep: 5, open_time: "08:00", close_time: "22:00" },
  { id: "wrap", name: "Wrap Station", emoji: "🌯", floor: "Ground Floor, CDS", open: 1, prep: 9, open_time: "09:30", close_time: "21:30" },
  { id: "bake", name: "Bake House", emoji: "🥐", floor: "2nd Floor Atrium", open: 1, prep: 4, open_time: "09:00", close_time: "20:00" },
  { id: "juice", name: "Juice Bar", emoji: "🥤", floor: "7th Floor Lounge", open: 0, prep: 6, open_time: "09:00", close_time: "19:30" }
];

const ITEMS = [
  { id: 1, v: "cds", n: "Rajma Chawal", e: "🍛", p: 120, veg: 1, stock: 14, cap: 20, eta: null, cat: "Meals", sold: 26 },
  { id: 2, v: "cds", n: "Chole Bhature", e: "🫓", p: 110, veg: 1, stock: 0, cap: 18, eta: 20, cat: "Meals", sold: 18 },
  { id: 3, v: "cds", n: "Veg Thali", e: "🍱", p: 160, veg: 1, stock: 6, cap: 15, eta: null, cat: "Meals", sold: 11 },
  { id: 4, v: "cds", n: "Masala Dosa", e: "🥞", p: 100, veg: 1, stock: 3, cap: 16, eta: null, cat: "Meals", sold: 13 },
  { id: 5, v: "cds", n: "Curd Rice", e: "🍚", p: 80, veg: 1, stock: 9, cap: 14, eta: null, cat: "Meals", sold: 7 },
  { id: 6, v: "chai", n: "Masala Chai", e: "🍵", p: 25, veg: 1, stock: 40, cap: 60, eta: null, cat: "Drinks", sold: 88 },
  { id: 7, v: "chai", n: "Filter Coffee", e: "☕", p: 40, veg: 1, stock: 24, cap: 40, eta: null, cat: "Drinks", sold: 41 },
  { id: 8, v: "chai", n: "Samosa", e: "🥟", p: 20, veg: 1, stock: 0, cap: 30, eta: 10, cat: "Snacks", sold: 52 },
  { id: 9, v: "chai", n: "Maggi", e: "🍜", p: 60, veg: 1, stock: 12, cap: 20, eta: null, cat: "Snacks", sold: 19 },
  { id: 10, v: "chai", n: "Bun Maska", e: "🍞", p: 35, veg: 1, stock: 5, cap: 20, eta: null, cat: "Snacks", sold: 22 },
  { id: 11, v: "wrap", n: "Paneer Tikka Wrap", e: "🌯", p: 130, veg: 1, stock: 8, cap: 16, eta: null, cat: "Meals", sold: 15 },
  { id: 12, v: "wrap", n: "Chicken Shawarma", e: "🥙", p: 150, veg: 0, stock: 4, cap: 16, eta: null, cat: "Meals", sold: 21 },
  { id: 13, v: "wrap", n: "Falafel Bowl", e: "🥗", p: 140, veg: 1, stock: 0, cap: 12, eta: 35, cat: "Meals", sold: 6 },
  { id: 14, v: "bake", n: "Choco Croissant", e: "🥐", p: 90, veg: 1, stock: 7, cap: 14, eta: null, cat: "Bakery", sold: 9 },
  { id: 15, v: "bake", n: "Blueberry Muffin", e: "🧁", p: 80, veg: 1, stock: 2, cap: 14, eta: null, cat: "Bakery", sold: 12 },
  { id: 16, v: "bake", n: "Fudge Brownie", e: "🍫", p: 70, veg: 1, stock: 0, cap: 18, eta: 45, cat: "Bakery", sold: 24 },
  { id: 17, v: "juice", n: "Cold Coffee", e: "🥤", p: 90, veg: 1, stock: 15, cap: 20, eta: null, cat: "Drinks", sold: 17 },
  { id: 18, v: "juice", n: "Watermelon Juice", e: "🍉", p: 70, veg: 1, stock: 10, cap: 20, eta: null, cat: "Drinks", sold: 8 }
];

const STUDENTS = [
  { id: "student_kabir", name: "Kabir Ahuja" },
  { id: "student_ananya", name: "Ananya R." },
  { id: "student_dev", name: "Dev M." },
  { id: "student_ishita", name: "Ishita K." },
  { id: "student_rohan", name: "Rohan B." }
];

const SUBSCRIPTIONS = [
  {
    id: 1,
    v: "cds",
    name: "Monthly Unlimited Thali Pass",
    period: "monthly",
    price: 2800,
    is_veg: 1,
    emoji: "🍱",
    items_included: "1 Veg Thali or Rajma Chawal + Salad & Chaas daily (Mon-Sat)",
    description: "Daily wholesome offline lunch at CDS Canteen. Flash your pass at the billing counter to skip the queue."
  },
  {
    id: 2,
    v: "cds",
    name: "Weekly Lunch & Dosa Pass",
    period: "weekly",
    price: 720,
    is_veg: 1,
    emoji: "🥞",
    items_included: "Choice of Masala Dosa, Curd Rice, or Rajma Chawal daily",
    description: "7-day hot lunch meal plan. Valid Mon-Sun at CDS ground floor counter."
  },
  {
    id: 3,
    v: "chai",
    name: "Monthly Chai Adda Club",
    period: "monthly",
    price: 899,
    is_veg: 1,
    emoji: "🍵",
    items_included: "2 Cutting Masala Chais + 1 Hot Samosa daily",
    description: "Daily study fuel for the 7th floor lounge. Flash your active pass at the counter for instant chai."
  },
  {
    id: 4,
    v: "chai",
    name: "Weekly Coffee & Maggi Craver",
    period: "weekly",
    price: 360,
    is_veg: 1,
    emoji: "☕",
    items_included: "1 Filter Coffee + 1 Piping Hot Maggi daily",
    description: "7-day quick evening snack pass between lectures and committee meetings."
  },
  {
    id: 5,
    v: "wrap",
    name: "Monthly Fitness Wrap Plan",
    period: "monthly",
    price: 3400,
    is_veg: 0,
    emoji: "🌯",
    items_included: "1 Paneer Tikka or Chicken Shawarma Wrap daily",
    description: "High-protein campus lunch subscription. Freshly rolled and grilled at the CDS wrap counter."
  },
  {
    id: 6,
    v: "wrap",
    name: "Weekly Wrap Rush",
    period: "weekly",
    price: 890,
    is_veg: 1,
    emoji: "🥙",
    items_included: "1 Gourmet Wrap (Veg or Non-Veg) daily",
    description: "7-day grab-and-go wrap subscription. Fast-track pickup at the store counter."
  },
  {
    id: 7,
    v: "bake",
    name: "Weekly Morning Brew & Croissant",
    period: "weekly",
    price: 650,
    is_veg: 1,
    emoji: "🥐",
    items_included: "1 Butter or Choco Croissant + 1 Americano daily",
    description: "Start every morning right at the 2nd Floor Atrium before 10 AM lectures."
  },
  {
    id: 8,
    v: "bake",
    name: "Monthly Sweet Tooth Box",
    period: "monthly",
    price: 1800,
    is_veg: 1,
    emoji: "🧁",
    items_included: "1 Gourmet Muffin or Fudge Brownie Mon-Fri",
    description: "Afternoon sweet break Mon-Fri for the entire month at Bake House."
  },
  {
    id: 9,
    v: "juice",
    name: "Monthly Cold-Pressed Juice Plan",
    period: "monthly",
    price: 1750,
    is_veg: 1,
    emoji: "🍉",
    items_included: "1 Fresh Watermelon or Seasonal Juice or Cold Coffee daily",
    description: "Freshly squeezed vitamins and energy. Redeem at 7th floor Juice Bar offline counter."
  }
];

function generateSeedOrders() {
  const now = new Date();
  const fmt = (d, h = 12, m = 0) => {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hr = String(h).padStart(2, '0');
    const min = String(m).padStart(2, '0');
    return `${y}-${mo}-${day} ${hr}:${min}:00`;
  };

  const today = now;
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  return [
    // Today's orders
    { id: "MU-418", v: "cds", student: "student_ananya", lines: [{ i: 1, q: 1, p: 120 }, { i: 6, q: 1, p: 25 }], total: 145, status: "collected", slot: "12:30 PM", placed_at: fmt(today, 12, 10) },
    { id: "MU-421", v: "cds", student: "student_kabir", lines: [{ i: 3, q: 2, p: 160 }], total: 320, status: "collected", slot: "1:00 PM", placed_at: fmt(today, 12, 45) },
    { id: "MU-427", v: "cds", student: "student_kabir", lines: [{ i: 4, q: 1, p: 100 }, { i: 5, q: 1, p: 80 }], total: 180, status: "ready", slot: "ASAP", placed_at: fmt(today, 13, 15) },
    { id: "MU-429", v: "cds", student: "student_rohan", lines: [{ i: 1, q: 2, p: 120 }], total: 240, status: "placed", slot: "5:30 PM", placed_at: fmt(today, 13, 50) },
    { id: "MU-431", v: "chai", student: "student_dev", lines: [{ i: 6, q: 3, p: 25 }, { i: 8, q: 2, p: 20 }], total: 115, status: "collected", slot: "11:15 AM", placed_at: fmt(today, 11, 0) },
    { id: "MU-433", v: "cds", student: "student_ishita", lines: [{ i: 1, q: 1, p: 120 }], total: 120, status: "collected", slot: "2:00 PM", placed_at: fmt(today, 14, 10) },

    // Yesterday's orders (Collected)
    { id: "MU-380", v: "cds", student: "student_kabir", lines: [{ i: 1, q: 2, p: 120 }, { i: 5, q: 1, p: 80 }], total: 320, status: "collected", slot: "12:45 PM", placed_at: fmt(yesterday, 12, 30) },
    { id: "MU-382", v: "cds", student: "student_ananya", lines: [{ i: 3, q: 1, p: 160 }, { i: 4, q: 1, p: 100 }], total: 260, status: "collected", slot: "1:15 PM", placed_at: fmt(yesterday, 13, 0) },
    { id: "MU-385", v: "cds", student: "student_dev", lines: [{ i: 1, q: 1, p: 120 }, { i: 3, q: 1, p: 160 }], total: 280, status: "collected", slot: "1:45 PM", placed_at: fmt(yesterday, 13, 30) },
    { id: "MU-388", v: "cds", student: "student_ishita", lines: [{ i: 4, q: 2, p: 100 }], total: 200, status: "collected", slot: "2:15 PM", placed_at: fmt(yesterday, 14, 0) },
    { id: "MU-390", v: "cds", student: "student_rohan", lines: [{ i: 5, q: 2, p: 80 }], total: 160, status: "collected", slot: "3:30 PM", placed_at: fmt(yesterday, 15, 15) },
    { id: "MU-392", v: "chai", student: "student_kabir", lines: [{ i: 6, q: 2, p: 25 }, { i: 10, q: 1, p: 35 }], total: 85, status: "collected", slot: "4:00 PM", placed_at: fmt(yesterday, 15, 50) },
    { id: "MU-395", v: "cds", student: "student_ananya", lines: [{ i: 1, q: 3, p: 120 }], total: 360, status: "collected", slot: "7:00 PM", placed_at: fmt(yesterday, 18, 45) },

    // 2 Days ago orders (Collected)
    { id: "MU-350", v: "cds", student: "student_kabir", lines: [{ i: 3, q: 2, p: 160 }], total: 320, status: "collected", slot: "1:00 PM", placed_at: fmt(twoDaysAgo, 12, 45) },
    { id: "MU-352", v: "cds", student: "student_dev", lines: [{ i: 1, q: 2, p: 120 }], total: 240, status: "collected", slot: "1:30 PM", placed_at: fmt(twoDaysAgo, 13, 10) },
    { id: "MU-355", v: "cds", student: "student_rohan", lines: [{ i: 4, q: 2, p: 100 }, { i: 5, q: 1, p: 80 }], total: 280, status: "collected", slot: "2:00 PM", placed_at: fmt(twoDaysAgo, 13, 45) },
    { id: "MU-358", v: "chai", student: "student_ishita", lines: [{ i: 6, q: 4, p: 25 }, { i: 7, q: 2, p: 40 }], total: 180, status: "collected", slot: "4:30 PM", placed_at: fmt(twoDaysAgo, 16, 20) }
  ];
}

async function seed(force = false) {
  await db.initSchema();

  const existingVendors = await db.all('SELECT id FROM vendors');
  if (existingVendors.length > 0 && !force) {
    const existingSubs = await db.all('SELECT id FROM vendor_subscriptions');
    if (existingSubs.length === 0) {
      console.log('Seeding missing subscription plans...');
      for (const sub of SUBSCRIPTIONS) {
        await db.run(
          `INSERT OR REPLACE INTO vendor_subscriptions 
           (id, vendor_id, name, period, price, is_veg, emoji, items_included, description, active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [sub.id, sub.v, sub.name, sub.period, sub.price, sub.is_veg, sub.emoji, sub.items_included, sub.description]
        );
      }

      const now = new Date();
      const subEndDateKabir = new Date(now.getTime() + 24 * 24 * 60 * 60 * 1000).toISOString();
      const subStartDateKabir = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString();

      await db.run(
        `INSERT OR REPLACE INTO student_subscriptions
         (id, student_id, plan_id, vendor_id, status, start_date, end_date, amount_paid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['MU-SUB-101', 'student_kabir', 3, 'chai', 'active', subStartDateKabir, subEndDateKabir, 899]
      );

      const subEndDateDev = new Date(now.getTime() + 19 * 24 * 60 * 60 * 1000).toISOString();
      const subStartDateDev = new Date(now.getTime() - 11 * 24 * 60 * 60 * 1000).toISOString();

      await db.run(
        `INSERT OR REPLACE INTO student_subscriptions
         (id, student_id, plan_id, vendor_id, status, start_date, end_date, amount_paid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['MU-SUB-102', 'student_dev', 1, 'cds', 'active', subStartDateDev, subEndDateDev, 2800]
      );
      console.log('Subscriptions seeded successfully!');
    } else {
      console.log('Database already seeded. Skipping.');
    }
    return;
  }

  console.log('Seeding database...');

  // Clear existing data if forced
  if (force) {
    await db.run('DELETE FROM stock_ledger');
    await db.run('DELETE FROM order_items');
    await db.run('DELETE FROM orders');
    await db.run('DELETE FROM menu_items');
    await db.run('DELETE FROM students');
    await db.run('DELETE FROM vendors');
  }

  // Seed vendors
  for (const v of VENDORS) {
    await db.run(
      `INSERT OR REPLACE INTO vendors (id, name, emoji, floor, open, prep, open_time, close_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [v.id, v.name, v.emoji, v.floor, v.open, v.prep, v.open_time, v.close_time]
    );
  }

  // Seed menu items
  for (const it of ITEMS) {
    await db.run(
      `INSERT OR REPLACE INTO menu_items
       (id, vendor_id, name, emoji, price, is_veg, category, stock_qty, max_capacity, restock_eta_minutes, units_sold_today)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [it.id, it.v, it.n, it.e, it.p, it.veg, it.cat, it.stock, it.cap, it.eta, it.sold]
    );

    // Initial stock ledger entry
    await ledger.logStockChange({
      menuItemId: it.id,
      vendorId: it.v,
      delta: it.stock,
      newStock: it.stock,
      reason: 'initial_stock'
    });
  }

  // Seed students
  for (const s of STUDENTS) {
    await db.run(
      `INSERT OR REPLACE INTO students (id, name) VALUES (?, ?)`,
      [s.id, s.name]
    );
  }

  // Seed orders
  const ordersToSeed = generateSeedOrders();
  for (const o of ordersToSeed) {
    await db.run(
      `INSERT OR REPLACE INTO orders (id, student_id, vendor_id, status, pickup_slot, total_amount, placed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [o.id, o.student, o.v, o.status, o.slot, o.total, o.placed_at]
    );

    for (const l of o.lines) {
      await db.run(
        `INSERT INTO order_items (order_id, menu_item_id, qty, unit_price_at_order_time)
         VALUES (?, ?, ?, ?)`,
        [o.id, l.i, l.q, l.p]
      );
    }
  }

  // Seed vendor subscriptions
  for (const sub of SUBSCRIPTIONS) {
    await db.run(
      `INSERT OR REPLACE INTO vendor_subscriptions 
       (id, vendor_id, name, period, price, is_veg, emoji, items_included, description, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [sub.id, sub.v, sub.name, sub.period, sub.price, sub.is_veg, sub.emoji, sub.items_included, sub.description]
    );
  }

  // Seed student subscriptions (Kabir and Dev)
  const now = new Date();
  const subEndDateKabir = new Date(now.getTime() + 24 * 24 * 60 * 60 * 1000).toISOString();
  const subStartDateKabir = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString();

  await db.run(
    `INSERT OR REPLACE INTO student_subscriptions
     (id, student_id, plan_id, vendor_id, status, start_date, end_date, amount_paid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ['MU-SUB-101', 'student_kabir', 3, 'chai', 'active', subStartDateKabir, subEndDateKabir, 899]
  );

  const subEndDateDev = new Date(now.getTime() + 19 * 24 * 60 * 60 * 1000).toISOString();
  const subStartDateDev = new Date(now.getTime() - 11 * 24 * 60 * 60 * 1000).toISOString();

  await db.run(
    `INSERT OR REPLACE INTO student_subscriptions
     (id, student_id, plan_id, vendor_id, status, start_date, end_date, amount_paid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ['MU-SUB-102', 'student_dev', 1, 'cds', 'active', subStartDateDev, subEndDateDev, 2800]
  );

  console.log(`Seeding complete! 5 vendors, 18 items, ${SUBSCRIPTIONS.length} subscriptions, 5 students, ${ordersToSeed.length} orders loaded.`);
}

if (require.main === module) {
  seed(process.argv.includes('--force'))
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Seeding failed:', err);
      process.exit(1);
    });
}

module.exports = { seed };
