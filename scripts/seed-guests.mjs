/**
 * Seed script — creates 60 walk-in guests in the queue.
 *
 * Usage:
 *   1. Create .env.local with real Firebase keys (see .env.example)
 *   2. node scripts/seed-guests.mjs
 *   3. To clean up afterwards: node scripts/seed-guests.mjs --clean
 *
 * The script writes to the `bookings` collection with status='waiting'
 * so they appear on the Queue Board and Host station immediately.
 */

import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, addDoc, getDocs,
  query, where, deleteDoc, doc, serverTimestamp, Timestamp
} from 'firebase/firestore';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── Load .env.local manually (no dotenv dependency needed) ──────────────────
const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, '../.env.local');
if (!existsSync(envPath)) {
  console.error('ERROR: .env.local not found. Copy .env.example and fill in real Firebase keys.');
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim()]; })
);

const firebaseConfig = {
  apiKey:            env.VITE_FIREBASE_API_KEY,
  authDomain:        env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ── Guest data ───────────────────────────────────────────────────────────────
const FIRST_NAMES = [
  'Aarav','Aditi','Arjun','Bhavya','Chetan','Deepa','Dhruv','Divya',
  'Farhan','Geetha','Harish','Indira','Jayesh','Kavya','Kiran','Lakshmi',
  'Mahesh','Meera','Mohan','Nandini','Nikhil','Parvati','Pooja','Priya',
  'Rahul','Raja','Rakesh','Ramesh','Ravi','Rohit','Roopa','Sanjay',
  'Seema','Shiv','Shreya','Siddharth','Sonal','Sunil','Sunita','Suresh',
  'Tanya','Uma','Uday','Varun','Veena','Vikram','Vijay','Vishal',
  'Yamini','Zara','Aisha','Arnav','Bharat','Chandni','Darshan','Esha',
  'Ganesh','Hema','Ishaan','Jaya','Karthik','Lavanya'
];

const PARTY_SIZES = [1, 2, 2, 2, 3, 3, 4, 4, 4, 5, 6, 8]; // weighted toward 2-4

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randPhone() { return `98${Math.floor(10000000 + Math.random() * 89999999)}`; }

function makeGuest(index) {
  const name = FIRST_NAMES[index % FIRST_NAMES.length];
  const partySize = pick(PARTY_SIZES);
  // Spread join times over the last 90 minutes
  const minsAgo = Math.floor(Math.random() * 90);
  const joinedAt = new Date(Date.now() - minsAgo * 60 * 1000);

  return {
    guestName:   name,
    phone:       randPhone(),
    partySize,
    status:      'waiting',
    source:      'walkin',
    joinedAt:    Timestamp.fromDate(joinedAt),
    createdAt:   Timestamp.fromDate(joinedAt),
    notes:       partySize >= 6 ? 'Large group' : (Math.random() > 0.8 ? 'Window seat preferred' : ''),
    tableId:     null,
    seatedAt:    null,
    _seeded:     true,   // marker so --clean can find them
  };
}

// ── Clean mode ───────────────────────────────────────────────────────────────
async function clean() {
  console.log('Cleaning seeded guests...');
  const snap = await getDocs(query(collection(db, 'bookings'), where('_seeded', '==', true)));
  if (snap.empty) { console.log('Nothing to clean.'); process.exit(0); }
  await Promise.all(snap.docs.map(d => deleteDoc(doc(db, 'bookings', d.id))));
  console.log(`Deleted ${snap.docs.length} seeded bookings.`);
  process.exit(0);
}

// ── Seed mode ────────────────────────────────────────────────────────────────
async function seed(count = 60) {
  console.log(`Seeding ${count} guests into the queue...`);
  const batch = [];
  for (let i = 0; i < count; i++) {
    batch.push(addDoc(collection(db, 'bookings'), makeGuest(i)));
  }

  const results = await Promise.allSettled(batch);
  const ok      = results.filter(r => r.status === 'fulfilled').length;
  const failed  = results.filter(r => r.status === 'rejected').length;

  console.log(`\n✅ Created: ${ok} guests`);
  if (failed > 0) console.log(`❌ Failed:  ${failed} (check Firestore rules)`);
  console.log('\nGuests are now visible in the Queue Board and Host station.');
  console.log('Run with --clean to remove them when done.\n');
  process.exit(0);
}

// ── Entry ────────────────────────────────────────────────────────────────────
if (process.argv.includes('--clean')) {
  await clean();
} else {
  const countArg = process.argv.find(a => /^\d+$/.test(a));
  await seed(countArg ? parseInt(countArg) : 60);
}
