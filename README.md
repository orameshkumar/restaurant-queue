# Restaurant Queue Manager

A full-featured, real-time restaurant management system — walk-in queue, reservations, digital table ordering, Kitchen Display System (KDS), billing, takeaway, and a complete inventory management module.

Built with **React 18 + Vite + Tailwind CSS + Firebase** (Firestore + Authentication).

---

## Feature List

### ⭐ Queue & Table Management
- **Walk-in queue** with token generation and estimated wait time
- **Floor plan view** — table status at a glance (available, occupied, reserved)
- **Reservations** with guest name and party size
- **Public waiting-room board** at `/board` — no login, TV-friendly
- **Guest self-service queue join** at `/queue/join` with live status tracker

### ⭐ Digital Ordering
- **Table-side QR ordering** — guests scan a QR code and place orders without a server
- **Server order taking** — servers manage multiple tables with a unified order modal
- **Real-time order sync** — all screens update instantly via Firestore listeners
- **Order editing** — add, remove, or modify items before KDS dispatch

### ⭐ Kitchen Display System (KDS)
- **Kanban board** — New → In Preparation → Ready for Pickup
- **Atomic chef claiming** — prevents two chefs from picking up the same ticket
- **Priority override** by kitchen manager
- **86 list** — toggle any menu item unavailable in real time; reflected instantly on all screens

### ⭐ Billing & Payments
- **Split bill** — N-way equal split or custom per-guest amounts
- **Partial payments** — multiple payment methods per bill
- **Discounts & voids** — item-level and bill-level adjustments
- **Refunds** — tracked against bills, deducted from dashboard revenue

### ⭐ Takeaway & Delivery
- **Takeaway order management** — separate queue from dine-in
- **Public order status page** at `/takeaway/queue/:orderId` — no login required
- **Status flow** — Pending → Preparing → Ready → Handed Over / Delivered
- **Revenue included** in dashboard totals alongside dine-in

### ⭐ Inventory Management
- **Raw materials catalog** with current stock, reorder level, and reorder quantity
- **Load default materials** — 75 standard restaurant ingredients in one click
- **Kitchen requests** — kitchen staff raise multi-item material requests against templates
- **Issue & return workflow** — manager issues stock to kitchen; kitchen returns unused items
- **Wastage recording** — log spoilage with reason; reflected in ledger
- **Purchase Orders (PO)** — generate from low-stock alerts or kitchen usage; send to vendor
- **Stock receipts** — receive goods against a PO or ad-hoc; stock updated atomically
- **Vendor management** — supplier contact details and WhatsApp integration for POs
- **Reusable templates** — kitchen templates and PO templates with multiple items
- **Full stock ledger** — every transaction logged with material, qty, type, and recorded-by name
- **Kitchen usage report** — per-material view of issued / returned / wasted / effectively used for any date range
- **Raise PO from ledger** — select items from usage report and create a PO directly, choosing qty mode (effectively used or used + wastage)

### Reporting & Dashboard
- **Dashboard** — today's revenue (dine-in + takeaway − refunds), active tables, active takeaway orders
- **Reports** — revenue by date range, top-selling items, sales by category
- **Inventory ledger** — filterable by date, material, and transaction type; CSV export

### Staff & Settings
- **Staff management** — CRUD with role assignment
- **Role-based access** — 7 roles with per-route and per-feature gating
- **Restaurant settings** — name, logo, operating config
- **Menu management** — categories, items, pricing, image URLs

---

## Roles

| Role | Access |
|---|---|
| **Admin** | All modules |
| **Manager** | All modules except KDS-only functions |
| **Host** | Floor plan, queue, reservations |
| **Server** | My tables, order taking, takeaway |
| **Chef** | Kitchen Display System |
| **Kitchen Manager** | KDS + inventory (requests, returns, wastage, templates, ledger) |
| **Cashier** | Billing, takeaway handover |

---

## Quick Start

```bash
cp .env.example .env
# fill in your Firebase project values in .env
npm install
npm run dev
```

Public pages (no login required):
- Waiting-room board: `http://localhost:5173/board`
- Queue join: `http://localhost:5173/queue/join`
- Takeaway status: `http://localhost:5173/takeaway/queue/:orderId`

---

## One-Time Setup

1. Create a Firebase project with **Firestore** and **Authentication** (Email/Password) enabled.
2. Copy your Firebase config values into `.env`:
   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_STORAGE_BUCKET=...
   VITE_FIREBASE_MESSAGING_SENDER_ID=...
   VITE_FIREBASE_APP_ID=...
   ```
3. Deploy Firestore security rules: `firebase deploy --only firestore:rules`
4. In Firebase Console → Authentication, create your first Admin user.
5. In Firestore Console, manually create: `staff/{uid}` with `{ name, email, role: "admin", active: true }`.
6. Sign in and go to **Settings** to configure your restaurant name.
7. Go to **Tables → Load Defaults** and **Menu → Load Defaults** to seed initial data.
8. Go to **Inventory → Materials → Load Default Materials** to seed 75 standard ingredients.

---

## Deploy

```bash
npm run build
firebase deploy
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS |
| Backend / DB | Firebase Firestore (real-time) |
| Auth | Firebase Authentication |
| Routing | React Router v6 |
| Notifications | react-hot-toast |
| QR Codes | react-qr-code |
| Date handling | date-fns |

---

## Firestore Collections

### Restaurant Operations
| Collection | Purpose |
|---|---|
| `orders` | Dine-in and takeaway orders |
| `orderItems` | Line items per order |
| `bookings` | Walk-in queue tokens and reservations |
| `tables` | Table configuration and status |
| `menuItems` | Menu catalog with 86-list toggle |
| `bills` | Closed / paid bills |
| `refunds` | Refund records |
| `staff` | Staff profiles and roles |
| `restaurantSettings` | Restaurant name and configuration |

### Inventory
| Collection | Purpose |
|---|---|
| `invMaterials` | Raw material catalog with stock levels |
| `invVendors` | Vendor / supplier records |
| `invRequests` | Kitchen material requests |
| `invReturns` | Items returned to stock |
| `invPOs` | Purchase orders |
| `invReceipts` | Goods received against POs |
| `invWastage` | Wastage / spoilage records |
| `invTemplates` | Reusable kitchen and PO templates |
| `invLedger` | Full inventory transaction log |

---

## Known Limitations

- No WhatsApp / SMS push notifications (requires Cloud Functions)
- No receipt PDF generation (browser print only)
- No multi-branch / multi-location support
- Vendor pricing is not tracked per-date (deferred by design)
