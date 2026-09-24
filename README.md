# Masters Union Canteen — Full-Stack Platform

A full-stack campus food-ordering and multi-stall management platform built for **Masters Union**. Students browse live stock across campus food vendors, pre-order ahead to skip rush-hour queues, and pick up using tokens. Vendors receive real-time order streams, manage live inventory, restock items with FIFO queued auto-release, and publish new menu items.

---

## Key Features

1. **Pixel-Identical Prototype Fidelity**:
   - Preserves 100% of the dark theme + gold accent design system (`--bg`, `--gold`, `--surface`, `--line`).
   - Responsive mobile-phone shell expanding to desktop grid at 900px.
   - Preserves all interaction patterns: steppers, filters, bottom sheets, toast alerts, timeline tracking.

2. **Atomic Stock Reservations & 0-Oversell Guarantee**:
   - Every cart checkout executes in an immediate ACID transaction with conditional updates (`WHERE stock_qty >= qty`).
   - Prevents race conditions and overselling during peak lunch rushes.

3. **FIFO Pre-Booking & Auto-Release Engine**:
   - When an item is sold out but has a restock ETA, students can pre-book it into `queued` status without stock deduction.
   - When the vendor restocks or refills the item, the server walks pending `queued` orders FIFO by `placed_at` and automatically moves satisfied orders into `preparing` ("Cooking") status while decrementing newly added stock.

4. **Clean Payment Boundary (`confirmOrder`)**:
   - Placing an order directly invokes `confirmOrder(orderId)` within the transaction boundary.
   - Can easily be gated behind an external payment gateway webhook in the future without modifying order/stock logic.

5. **Multi-Vendor Cart Splitting**:
   - A single cart checkout containing items from multiple stalls automatically splits into **one order per vendor**, while presenting a unified confirmation token sheet.

6. **Scoped Real-Time WebSockets (`/realtime`)**:
   - Live synchronization scoped per vendor (`vendor:<id>`) and student (`student:<id>`).
   - Live events for `STOCK_UPDATED`, `ORDER_CREATED`, `ORDER_STATUS_CHANGED`, `PREBOOK_TRIGGERED`, and `ITEM_CREATED`.

7. **Lightweight Role Entry & Switching**:
   - Entry screen allowing users to pick **"I'm a student"** (Kabir Ahuja / local student identity) or **"I'm a vendor"** (select any of the 5 campus stalls).
   - "Switch role" control in the top bar allows seamless testing of both roles from the same browser.

---

## Tech Stack

- **Runtime**: Node.js
- **Server**: Express.js (REST APIs + Static Assets)
- **Real-Time**: WebSocket (`ws`)
- **Database**: SQLite3 with WAL mode and ACID transactions
- **Frontend**: Vanilla HTML5, CSS3, JavaScript (no external bundle dependencies)

---

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Seed Database
Initializes the SQLite schema and seeds 5 vendors, 18 menu items, students, and initial sample orders:
```bash
npm run seed:force
```

### 3. Run the Server
Starts the HTTP and WebSocket server on port 3000:
```bash
npm start
```
Open your browser at [http://localhost:3000](http://localhost:3000).

---

## Running the Automated Test Suite

A comprehensive automated test suite verifies concurrency control, the order lifecycle state machine, FIFO auto-release, and the stock ledger:

```bash
npm test
```

### Test Validations:
- **Concurrent Atomic Reservation**: 5 simultaneous checkout requests on an item with 1 unit of stock -> exactly 1 succeeds, 4 receive 409 Conflict, 0 oversell.
- **Queued Pre-Booking**: Placing an order on a 0-stock item queues it without decrementing stock.
- **FIFO Auto-Release**: Restocking 1 unit flips only the earliest queued order to `preparing`; subsequent orders remain queued until sufficient stock is added.
- **Units Sold Count**: `units_sold_today` strictly increments only when an order status reaches `collected`.
- **Cancellation**: Cancelling an active order returns reserved stock back to the counter.
- **Stock Ledger Audit**: Append-only log captures all mutations with reasons and deltas.

---

## API Reference

### Vendors & Menu
- `GET /api/vendors` — List all campus vendors
- `GET /api/items` — List all menu items across vendors (supports `?vendorId=...`)
- `GET /api/vendors/:id/items` — List menu items for a specific vendor
- `POST /api/vendors/:id/items` — Publish a new menu item

### Orders & Cart
- `POST /api/cart/checkout` — Checkout cart items (atomic stock reservation; splits per vendor)
  - Headers: `x-student-id: <id>`
  - Body: `{ cartItems: [{ itemId: 1, qty: 2 }], pickupSlot: "ASAP" }`
- `GET /api/orders/mine` — Get current student's active & past orders
- `GET /api/vendors/:id/orders` — Get vendor's incoming and active orders (supports `?status=active`)
- `PATCH /api/orders/:id/advance` — Advance order status (`placed` -> `preparing` -> `ready` -> `collected`)
  - Headers: `x-vendor-id: <id>`
- `PATCH /api/orders/:id/cancel` — Cancel an order (releases reserved stock)

### Stock & Counter Management
- `PATCH /api/vendors/:id/items/:itemId/stock` — Adjust stock quantity (delta or absolute) or update restock ETA
- `POST /api/vendors/:id/items/:itemId/refill` — Refill item to max capacity
- `POST /api/vendors/:id/items/:itemId/sellout` — Mark item as sold out
- `GET /api/vendors/:id/ledger` — View stock ledger audit history

### Real-Time WebSocket
- `WS /realtime?scope=vendor:<vendorId>,student:<studentId>`
- Emits events:
  - `STOCK_UPDATED`: `{ item, releasedOrders }`
  - `ORDER_CREATED`: Order payload
  - `ORDER_STATUS_CHANGED`: `{ orderId, oldStatus, newStatus, order }`
  - `ITEM_CREATED`: `{ item }`
