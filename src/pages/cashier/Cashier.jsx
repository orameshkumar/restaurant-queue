import { useState, useMemo } from 'react';
import { collection, addDoc, updateDoc, doc, serverTimestamp, getDocs, query, where } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import PageHeader from '../../components/PageHeader';

const TAX_RATE = 5; // percent — replace with restaurantSettings fetch if available

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
          {item.name} × {item.qty} — {fmt(item.unitPrice * item.qty)}
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
        <label className="block text-sm font-medium mb-1">
          {type === 'percent' ? 'Discount %' : 'Discount Amount (₹)'}
        </label>
        <input
          type="number"
          min="0"
          max={type === 'percent' ? 100 : subtotal}
          className="w-full border rounded-lg p-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <label className="block text-sm font-medium mb-1">Reason</label>
        <input
          type="text"
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
        <label className="block text-sm font-medium mb-1">Number of Guests</label>
        <input
          type="number"
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
  const { user } = useAuth();

  // ── data ──────────────────────────────────────────────────────────────────
  const { docs: tables = [] } = useCollection('tables', 'tableNumber', 'asc', [
    ['status', '==', 'bill_requested'],
  ]);

  const [selectedTable, setSelectedTable] = useState(null);

  // Only filter by tableId — avoid '!=' operator which requires composite index with orderBy.
  // Filter out voided items in JS below.
  const { docs: rawItems = [] } = useCollection(
    selectedTable ? 'orderItems' : null,
    null,
    null,
    selectedTable ? [['tableId', '==', selectedTable.id]] : []
  );

  // ── local state ───────────────────────────────────────────────────────────
  const [tipOption, setTipOption] = useState('none'); // 'none' | '10' | '15' | 'custom'
  const [customTip, setCustomTip] = useState('');
  const [paymentMode, setPaymentMode] = useState('cash');
  const [discount, setDiscount] = useState(null); // { type, value, amount, reason }
  const [voidTarget, setVoidTarget] = useState(null); // item doc
  const [showDiscountModal, setShowDiscountModal] = useState(false);
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [settling, setSettling] = useState(false);

  // ── derived ───────────────────────────────────────────────────────────────
  const items = (rawItems ?? [])
    .filter((i) => i.status !== 'voided')
    .sort((a, b) => (a.firedAt?.toMillis?.() ?? 0) - (b.firedAt?.toMillis?.() ?? 0));

  const servedItems = items.filter((i) => i.status === 'served');
  const pendingItems = items.filter((i) => i.status !== 'served');

  const subtotal = items.reduce((s, i) => s + (i.unitPrice ?? 0) * (i.qty ?? 1), 0);

  const discountAmount = discount?.amount ?? 0;
  const discountedSubtotal = Math.max(0, subtotal - discountAmount);

  const taxAmount = (discountedSubtotal * TAX_RATE) / 100;

  const tipAmount = useMemo(() => {
    if (tipOption === '10') return discountedSubtotal * 0.1;
    if (tipOption === '15') return discountedSubtotal * 0.15;
    if (tipOption === 'custom') return parseFloat(customTip) || 0;
    return 0;
  }, [tipOption, customTip, discountedSubtotal]);

  const total = discountedSubtotal + taxAmount + tipAmount;

  // ── actions ───────────────────────────────────────────────────────────────
  async function handleVoidItem(reason) {
    try {
      const itemRef = doc(db, 'orderItems', voidTarget.id);
      await updateDoc(itemRef, {
        status: 'voided',
        voidReason: reason,
        voidedAt: serverTimestamp(),
        voidedBy: user?.uid,
      });
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
    setSettling(true);
    try {
      // 1. Create bill document
      const billData = {
        tableId: selectedTable.id,
        tableNumber: selectedTable.tableNumber,
        items: items.map((i) => ({
          id: i.id,
          name: i.name,
          qty: i.qty,
          unitPrice: i.unitPrice,
          lineTotal: (i.unitPrice ?? 0) * (i.qty ?? 1),
          status: i.status,
          category: i.category ?? null,
        })),
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
        serverId: selectedTable.assignedServerId ?? null,
        cashierId: user?.uid ?? null,
        status: 'closed',
      };

      const billRef = await addDoc(collection(db, 'bills'), billData);

      // 2. Mark all non-voided orderItems as served
      const itemsQ = query(
        collection(db, 'orderItems'),
        where('tableId', '==', selectedTable.id),
        where('status', '!=', 'voided')
      );
      const itemSnap = await getDocs(itemsQ);
      await Promise.all(
        itemSnap.docs.map((d) =>
          d.data().status !== 'served'
            ? updateDoc(doc(db, 'orderItems', d.id), { status: 'served' })
            : Promise.resolve()
        )
      );

      // 3. Update table
      await updateDoc(doc(db, 'tables', selectedTable.id), {
        status: 'cleaning',
        assignedServerId: null,
        currentBookingId: null,
        lastBillId: billRef.id,
      });

      // 4. Update booking if present
      if (selectedTable.currentBookingId) {
        await updateDoc(doc(db, 'bookings', selectedTable.currentBookingId), {
          status: 'completed',
          completedAt: serverTimestamp(),
        });
      }

      toast.success(`Bill settled — ${fmt(total)}`, { duration: 5000 });
      setSelectedTable(null);
      setDiscount(null);
      setTipOption('none');
      setCustomTip('');
      setPaymentMode('cash');
    } catch (err) {
      toast.error('Failed to settle bill');
      console.error(err);
    } finally {
      setSettling(false);
    }
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-screen bg-gray-50">
      <PageHeader title="Cashier / Billing" subtitle="Settle bills for tables that requested payment" />

      <div className="flex flex-col lg:flex-row flex-1 gap-4 p-4 overflow-auto">
        {/* ── LEFT: Bill Queue ─────────────────────────────────────────── */}
        <aside className="w-full lg:w-72 flex-shrink-0 flex flex-col gap-3 overflow-y-auto">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide px-1">
            Bill Queue ({tables?.length ?? 0})
          </h2>

          {!tables?.length && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <span className="text-4xl mb-2">🧾</span>
              <p className="text-sm">No pending bills</p>
            </div>
          )}

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
                <span className="text-lg font-bold text-gray-800">Table #{t.tableNumber}</span>
                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                  Bill Req.
                </span>
              </div>
              <p className="text-xs text-gray-500">{t.section ?? 'Main Hall'}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                👥 {t.partySize ?? '—'} guests
              </p>
              {t.assignedServerName && (
                <p className="text-xs text-gray-500 mt-0.5">🧑‍🍳 {t.assignedServerName}</p>
              )}
            </button>
          ))}
        </aside>

        {/* ── RIGHT: Bill Detail ───────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto">
          {!selectedTable ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <span className="text-6xl mb-3">💳</span>
              <p className="text-lg font-medium">Select a table to view bill</p>
              <p className="text-sm mt-1">Click any entry in the queue on the left</p>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto space-y-4">
              {/* Table header */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-gray-800">
                      Table #{selectedTable.tableNumber}
                    </h2>
                    <p className="text-sm text-gray-500">
                      {selectedTable.section ?? 'Main Hall'} · {selectedTable.partySize ?? '—'} guests
                      {selectedTable.assignedServerName
                        ? ` · Server: ${selectedTable.assignedServerName}`
                        : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedTable(null)}
                    className="text-gray-400 hover:text-gray-600 text-sm"
                  >
                    ✕ Deselect
                  </button>
                </div>
              </div>

              {/* Items list */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <h3 className="font-semibold text-gray-700 mb-3">Order Items</h3>

                {items.length === 0 && (
                  <p className="text-sm text-gray-400 italic">No items found for this table.</p>
                )}

                {servedItems.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-green-600 mb-2">
                      Served
                    </p>
                    <ItemTable items={servedItems} onVoid={setVoidTarget} />
                  </div>
                )}

                {pendingItems.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 mb-2">
                      Pending / In-progress
                    </p>
                    <ItemTable items={pendingItems} onVoid={setVoidTarget} />
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

                <button
                  disabled={items.length === 0 || settling}
                  onClick={handleSettleBill}
                  className="ml-auto px-6 py-2 rounded-xl text-sm font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 flex items-center gap-2"
                >
                  {settling ? (
                    <>
                      <span className="animate-spin">⏳</span> Processing…
                    </>
                  ) : (
                    <>✅ Settle Bill · {fmt(total)}</>
                  )}
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

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

// ─── Item table sub-component ─────────────────────────────────────────────────
function ItemTable({ items, onVoid }) {
  return (
    <div className="overflow-x-auto">
    <table className="w-full text-sm min-w-[420px]">
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
        {items.map((item) => (
          <tr key={item.id} className="border-t border-gray-50 hover:bg-gray-50/60">
            <td className="py-1.5 pr-2">
              <span className="font-medium text-gray-700">{item.name}</span>
              {item.notes && (
                <span className="block text-xs text-gray-400 italic">{item.notes}</span>
              )}
            </td>
            <td className="text-center text-gray-600">{item.qty ?? 1}</td>
            <td className="text-right text-gray-600">{fmt(item.unitPrice)}</td>
            <td className="text-right font-medium text-gray-800">
              {fmt((item.unitPrice ?? 0) * (item.qty ?? 1))}
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
        ))}
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
