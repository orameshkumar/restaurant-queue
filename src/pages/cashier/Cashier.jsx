import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import './bill-print.css';
import { collection, addDoc, updateDoc, doc, serverTimestamp, query, where, onSnapshot } from 'firebase/firestore';
import QRCode from 'react-qr-code';
import toast from 'react-hot-toast';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import { useDocument } from '../../hooks/useDocument';
import PageHeader from '../../components/PageHeader';


// ─── helpers ────────────────────────────────────────────────────────────────
const fmt = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n ?? 0);

const todayString = () => new Date().toISOString().slice(0, 10);

// ─── Void-item modal ─────────────────────────────────────────────────────────
function VoidModal({ item, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
        <h3 className="text-lg font-semibold mb-1">Void Item</h3>
        <p className="text-sm text-gray-500 mb-4">
          {item.name} × {item.qty} — {fmt((item.price ?? item.unitPrice ?? 0) * item.qty)}
        </p>
        <label className="block text-sm font-medium mb-1">Reason *</label>
        <textarea
          className="w-full border rounded-lg p-2 text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-red-400"
          placeholder="e.g. Customer changed order, spilled…"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="flex gap-3 mt-4 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border hover:bg-gray-50">
            Cancel
          </button>
          <button
            disabled={!reason.trim()}
            onClick={() => onConfirm(reason.trim())}
            className="px-4 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-40"
          >
            Void Item
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Discount modal ──────────────────────────────────────────────────────────
function DiscountModal({ subtotal, onApply, onClose }) {
  const [type, setType] = useState('percent');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');

  const discountAmount = useMemo(() => {
    const v = parseFloat(value) || 0;
    return type === 'percent' ? (subtotal * v) / 100 : Math.min(v, subtotal);
  }, [type, value, subtotal]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
        <h3 className="text-lg font-semibold mb-4">Apply Discount</h3>
        <div className="flex gap-3 mb-4">
          {['percent', 'fixed'].map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
                type === t ? 'bg-indigo-600 text-white border-indigo-600' : 'hover:bg-gray-50'
              }`}
            >
              {t === 'percent' ? '% Percentage' : '₹ Fixed Amount'}
            </button>
          ))}
        </div>
        <label htmlFor="discount-amount" className="block text-sm font-medium mb-1">
          {type === 'percent' ? 'Discount %' : 'Discount Amount (₹)'}
        </label>
        <input
          type="number"
          id="discount-amount"
          name="discountAmount"
          min="0"
          max={type === 'percent' ? 100 : subtotal}
          className="w-full border rounded-lg p-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <label htmlFor="discount-reason" className="block text-sm font-medium mb-1">Reason</label>
        <input
          type="text"
          id="discount-reason"
          name="discountReason"
          className="w-full border rounded-lg p-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          placeholder="e.g. Loyalty, Manager approval…"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {discountAmount > 0 && (
          <p className="text-sm text-green-600 mb-3">
            Discount: {fmt(discountAmount)} off subtotal
          </p>
        )}
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border hover:bg-gray-50">
            Cancel
          </button>
          <button
            disabled={discountAmount <= 0}
            onClick={() => onApply({ type, value: parseFloat(value), amount: discountAmount, reason })}
            className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Split Bill modal ────────────────────────────────────────────────────────
function SplitModal({ total, onClose }) {
  const [guests, setGuests] = useState('2');
  const n = Math.max(1, parseInt(guests) || 1);
  const share = total / n;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
        <h3 className="text-lg font-semibold mb-4">Split Bill Equally</h3>
        <label htmlFor="split-guests" className="block text-sm font-medium mb-1">Number of Guests</label>
        <input
          type="number"
          id="split-guests"
          name="splitGuests"
          min="1"
          className="w-full border rounded-lg p-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          value={guests}
          onChange={(e) => setGuests(e.target.value)}
        />
        <div className="bg-indigo-50 rounded-xl p-4 text-center mb-4">
          <p className="text-sm text-gray-500">Each person pays</p>
          <p className="text-3xl font-bold text-indigo-700">{fmt(share)}</p>
          <p className="text-xs text-gray-400 mt-1">Total {fmt(total)} ÷ {n}</p>
        </div>
        <button
          onClick={onClose}
          className="w-full py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-medium"
        >
          Close
        </button>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function Cashier() {
  const { user, profile } = useAuth();

  // ── merchant settings for UPI QR ─────────────────────────────────────────
  const { document: restaurantSettings } = useDocument('restaurantSettings', 'main');
  const merchantVpa  = restaurantSettings?.upiId ?? '';
  const merchantName = restaurantSettings?.restaurantName ?? 'Restaurant';
  const merchantId   = restaurantSettings?.merchantId ?? '';
  const TAX_RATE     = restaurantSettings?.taxRate ?? 5;

  // ── data ──────────────────────────────────────────────────────────────────
  const { docs: allTables = [] } = useCollection('tables', 'tableNumber', 'asc');
  const activeTables = allTables.filter(t => ['occupied','ordering','eating','bill_requested'].includes(t.status));

  // Deduplicate linked tables — one card per booking (linked tables share currentBookingId)
  const tables = useMemo(() => {
    const seen = new Set();
    return activeTables.reduce((acc, t) => {
      const key = t.currentBookingId ?? t.id;
      if (seen.has(key)) return acc;
      seen.add(key);
      // Collect all tables sharing this booking and merge their numbers
      const linked = activeTables.filter(x => (x.currentBookingId ?? x.id) === key);
      const tableNumbers = linked.map(x => x.tableNumber).sort((a, b) => a - b);
      acc.push({ ...t, tableNumbers, displayNumber: tableNumbers.join(' & ') });
      return acc;
    }, []);
  }, [activeTables]);

  // Live order totals per booking — so the bill list can show amounts
  const [orderTotalsByBooking, setOrderTotalsByBooking] = useState({});
  useEffect(() => {
    const activeIds = activeTables.map(t => t.id);
    if (activeIds.length === 0) { setOrderTotalsByBooking({}); return; }
    // Firestore 'in' supports up to 30 items — sufficient for any restaurant
    const q = query(collection(db, 'orders'), where('tableId', 'in', activeIds));
    const unsub = onSnapshot(q, snap => {
      const totals = {};
      snap.docs.forEach(d => {
        const order = d.data();
        if (['draft', 'rejected', 'billed'].includes(order.status)) return;
        const key = order.bookingId ?? order.tableId;
        totals[key] = (totals[key] ?? 0) + (order.total ?? 0);
      });
      setOrderTotalsByBooking(totals);
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTables.map(t => t.id).join(',')]);

  const [selectedTable, setSelectedTable] = useState(null);
  // Always read linkedTableId and currentBookingId from live Firestore data
  const liveSelectedTable = useMemo(
    () => tables.find(t => t.id === selectedTable?.id) ?? selectedTable,
    [tables, selectedTable?.id]
  );

  // ── multi-round orders for the selected table (+ linked table) ──────────
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    if (!liveSelectedTable) { setOrders([]); return; }
    const tableIds = [liveSelectedTable.id, liveSelectedTable.linkedTableId].filter(Boolean);
    const q = query(collection(db, 'orders'), where('tableId', 'in', tableIds));
    const unsub = onSnapshot(q, snap => {
      const all = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      const docs = all
        .filter(d => {
          if (['draft', 'rejected', 'billed'].includes(d.status)) return false;
          if (liveSelectedTable.currentBookingId && d.bookingId && d.bookingId !== liveSelectedTable.currentBookingId) return false;
          return true;
        })
        .sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0));
      setOrders(docs);
    });
    return unsub;
  }, [liveSelectedTable?.id, liveSelectedTable?.linkedTableId, liveSelectedTable?.currentBookingId]);

  // ── live orderItems for delivery check (+ linked table) ─────────────────
  const [unservedItems, setUnservedItems] = useState([]);
  useEffect(() => {
    if (!liveSelectedTable) { setUnservedItems([]); return; }
    const tableIds = [liveSelectedTable.id, liveSelectedTable.linkedTableId].filter(Boolean);
    const q = query(collection(db, 'orderItems'), where('tableId', 'in', tableIds));
    const unsub = onSnapshot(q, snap => {
      const items = snap.docs
        .map(d => ({ ...d.data(), id: d.id }))
        .filter(d => {
          if (d.status === 'served') return false;
          if (d.status === 'cancelled') return false;   // cancelled items don't block billing
          if (liveSelectedTable.currentBookingId && d.bookingId && d.bookingId !== liveSelectedTable.currentBookingId) return false;
          return true;
        });
      setUnservedItems(items);
    });
    return unsub;
  }, [liveSelectedTable?.id, liveSelectedTable?.linkedTableId, liveSelectedTable?.currentBookingId]);

  // ── collapsed state for round sections ───────────────────────────────────
  const [collapsedRounds, setCollapsedRounds] = useState({});
  function toggleRound(idx) {
    setCollapsedRounds(prev => ({ ...prev, [idx]: !prev[idx] }));
  }

  // ── local state ───────────────────────────────────────────────────────────
  const [tipOption, setTipOption] = useState('none'); // 'none' | '10' | '15' | 'custom'
  const [customTip, setCustomTip] = useState('');
  const [paymentMode, setPaymentMode] = useState('cash');
  const [discount, setDiscount] = useState(null); // { type, value, amount, reason }
  const [voidTarget, setVoidTarget] = useState(null); // item doc
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [settling, setSettling] = useState(false);
  const [printCopies, setPrintCopies] = useState(1);
  const printRef = useRef(null);
  const [lastBill, setLastBill] = useState(null); // snapshot for printing after settle

  // ── derived ───────────────────────────────────────────────────────────────
  // Flatten all items across rounds, merging same menuItemId
  const consolidatedItems = useMemo(() => {
    const map = {};
    orders.forEach(order => {
      order.items?.forEach(item => {
        const key = item.menuItemId ?? item.name;
        if (map[key]) {
          map[key].qty += item.qty ?? 1;
        } else {
          map[key] = { ...item };
        }
      });
    });
    return Object.values(map);
  }, [orders]);

  const grandTotal = orders.reduce((s, o) => s + (o.total ?? 0), 0);

  // subtotal for discount/tax/tip calculations is grandTotal before adjustments
  const subtotal = grandTotal;

  const discountAmount = discount?.amount ?? 0;
  const discountedSubtotal = Math.max(0, subtotal - discountAmount);

  const taxAmount = (discountedSubtotal * TAX_RATE) / 100;

  const tipAmount = useMemo(() => {
    if (tipOption === '10') return discountedSubtotal * 0.1;
    if (tipOption === '15') return discountedSubtotal * 0.15;
    if (tipOption === 'custom') { const v = parseFloat(customTip); return isNaN(v) ? 0 : v; }
    return 0;
  }, [tipOption, customTip, discountedSubtotal]);

  const total = discountedSubtotal + taxAmount + tipAmount;

  // ── UPI QR URL ────────────────────────────────────────────────────────────
  const upiUrl = selectedTable && merchantVpa
    ? `upi://pay?pa=${merchantVpa}&pn=${encodeURIComponent(merchantName)}&am=${total.toFixed(2)}&cu=INR&tn=Table+${selectedTable.tableNumber}+Bill`
    : '';

  // ── actions ───────────────────────────────────────────────────────────────
  async function handleVoidItem(reason) {
    // voidTarget here is a consolidated item (from orders[].items), not an orderItems doc.
    // We update the item inside its parent order doc.
    try {
      // Find the order that contains this item and remove/reduce it
      for (const order of orders) {
        const idx = order.items?.findIndex(
          (i) => (i.menuItemId ?? i.name) === (voidTarget.menuItemId ?? voidTarget.name)
        );
        if (idx !== undefined && idx >= 0) {
          const updatedItems = order.items.filter((_, i) => i !== idx);
          const newTotal = updatedItems.reduce((s, i) => s + (i.price ?? i.unitPrice ?? 0) * (i.qty ?? 1), 0);
          await updateDoc(doc(db, 'orders', order.id), {
            items: updatedItems,
            total: newTotal,
            voidLog: [
              ...(order.voidLog ?? []),
              { name: voidTarget.name, qty: voidTarget.qty, reason, voidedAt: new Date().toISOString(), voidedBy: user?.uid },
            ],
          });
          break;
        }
      }
      toast.success(`"${voidTarget.name}" voided`);
    } catch (err) {
      toast.error('Failed to void item');
      console.error(err);
    } finally {
      setVoidTarget(null);
    }
  }

  async function handleSettleBill() {
    if (!selectedTable) return;
    if (unservedItems.length > 0) {
      toast.error(`${unservedItems.length} item(s) not yet served. Cannot settle.`);
      return;
    }
    setSettling(true);
    try {
      const tbl = liveSelectedTable;

      // 1. Create consolidated bill document
      const billRef = await addDoc(collection(db, 'bills'), {
        tableId: tbl.id,
        tableNumber: tbl.tableNumber,
        linkedTableId: tbl.linkedTableId ?? null,
        bookingId: tbl.currentBookingId ?? null,
        items: consolidatedItems,
        rounds: orders.length,
        subtotal,
        tax: TAX_RATE,
        taxAmount,
        discount: discount
          ? { type: discount.type, value: discount.value, amount: discountAmount, reason: discount.reason }
          : null,
        tip: tipAmount,
        tipOption,
        total,
        paymentMode,
        closedAt: serverTimestamp(),
        closedDate: todayString(),
        serverId:     tbl.assignedServerId   ?? null,
        serverName:   tbl.assignedServerName ?? null,
        cashierId:    user?.uid    ?? null,
        cashierName:  profile?.name ?? null,
        status: 'closed',
      });

      // 2. Mark ALL loaded orders as billed
      await Promise.all(
        orders.map((o) =>
          updateDoc(doc(db, 'orders', o.id), {
            status: 'billed',
            billedAt: serverTimestamp(),
            billId: billRef.id,
          })
        )
      );

      // 3. Update table
      await updateDoc(doc(db, 'tables', tbl.id), {
        status: 'cleaning',
        currentBookingId: null,
        lastBillId: billRef.id,
        linkedTableId: null,
      });

      // 3b. Free linked table if any
      if (tbl.linkedTableId) {
        await updateDoc(doc(db, 'tables', tbl.linkedTableId), {
          status: 'cleaning',
          currentBookingId: null,
          linkedTableId: null,
        });
      }

      // 4. Update booking if present
      if (selectedTable.currentBookingId) {
        await updateDoc(doc(db, 'bookings', selectedTable.currentBookingId), {
          status: 'completed',
          completedAt: serverTimestamp(),
        });
      }

      // Capture bill snapshot for printing before clearing state
      setLastBill({
        billId: billRef.id,
        tableNumber: selectedTable.tableNumber,
        items: consolidatedItems,
        subtotal, taxAmount, tax: TAX_RATE, discountAmount,
        discount, tipAmount, tipOption, total, paymentMode,
        restaurantName: merchantName,
        closedAt: new Date(),
      });

      toast.success(`Bill settled — ${fmt(total)}`, { duration: 5000 });
      setSelectedTable(null);
      setDiscount(null);
      setTipOption('none');
      setCustomTip('');
      setPaymentMode('cash');
      setCollapsedRounds({});
    } catch (err) {
      toast.error('Failed to settle bill');
      console.error(err);
    } finally {
      setSettling(false);
    }
  }

  // Build a print snapshot from current in-progress bill (before settle)
  const currentBillSnapshot = useMemo(() => {
    if (!selectedTable || orders.length === 0) return null;
    return {
      billId: 'PREVIEW',
      tableNumber: selectedTable.tableNumber,
      items: consolidatedItems,
      subtotal, taxAmount, tax: TAX_RATE, discountAmount,
      discount, tipAmount, tipOption, total, paymentMode,
      restaurantName: merchantName,
      closedAt: new Date(),
    };
  }, [selectedTable, orders, consolidatedItems, subtotal, taxAmount, TAX_RATE,
      discountAmount, discount, tipAmount, tipOption, total, paymentMode, merchantName]);

  const [printSnapshot, setPrintSnapshot] = useState(null);

  const handlePrint = useCallback((snapshot) => {
    setPrintSnapshot(snapshot);
    setTimeout(() => window.print(), 300);
  }, []);

  const handleReprintBill = useCallback(() => {
    if (lastBill) handlePrint(lastBill);
  }, [lastBill, handlePrint]);

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-screen bg-gray-50">
      <PageHeader title="Cashier / Billing" subtitle="Settle bills for tables that requested payment" />

      <div className="flex flex-col flex-1 gap-4 p-4 overflow-auto">
        {/* ── LEFT: Bill Queue ─────────────────────────────────────────── */}
        <aside className="w-full flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide px-1">
            Bill Queue ({tables?.length ?? 0}) — click a table to open bill
          </h2>

          {!tables?.length && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <span className="text-4xl mb-2">🧾</span>
              <p className="text-sm">No pending bills</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {tables?.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setSelectedTable(t);
                setDiscount(null);
                setTipOption('none');
                setCustomTip('');
                setPaymentMode('cash');
              }}
              className={`text-left rounded-xl p-4 border transition-all shadow-sm ${
                selectedTable?.id === t.id
                  ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-300'
                  : 'border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/30'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-lg font-bold text-gray-800">
                  Table #{t.displayNumber ?? t.tableNumber}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  t.status === 'bill_requested' ? 'bg-purple-100 text-purple-700' :
                  t.status === 'ordering'       ? 'bg-orange-100 text-orange-700' :
                  t.status === 'eating'         ? 'bg-green-100 text-green-700'   :
                                                  'bg-gray-100 text-gray-600'
                }`}>
                  {t.status === 'bill_requested' ? '💳 Bill Req.' :
                   t.status === 'ordering'       ? '🍽️ Ordering' :
                   t.status === 'eating'         ? '🍴 Eating'   : '🪑 Occupied'}
                </span>
              </div>
              <p className="text-xs text-gray-500">{t.section ?? 'Main Hall'}</p>
              <p className="text-xs text-gray-500 mt-0.5">👥 {t.partySize ?? '—'} guests</p>
              {t.assignedServerName && (
                <p className="text-xs text-gray-500 mt-0.5">🧑‍🍳 {t.assignedServerName}</p>
              )}
              {(() => {
                const runningTotal = orderTotalsByBooking[t.currentBookingId ?? t.id];
                return runningTotal > 0
                  ? <p className="text-sm font-semibold text-indigo-700 mt-1.5">{fmt(runningTotal)}</p>
                  : <p className="text-xs text-gray-400 mt-1.5">No orders yet</p>;
              })()}
            </button>
          ))}
          </div>{/* end grid */}
        </aside>

      {/* ── Bill Detail Modal ────────────────────────────────────────────── */}
      {selectedTable && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setSelectedTable(null)}>
          <div className="bg-gray-50 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>

            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-100 flex-shrink-0">
              <div>
                <h2 className="text-xl font-bold text-gray-800">Table #{selectedTable.displayNumber ?? selectedTable.tableNumber}</h2>
                <p className="text-sm text-gray-500">
                  {selectedTable.section ?? 'Main Hall'} · {selectedTable.partySize ?? '—'} guests
                  {selectedTable.assignedServerName ? ` · ${selectedTable.assignedServerName}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* Copies selector */}
                <div className="flex items-center gap-1 border border-gray-200 rounded-lg px-2 py-1">
                  <span className="text-xs text-gray-400 mr-1">Copies</span>
                  {[1, 2, 3].map(n => (
                    <button
                      key={n}
                      onClick={() => setPrintCopies(n)}
                      className={`w-6 h-6 rounded text-xs font-bold transition-colors ${printCopies === n ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                {/* Print Bill button */}
                <button
                  onClick={() => currentBillSnapshot && handlePrint(currentBillSnapshot)}
                  disabled={orders.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-800 text-white text-sm font-medium rounded-lg disabled:opacity-40 transition"
                >
                  🖨 Print Bill
                </button>
                <button
                  onClick={() => setSelectedTable(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 transition flex-shrink-0"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto p-5">
            <div className="space-y-4">
              {/* Order rounds */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <h3 className="font-semibold text-gray-700 mb-3">
                  Order Rounds ({orders.length})
                </h3>

                {orders.length === 0 && (
                  <p className="text-sm text-gray-400 italic">No confirmed orders found for this table.</p>
                )}

                {orders.map((order, idx) => {
                  const roundTotal = order.total ?? 0;
                  const isCollapsed = collapsedRounds[idx];
                  return (
                    <div key={order.id} className="mb-3 border border-gray-100 rounded-xl overflow-hidden">
                      <button
                        onClick={() => toggleRound(idx)}
                        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition text-left"
                      >
                        <span className="text-sm font-semibold text-gray-700">
                          Round {idx + 1}
                          {order.note ? <span className="ml-2 text-xs font-normal text-gray-400 italic">"{order.note}"</span> : null}
                        </span>
                        <span className="flex items-center gap-3 text-sm text-gray-600">
                          <span className="font-medium">{fmt(roundTotal)}</span>
                          <span className={`transition-transform ${isCollapsed ? '' : 'rotate-180'} text-gray-400`}>▲</span>
                        </span>
                      </button>
                      {!isCollapsed && (
                        <div className="px-4 py-3">
                          <RoundItemTable items={order.items ?? []} onVoid={setVoidTarget} />
                        </div>
                      )}
                    </div>
                  );
                })}

                {orders.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-200 flex justify-between items-center">
                    <span className="text-sm font-semibold text-gray-700">Grand Total (pre-adjustments)</span>
                    <span className="text-base font-bold text-indigo-700">{fmt(grandTotal)}</span>
                  </div>
                )}
              </div>

              {/* Totals */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-2">
                <h3 className="font-semibold text-gray-700 mb-1">Summary</h3>

                <TotalRow label="Subtotal" value={fmt(subtotal)} />

                {discount && (
                  <TotalRow
                    label={`Discount (${discount.type === 'percent' ? `${discount.value}%` : 'fixed'}${discount.reason ? ` · ${discount.reason}` : ''})`}
                    value={`− ${fmt(discountAmount)}`}
                    className="text-green-600"
                  />
                )}

                <TotalRow label={`Tax (${TAX_RATE}%)`} value={fmt(taxAmount)} />

                {tipAmount > 0 && (
                  <TotalRow
                    label={`Tip (${tipOption === 'custom' ? 'custom' : `${tipOption}%`})`}
                    value={fmt(tipAmount)}
                  />
                )}

                <div className="border-t pt-2 mt-2">
                  <TotalRow label="Total" value={fmt(total)} bold />
                </div>
              </div>

              {/* Tip selector */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <h3 className="font-semibold text-gray-700 mb-3">Tip</h3>
                <div className="flex flex-wrap gap-2">
                  {[
                    { key: 'none', label: 'None' },
                    { key: '10', label: '10%' },
                    { key: '15', label: '15%' },
                    { key: 'custom', label: 'Custom' },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setTipOption(key)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium border ${
                        tipOption === key
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {tipOption === 'custom' && (
                  <input
                    type="number"
                    id="tip-custom"
                    name="tipCustom"
                    min="0"
                    className="mt-3 w-36 border rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="Amount (₹)"
                    value={customTip}
                    onChange={(e) => setCustomTip(e.target.value)}
                  />
                )}
              </div>

              {/* Payment mode */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <h3 className="font-semibold text-gray-700 mb-3">Payment Mode</h3>
                <div className="flex flex-wrap gap-2">
                  {[
                    { key: 'cash', label: 'Cash', icon: '💵' },
                    { key: 'card', label: 'Card', icon: '💳' },
                    { key: 'upi', label: 'UPI', icon: '📱' },
                    { key: 'room_charge', label: 'Room Charge', icon: '🏨' },
                  ].map(({ key, label, icon }) => (
                    <button
                      key={key}
                      onClick={() => setPaymentMode(key)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border ${
                        paymentMode === key
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <span>{icon}</span>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* UPI QR code */}
              {paymentMode === 'upi' && upiUrl && (
                <div className="mt-3 flex flex-col items-center gap-2 p-4 bg-indigo-50 rounded-xl border border-indigo-100">
                  <QRCode value={upiUrl} size={160} />
                  <p className="text-xs text-gray-500">Scan to pay {fmt(total)} via UPI</p>
                  <p className="text-xs text-indigo-600 font-medium">{merchantVpa}</p>
                  {merchantId && (
                    <p className="text-xs text-gray-400">MID: {merchantId}</p>
                  )}
                </div>
              )}
              {paymentMode === 'upi' && !merchantVpa && (
                <p className="mt-2 text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  UPI ID not configured. Add it in Settings → Payment.
                </p>
              )}

              {/* Actions */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-wrap gap-3">
                <button
                  onClick={() => setShowDiscountModal(true)}
                  className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 hover:bg-gray-50"
                >
                  🏷️ {discount ? 'Edit Discount' : 'Add Discount'}
                </button>
                {discount && (
                  <button
                    onClick={() => setDiscount(null)}
                    className="px-4 py-2 rounded-lg text-sm font-medium border border-red-200 text-red-600 hover:bg-red-50"
                  >
                    ✕ Remove Discount
                  </button>
                )}
                <button
                  onClick={() => setShowSplitModal(true)}
                  className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 hover:bg-gray-50"
                >
                  ✂️ Split Bill
                </button>

                {unservedItems.length > 0 && (
                  <div className="ml-auto flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <span>⚠️</span>
                    <span>
                      <span className="font-semibold">{unservedItems.length} item{unservedItems.length > 1 ? 's' : ''} not yet served</span>
                      {' '}— {unservedItems.slice(0, 2).map(i => i.name).join(', ')}{unservedItems.length > 2 ? ` +${unservedItems.length - 2} more` : ''}
                    </span>
                  </div>
                )}
                <button
                  disabled={orders.length === 0 || settling || unservedItems.length > 0}
                  onClick={handleSettleBill}
                  title={unservedItems.length > 0 ? 'All items must be served before settling' : ''}
                  className="ml-auto px-6 py-2 rounded-xl text-sm font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {settling ? (
                    <><span className="animate-spin">⏳</span> Processing…</>
                  ) : (
                    <>✅ Settle Bill · {fmt(total)}</>
                  )}
                </button>
              </div>
            </div>
            </div>{/* end scrollable body */}
          </div>{/* end modal panel */}
        </div>
      )}{/* end modal overlay */}
      </div>

      {/* ── Hidden print layout (screen-hidden, print-visible) ─────────── */}
      {printSnapshot && (
        <div ref={printRef} className="print-bill-root">
          {Array.from({ length: printCopies }).map((_, copyIdx) => (
            <div key={copyIdx} className="print-bill-copy">
              <div className="print-bill-header">
                <p className="print-bill-restaurant">{printSnapshot.restaurantName}</p>
                <p className="print-bill-sub">Tax Invoice</p>
                <p className="print-bill-sub">Table {printSnapshot.tableNumber}{printSnapshot.billId !== 'PREVIEW' ? ` · Bill #${printSnapshot.billId.slice(-6).toUpperCase()}` : ''}</p>
                <p className="print-bill-sub">{printSnapshot.closedAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                {printCopies > 1 && <p className="print-bill-copy-label">{copyIdx === 0 ? 'Customer Copy' : copyIdx === 1 ? 'Restaurant Copy' : `Copy ${copyIdx + 1}`}</p>}
              </div>
              <table className="print-bill-table">
                <thead>
                  <tr><th>Item</th><th>Qty</th><th>Rate</th><th>Amt</th></tr>
                </thead>
                <tbody>
                  {printSnapshot.items.map((item, i) => (
                    <tr key={i}>
                      <td>{item.name}</td>
                      <td className="center">{item.qty}</td>
                      <td className="right">{(item.price ?? 0).toFixed(2)}</td>
                      <td className="right">{((item.price ?? 0) * item.qty).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="print-bill-totals">
                <div className="print-bill-row"><span>Subtotal</span><span>{printSnapshot.subtotal.toFixed(2)}</span></div>
                {printSnapshot.discount && <div className="print-bill-row discount"><span>Discount</span><span>− {printSnapshot.discountAmount.toFixed(2)}</span></div>}
                <div className="print-bill-row"><span>GST ({printSnapshot.tax}%)</span><span>{printSnapshot.taxAmount.toFixed(2)}</span></div>
                {printSnapshot.tipAmount > 0 && <div className="print-bill-row"><span>Tip</span><span>{printSnapshot.tipAmount.toFixed(2)}</span></div>}
                <div className="print-bill-row total"><span>TOTAL</span><span>₹ {printSnapshot.total.toFixed(2)}</span></div>
                <div className="print-bill-row"><span>Payment</span><span style={{ textTransform: 'capitalize' }}>{printSnapshot.paymentMode}</span></div>
              </div>
              <p className="print-bill-footer">Thank you for dining with us!</p>
              {copyIdx < printCopies - 1 && <div className="print-page-break" />}
            </div>
          ))}
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────── */}
      {voidTarget && (
        <VoidModal
          item={voidTarget}
          onConfirm={handleVoidItem}
          onClose={() => setVoidTarget(null)}
        />
      )}

      {showDiscountModal && (
        <DiscountModal
          subtotal={subtotal}
          onApply={(d) => {
            setDiscount(d);
            setShowDiscountModal(false);
          }}
          onClose={() => setShowDiscountModal(false)}
        />
      )}

      {showSplitModal && (
        <SplitModal total={total} onClose={() => setShowSplitModal(false)} />
      )}
    </div>
  );
}

// ─── Round item table sub-component ──────────────────────────────────────────
// items here are order.items[] — fields: name, qty, price (guest orders use `price`)
function RoundItemTable({ items, onVoid }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[380px]">
        <thead>
          <tr className="text-xs text-gray-400 uppercase">
            <th className="text-left pb-1 font-medium">Item</th>
            <th className="text-center pb-1 font-medium w-10">Qty</th>
            <th className="text-right pb-1 font-medium w-20">Unit</th>
            <th className="text-right pb-1 font-medium w-20">Total</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => {
            const unit = item.price ?? item.unitPrice ?? 0;
            return (
              <tr key={item.menuItemId ?? idx} className="border-t border-gray-50 hover:bg-gray-50/60">
                <td className="py-1.5 pr-2">
                  <span className="font-medium text-gray-700">{item.name}</span>
                  {item.category && (
                    <span className="block text-xs text-gray-400">{item.category}</span>
                  )}
                </td>
                <td className="text-center text-gray-600">{item.qty ?? 1}</td>
                <td className="text-right text-gray-600">{fmt(unit)}</td>
                <td className="text-right font-medium text-gray-800">
                  {fmt(unit * (item.qty ?? 1))}
                </td>
                <td className="text-right">
                  <button
                    onClick={() => onVoid(item)}
                    title="Void item"
                    className="text-red-400 hover:text-red-600 px-1 py-0.5 rounded text-xs"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Total row sub-component ─────────────────────────────────────────────────
function TotalRow({ label, value, bold, className = '' }) {
  return (
    <div className={`flex justify-between text-sm ${bold ? 'font-bold text-base' : 'text-gray-600'} ${className}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
