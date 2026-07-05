# Restaurant Queue Manager

A real-time restaurant table & queue management system — walk-in queue, reservations, digital ordering, Kitchen Display System (KDS), server dispatch, and integrated billing.

Built with **React 18 + Vite + Tailwind CSS + Firebase** (same stack as salon-manager).

## Roles

| Role | Module |
|---|---|
| Host / Receptionist | Floor plan, queue, reservations |
| Server / Waiter | My tables, order taking, serve confirmation |
| Chef | Kitchen Display System — claim, prepare, mark ready |
| Kitchen Manager | KDS + priority override, 86 list |
| Cashier | Billing, void, discount, payment |
| Manager / Admin | Menu, tables, staff, reports, settings |

## Quick Start

```bash
cp .env.example .env
# fill in your Firebase project values in .env
npm install
npm run dev
```

Public board (no login): `http://localhost:5173/board`

## One-time setup

1. Create a Firebase project with Firestore + Authentication enabled.
2. Add your Firebase config values to `.env`.
3. Deploy Firestore rules: `firebase deploy --only firestore:rules`
4. In Firebase Console → Authentication, create your first Admin user.
5. In Firestore Console, manually create: `staff/{uid}` with `{ name, email, role: 'admin', active: true }`.
6. Sign in at the app and go to **Settings** to set your restaurant name.
7. Go to **Tables → Load Defaults** and **Menu → Load Defaults** to seed initial data.

## Deploy to Firebase Hosting

```bash
npm run build
firebase deploy
```

## Key Features

- **Real-time** — all views update live via Firestore listeners
- **KDS Kanban** — New → In Preparation → Ready for Pickup; atomic chef claiming (no duplicate work)
- **One server per table** — with tab-to-tab handoff
- **Load Defaults** — seed tables, menu items, and settings with one click
- **Public queue board** — `/board` route, no login, designed for a waiting-room TV
- **Split bill & partial payments** — cashier page supports N-way equal splits
- **86 list** — toggle any menu item unavailable in real time; reflected instantly on all screens

## Known limitations (Phase 1)

- No WhatsApp/SMS notifications (needs Cloud Functions)
- No receipt PDF printing (browser print only)
- No inventory management
- No multi-branch support
- Calendar/shift availability is simplified
