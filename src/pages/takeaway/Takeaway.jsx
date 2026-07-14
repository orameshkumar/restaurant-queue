import { useState, useMemo, useEffect } from 'react';
import {
  collection, doc, serverTimestamp,
  query, where, onSnapshot, writeBatch,
} from 'firebase/firestore';
import QRCode from 'react-qr-code';
import toast from 'react-hot-toast';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import { useDocument } from '../../hooks/useDocument';
import { isManagerRole } from '../../utils/roles';

const DELIVERY_PARTNERS = ['Swiggy', 'Zomato', 'Own Delivery', 'Other'];

const fmt = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n ?? 0);

function tokenFromCount(n) {
  return `TK-${String(n + 1).padStart(3, '0')}`;
}

// ─── Create Order Modal ────────────────────────────────────────────────────────
function CreateOrderModal({ type, todayTakeawayCount, onClose, onCreated }) {
  const { profile } = useAuth();
  const { docs: allMenuItems = [] } = useCollection('menuItems', 'name', 'asc');
  const menuItems = useMemo(() => allMenuItems.filter(i => i.available !== false), [allMenuItems]);
  const { document: settings } = useDocument('restaurantSettings', 'main');
  const merchantVpa  = settings?.upiId ?? '';
  const merchantName = settings?.restaurantName ?? 'Restaurant';

  const [step, setStep] = useState('details');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryPartner, setDeliveryPartner] = useState('Swiggy');
  const [cart, setCart] = useState({});
  const [note, setNote] = useState('');
  const [menuSearch, setMenuSearch] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [firing, setFiring] = useState(false);

  const cartItems = Object.values(cart);
  const subtotal = cartItems.reduce((s, { item, qty }) => s + (item.price ?? 0) * qty, 0);

  const grouped = useMemo(() => {
    const q = menuSearch.trim().toLowerCase();
    const filtered = q
      ? menuItems.filter(i =>
          i.name?.toLowerCase().includes(q) || i.category?.toLowerCase().includes(q)
        )
      : menuItems;
    const map = {};
    filtered.forEach(item => {
      const cat = item.category ?? 'Uncategorized';
      if (!map[cat]) map[cat] = [];
      map[cat].push(item);
    });
    return map;
  }, [menuItems, menuSearch]);

  function addToCart(item) {
    setCart(prev => ({
      ...prev,
      [item.id]: { item, qty: (prev[item.id]?.qty ?? 0) + 1 },
    }));
  }
  function removeFromCart(itemId) {
    setCart(prev => {
      const next = { ...prev };
      if ((next[itemId]?.qty ?? 0) > 1)
        next[itemId] = { ...next[itemId], qty: next[itemId].qty - 1 };
      else delete next[itemId];
      return next;
    });
  }

  function validateDetails() {
    if (!customerName.trim()) { toast.error('Customer name is required.'); return false; }
    if (!customerPhone.trim()) { toast.error('Customer phone is required.'); return false; }
    if (type === 'delivery' && !deliveryAddress.trim()) {
      toast.error('Delivery address is required.'); return false;
    }
    return true;
  }

  async function handleConfirmAndFire() {
    if (!validateDetails()) return;
    if (cartItems.length === 0) { toast.error('Add at least one item.'); return; }
    setFiring(true);
    try {
      const pickupToken = type === 'takeaway' ? tokenFromCount(todayTakeawayCount) : null;
      const batch = writeBatch(db);
      const orderRef = doc(collection(db, 'orders'));

      batch.set(orderRef, {
        type,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        ...(type === 'delivery'
          ? { deliveryAddress: deliveryAddress.trim(), deliveryPartner }
          : { pickupToken }),
        items: cartItems.map(({ item, qty }) => ({
          menuItemId: item.id,
          name: item.name,
          category: item.category ?? 'Uncategorized',
          station: item.station ?? 'Main Kitchen',
          price: item.price ?? 0,
          qty,
          modifiers: [],
        })),
        note: note.trim() || null,
        total: subtotal,
        status: 'placed',
        paymentStatus: 'paid',
        paymentMethod,
        tableId: null,
        bookingId: null,
        createdBy: profile?.id ?? null,
        createdAt: serverTimestamp(),
      });

      cartItems.forEach(({ item, qty }) => {
        const ref = doc(collection(db, 'orderItems'));
        batch.set(ref, {
          orderId: orderRef.id,
          tableId: null,
          tableNumber: null,
          bookingId: null,
          menuItemId: item.id,
          name: item.name,
          category: item.category ?? 'Uncategorized',
          station: item.station ?? 'Main Kitchen',
          price: item.price ?? 0,
          qty,
          modifiers: [],
          specialInstructions: note.trim() || null,
          status: 'placed',
          source: type,
          orderType: type,
          deliveryPartner: type === 'delivery' ? deliveryPartner : null,
          customerName: customerName.trim(),
          pickupToken: pickupToken ?? null,
          claimedByChefId: null,
          firedAt: serverTimestamp(),
          servedAt: null,
          cancelledAt: null,
          cancelReason: null,
        });
      });

      await batch.commit();
      toast.success(
        `Order created!${pickupToken ? ` Token: ${pickupToken}` : ''}`
      );
      onCreated();
    } catch (err) {
      console.error(err);
      toast.error('Failed to create order.');
    } finally {
      setFiring(false);
    }
  }

  const STEPS = ['details', 'menu', 'payment'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              New {type === 'takeaway' ? '🥡 Takeaway' : '🛵 Delivery'} Order
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">Details → Items → Confirm & Pay</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-2xl font-bold leading-none px-1"
          >
            ×
          </button>
        </div>

        {/* Step tabs */}
        <div className="flex border-b flex-shrink-0">
          {STEPS.map((s, i) => (
            <button
              key={s}
              onClick={() => {
                if (s === 'menu' && !validateDetails()) return;
                if (s === 'payment' && cartItems.length === 0) {
                  toast.error('Add items first.');
                  return;
                }
                setStep(s);
              }}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                step === s
                  ? 'border-b-2 border-indigo-600 text-indigo-700'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* ── DETAILS ── */}
          {step === 'details' && (
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Customer Name *</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="Enter customer name"
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Phone *</label>
                <input
                  type="tel"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="10-digit mobile number"
                  value={customerPhone}
                  onChange={e => setCustomerPhone(e.target.value)}
                />
              </div>
              {type === 'delivery' && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">Delivery Address *</label>
                    <textarea
                      rows={3}
                      className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      placeholder="Full delivery address"
                      value={deliveryAddress}
                      onChange={e => setDeliveryAddress(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Delivery Partner</label>
                    <div className="flex flex-wrap gap-2">
                      {DELIVERY_PARTNERS.map(p => (
                        <button
                          key={p}
                          onClick={() => setDeliveryPartner(p)}
                          className={`px-3 py-1.5 text-sm rounded-lg border font-medium transition-colors ${
                            deliveryPartner === p
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'hover:bg-gray-50 border-gray-300'
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
              <div>
                <label className="block text-sm font-medium mb-1">Order Note</label>
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="Special instructions, allergies…"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                />
              </div>
              <button
                onClick={() => {
                  if (!validateDetails()) return;
                  setStep('menu');
                }}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg transition-colors"
              >
                Next: Add Items →
              </button>
            </div>
          )}

          {/* ── MENU ── */}
          {step === 'menu' && (
            <div className="flex flex-col gap-3">
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 sticky top-0 bg-white z-10"
                placeholder="Search menu…"
                value={menuSearch}
                onChange={e => setMenuSearch(e.target.value)}
              />
              {Object.entries(grouped).map(([cat, items]) => (
                <div key={cat}>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2 mt-1">
                    {cat}
                  </p>
                  <div className="flex flex-col gap-0.5">
                    {items.map(item => {
                      const qty = cart[item.id]?.qty ?? 0;
                      return (
                        <div
                          key={item.id}
                          className="flex items-center gap-3 py-2 border-b last:border-0"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">
                              {item.name}
                            </p>
                            <p className="text-xs text-gray-500">{fmt(item.price)}</p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {qty > 0 && (
                              <>
                                <button
                                  onClick={() => removeFromCart(item.id)}
                                  className="w-7 h-7 rounded-full bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold flex items-center justify-center"
                                >
                                  −
                                </button>
                                <span className="w-5 text-center text-sm font-semibold">{qty}</span>
                              </>
                            )}
                            <button
                              onClick={() => addToCart(item)}
                              className="w-7 h-7 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold flex items-center justify-center"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── PAYMENT ── */}
          {step === 'payment' && (
            <div className="flex flex-col gap-5">
              {/* Bill summary */}
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-sm font-semibold text-gray-700 mb-3">Order Summary</p>
                {cartItems.map(({ item, qty }) => (
                  <div key={item.id} className="flex justify-between text-sm py-1">
                    <span className="text-gray-700">
                      {item.name} × {qty}
                    </span>
                    <span className="font-medium text-gray-900">
                      {fmt((item.price ?? 0) * qty)}
                    </span>
                  </div>
                ))}
                <div className="border-t mt-3 pt-3 flex justify-between text-base font-bold text-gray-900">
                  <span>Total</span>
                  <span>{fmt(subtotal)}</span>
                </div>
              </div>

              {/* Payment method */}
              <div>
                <p className="text-sm font-medium mb-2">Payment Method</p>
                <div className="flex gap-2">
                  {[
                    { id: 'cash', label: '💵 Cash' },
                    { id: 'upi', label: '📲 UPI' },
                    { id: 'card', label: '💳 Card' },
                  ].map(m => (
                    <button
                      key={m.id}
                      onClick={() => setPaymentMethod(m.id)}
                      className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                        paymentMethod === m.id
                          ? 'bg-green-600 text-white border-green-600'
                          : 'hover:bg-gray-50 border-gray-300'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* UPI QR code */}
              {paymentMethod === 'upi' && merchantVpa && (
                <div className="flex flex-col items-center gap-2 p-4 bg-indigo-50 rounded-xl border border-indigo-100">
                  <QRCode
                    value={`upi://pay?pa=${merchantVpa}&pn=${encodeURIComponent(merchantName)}&am=${subtotal.toFixed(2)}&cu=INR&tn=${encodeURIComponent((type === 'takeaway' ? 'Takeaway' : 'Delivery') + ' Order')}`}
                    size={160}
                  />
                  <p className="text-sm font-bold text-indigo-700">Scan to pay {fmt(subtotal)}</p>
                  <p className="text-xs text-indigo-600">{merchantVpa}</p>
                </div>
              )}
              {paymentMethod === 'upi' && !merchantVpa && (
                <p className="text-xs text-amber-600 bg-amber-50 rounded-lg p-3">
                  UPI ID not configured. Go to Settings → add your UPI ID to show a payment QR.
                </p>
              )}

              {/* Context info */}
              {type === 'takeaway' && (
                <div className="bg-teal-50 border border-teal-200 rounded-xl p-4">
                  <p className="text-sm font-bold text-teal-700">
                    Pickup Token: {tokenFromCount(todayTakeawayCount)}
                  </p>
                  <p className="text-xs text-teal-600 mt-1">
                    Share this token with the customer for pickup.
                  </p>
                </div>
              )}
              {type === 'delivery' && (
                <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
                  <p className="text-sm font-bold text-purple-700">{deliveryPartner}</p>
                  <p className="text-xs text-purple-600 mt-1 break-words">{deliveryAddress}</p>
                </div>
              )}

              {/* Customer */}
              <div className="text-sm text-gray-600 bg-gray-50 rounded-xl p-3">
                <span className="font-medium">{customerName}</span> · {customerPhone}
                {note && <span className="block text-xs text-amber-600 mt-1 italic">"{note}"</span>}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-5 py-4 border-t bg-gray-50 rounded-b-2xl flex-shrink-0">
          {step !== 'details' && (
            <button
              onClick={() =>
                setStep(step === 'payment' ? 'menu' : 'details')
              }
              className="px-4 py-2 text-sm rounded-lg border border-gray-300 hover:bg-gray-100 font-medium"
            >
              ← Back
            </button>
          )}
          <div className="flex-1" />
          {step === 'menu' && (
            <button
              disabled={cartItems.length === 0}
              onClick={() => setStep('payment')}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg disabled:opacity-40 transition-colors"
            >
              Review Bill ({cartItems.length} item{cartItems.length !== 1 ? 's' : ''}) →
            </button>
          )}
          {step === 'payment' && (
            <button
              disabled={firing}
              onClick={handleConfirmAndFire}
              className="px-5 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded-lg disabled:opacity-40 transition-colors"
            >
              {firing ? 'Firing to Kitchen…' : `Confirm & Fire — ${fmt(subtotal)}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Item row inside an order card ───────────────────────────────────────────
function ItemRow({ item, orderId, isManager }) {
  const { profile } = useAuth();
  const [deleting, setDeleting] = useState(false);

  const statusMap = {
    placed: { label: 'Queued', cls: 'bg-blue-100 text-blue-700' },
    'in-kitchen': { label: 'Queued', cls: 'bg-blue-100 text-blue-700' },
    'in-preparation': { label: 'Preparing', cls: 'bg-amber-100 text-amber-700' },
    ready: { label: 'Ready', cls: 'bg-green-100 text-green-700' },
    served: { label: 'Served', cls: 'bg-gray-100 text-gray-500' },
    cancelled: {
      label: item.cancelReason === 'not_available' ? 'Out of Stock' : 'Cancelled',
      cls: 'bg-red-100 text-red-500',
    },
  };
  const { label: statusLabel, cls: statusCls } = statusMap[item.status] ?? {
    label: item.status,
    cls: 'bg-gray-100 text-gray-500',
  };

  async function handleDeleteItem() {
    if (
      !window.confirm(
        `Remove "${item.name}" from this order?\nA refund record will be created.`
      )
    )
      return;
    setDeleting(true);
    try {
      const refundAmount = (item.price ?? 0) * (item.qty ?? 1);
      const batch = writeBatch(db);
      batch.update(doc(db, 'orderItems', item.id), {
        status: 'cancelled',
        cancelledAt: serverTimestamp(),
        cancelReason: 'manager_removed',
      });
      batch.set(doc(collection(db, 'refunds')), {
        orderId,
        orderType: item.orderType ?? item.source,
        orderItemId: item.id,
        itemName: item.name,
        qty: item.qty ?? 1,
        amount: refundAmount,
        reason: 'Item removed by manager',
        createdAt: serverTimestamp(),
        createdBy: profile?.id ?? null,
      });
      await batch.commit();
      toast.success(
        `"${item.name}" removed. Refund ${fmt(refundAmount)} recorded.`
      );
    } catch {
      toast.error('Failed to remove item.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className={`flex items-center gap-2 text-sm py-1 ${
        item.status === 'cancelled' ? 'opacity-40 line-through' : ''
      }`}
    >
      <div className="flex-1 min-w-0">
        <span className="font-medium text-gray-800">{item.name}</span>
        <span className="text-gray-400"> × {item.qty ?? 1}</span>
      </div>
      <span className="text-xs text-gray-500 flex-shrink-0">
        {fmt((item.price ?? 0) * (item.qty ?? 1))}
      </span>
      <span
        className={`text-xs font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${statusCls}`}
      >
        {statusLabel}
      </span>
      {isManager &&
        item.status !== 'cancelled' &&
        item.status !== 'served' && (
          <button
            disabled={deleting}
            onClick={handleDeleteItem}
            title="Remove item"
            className="w-6 h-6 flex-shrink-0 flex items-center justify-center bg-red-100 hover:bg-red-200 text-red-600 rounded text-xs font-bold disabled:opacity-40 transition-colors"
          >
            ✕
          </button>
        )}
    </div>
  );
}

// ─── Order card ───────────────────────────────────────────────────────────────
function QueueBoardModal({ order, onClose }) {
  const queueUrl = `${window.location.origin}/takeaway/queue/${order.id}`;
  function copyLink() {
    navigator.clipboard.writeText(queueUrl).then(
      () => toast.success('Link copied!'),
      () => toast.error('Copy failed — share the URL manually.')
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-bold text-gray-900">Queue Board Link</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl font-bold leading-none px-1">×</button>
        </div>
        <div className="p-6 flex flex-col items-center gap-5">
          {order.pickupToken && (
            <div className="text-center">
              <p className="text-xs text-gray-400 mb-1">Token</p>
              <p className="text-4xl font-black text-teal-700">{order.pickupToken}</p>
            </div>
          )}
          <div className="bg-white p-3 rounded-xl border-2 border-gray-200">
            <QRCode value={queueUrl} size={180} />
          </div>
          <p className="text-xs text-gray-500 text-center break-all">{queueUrl}</p>
          <p className="text-xs text-gray-400 text-center">
            Share this QR or link with the customer to track their order live.
            The page auto-updates as kitchen progresses.
          </p>
        </div>
        <div className="flex gap-3 px-5 pb-5">
          <button
            onClick={copyLink}
            className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            Copy Link
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 border rounded-lg text-sm hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function OrderCard({ order, allOrderItems, isManager, merchantVpa = '', merchantName = 'Restaurant' }) {
  const items = useMemo(
    () => allOrderItems.filter(i => i.orderId === order.id),
    [allOrderItems, order.id]
  );
  const activeItems = items.filter(i => i.status !== 'cancelled');
  const placedCount = activeItems.filter(
    i => i.status === 'placed' || i.status === 'in-kitchen'
  ).length;
  const prepCount = activeItems.filter(i => i.status === 'in-preparation').length;
  const allReady =
    activeItems.length > 0 && placedCount === 0 && prepCount === 0;

  const liveTotal = activeItems.reduce(
    (s, i) => s + (i.price ?? 0) * (i.qty ?? 1),
    0
  );

  const [handing, setHanding] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [showUpiQR, setShowUpiQR] = useState(false);

  const upiUrl = merchantVpa
    ? `upi://pay?pa=${merchantVpa}&pn=${encodeURIComponent(merchantName)}&am=${liveTotal.toFixed(2)}&cu=INR&tn=${encodeURIComponent((order.type === 'takeaway' ? 'Takeaway' : 'Delivery') + (order.pickupToken ? ' ' + order.pickupToken : ''))}`
    : '';

  const statusLabel =
    order.status === 'completed'
      ? { text: 'Completed', cls: 'bg-gray-100 text-gray-600' }
      : order.status === 'cancelled'
      ? { text: 'Cancelled', cls: 'bg-red-100 text-red-600' }
      : allReady
      ? { text: 'Ready for Pickup', cls: 'bg-green-100 text-green-700' }
      : prepCount > 0
      ? { text: 'In Preparation', cls: 'bg-amber-100 text-amber-700' }
      : { text: 'Queued', cls: 'bg-blue-100 text-blue-700' };

  async function handleHandOver() {
    if (
      !window.confirm(
        `Confirm handover to ${order.customerName}?\nThis marks the order as completed.`
      )
    )
      return;
    setHanding(true);
    try {
      const batch = writeBatch(db);
      activeItems.forEach(i =>
        batch.update(doc(db, 'orderItems', i.id), {
          status: 'served',
          servedAt: serverTimestamp(),
        })
      );
      batch.update(doc(db, 'orders', order.id), {
        status: 'completed',
        completedAt: serverTimestamp(),
      });
      await batch.commit();
      toast.success('Order handed over!');
    } catch {
      toast.error('Handover failed.');
    } finally {
      setHanding(false);
    }
  }

  async function handleCancelOrder() {
    // Only cancel items not yet served or already cancelled
    const cancelableItems = items.filter(
      i => i.status !== 'cancelled' && i.status !== 'served'
    );
    // Items already served/delivered — customer keeps these, no refund on them
    const servedItems = items.filter(i => i.status === 'served');
    const servedValue = servedItems.reduce(
      (s, i) => s + (i.price ?? 0) * (i.qty ?? 1), 0
    );
    // Refund = what customer paid minus what was actually delivered
    const paidTotal = order.total ?? liveTotal;
    const refundAmount = Math.max(0, paidTotal - servedValue);

    const hasPartial = servedItems.length > 0;
    const confirmMsg = hasPartial
      ? `Partial order was already delivered to ${order.customerName}.\n\n` +
        `Delivered: ${fmt(servedValue)}\n` +
        `Refund due: ${fmt(refundAmount)} (original ${fmt(paidTotal)} − delivered ${fmt(servedValue)})\n\n` +
        `Cancel remaining items and record refund?`
      : `Cancel entire order for ${order.customerName}?\nFull refund of ${fmt(refundAmount)} will be recorded.`;

    if (!window.confirm(confirmMsg)) return;

    setCancelling(true);
    try {
      const batch = writeBatch(db);

      // Cancel only items not yet delivered
      cancelableItems.forEach(i =>
        batch.update(doc(db, 'orderItems', i.id), {
          status: 'cancelled',
          cancelledAt: serverTimestamp(),
          cancelReason: 'manager_removed',
        })
      );

      batch.update(doc(db, 'orders', order.id), {
        status: 'cancelled',
        cancelledAt: serverTimestamp(),
        refundAmount,
        deliveredValue: servedValue,
      });

      // Only create refund record if there's something to refund
      if (refundAmount > 0) {
        batch.set(doc(collection(db, 'refunds')), {
          orderId: order.id,
          orderType: order.type,
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          originalAmount: paidTotal,
          deliveredAmount: servedValue,
          amount: refundAmount,
          reason: hasPartial ? 'Partial order cancelled — items not delivered' : 'Full order cancelled',
          paymentMethod: order.paymentMethod ?? 'cash',
          createdAt: serverTimestamp(),
        });
      }

      await batch.commit();
      toast.success(
        refundAmount > 0
          ? `Order cancelled. Refund ${fmt(refundAmount)} recorded.`
          : 'Order cancelled. No refund due (all items were delivered).'
      );
    } catch (err) {
      console.error('cancelOrder error:', err);
      toast.error(`Cancellation failed: ${err.message ?? err}`);
    } finally {
      setCancelling(false);
    }
  }

  const isDelivery = order.type === 'delivery';
  const borderCls = isDelivery ? 'border-purple-400' : 'border-teal-400';
  const headerBg = isDelivery ? 'bg-purple-50' : 'bg-teal-50';
  const typeBadge = isDelivery
    ? 'bg-purple-100 text-purple-700'
    : 'bg-teal-100 text-teal-700';

  return (
    <div
      className={`bg-white rounded-xl shadow-sm border-2 ${borderCls} overflow-hidden`}
    >
      {/* Card header */}
      <div className={`${headerBg} px-4 py-3 flex items-start gap-3`}>
        {/* Left: order info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center flex-wrap gap-1.5 mb-1">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${typeBadge}`}>
              {isDelivery ? '🛵 DELIVERY' : '🥡 TAKEAWAY'}
            </span>
            {order.pickupToken && (
              <span className="text-xs font-mono font-bold bg-teal-600 text-white px-2 py-0.5 rounded">
                {order.pickupToken}
              </span>
            )}
            {order.deliveryPartner && (
              <span className="text-xs bg-purple-200 text-purple-800 font-medium px-2 py-0.5 rounded">
                {order.deliveryPartner}
              </span>
            )}
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusLabel.cls}`}>
              {statusLabel.text}
            </span>
          </div>
          <p className="text-sm font-semibold text-gray-800">{order.customerName}</p>
          <p className="text-xs text-gray-500">{order.customerPhone}</p>
          {order.deliveryAddress && (
            <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">{order.deliveryAddress}</p>
          )}
          <div className="mt-2 flex items-center gap-3">
            <div>
              <p className="text-base font-bold text-gray-900">{fmt(liveTotal)}</p>
              <p className="text-xs text-gray-400 capitalize">{order.paymentMethod} · <span className="text-green-600 font-medium">Paid</span></p>
            </div>
            {merchantVpa && order.status !== 'completed' && order.status !== 'cancelled' && (
              <button
                onClick={() => setShowUpiQR(true)}
                title="Show UPI payment QR"
                className="text-xs font-semibold px-2 py-1 rounded-lg bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors"
              >
                📲 UPI QR
              </button>
            )}
          </div>
        </div>

        {/* Right: inline token status QR */}
        <div className="flex-shrink-0 flex flex-col items-center gap-1">
          <div className="bg-white p-1.5 rounded-lg border border-gray-200 shadow-sm">
            <QRCode
              value={`${window.location.origin}/takeaway/queue/${order.id}`}
              size={72}
            />
          </div>
          <p className="text-xs text-gray-400 text-center leading-tight">
            {order.pickupToken ?? 'Status'}
          </p>
        </div>
      </div>

      {/* Items */}
      <div className="px-4 py-3 flex flex-col gap-0.5">
        {items.map(item => (
          <ItemRow
            key={item.id}
            item={item}
            orderId={order.id}
            isManager={isManager}
          />
        ))}
        {order.note && (
          <p className="text-xs italic text-amber-600 bg-amber-50 rounded px-2 py-1 mt-2">
            ⚠ {order.note}
          </p>
        )}
      </div>

      {/* Actions */}
      {order.status !== 'completed' && order.status !== 'cancelled' && (
        <div className="px-4 pb-4 flex gap-2 flex-wrap">
          {allReady && (
            <button
              disabled={handing}
              onClick={handleHandOver}
              className="flex-1 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded-lg transition-colors disabled:opacity-40"
            >
              {handing
                ? 'Processing…'
                : isDelivery
                ? 'Handed to Delivery Person'
                : 'Handed to Customer'}
            </button>
          )}
          {isManager && (
            <button
              disabled={cancelling}
              onClick={handleCancelOrder}
              className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-semibold rounded-lg transition-colors disabled:opacity-40"
            >
              {cancelling ? 'Cancelling…' : 'Cancel Order'}
            </button>
          )}
        </div>
      )}

      {/* Queue board QR modal */}
      {showQR && <QueueBoardModal order={order} onClose={() => setShowQR(false)} />}

      {/* UPI payment QR modal */}
      {showUpiQR && upiUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 className="font-bold text-gray-900">Pay via UPI</h2>
              <button onClick={() => setShowUpiQR(false)} className="text-gray-400 hover:text-gray-700 text-2xl font-bold leading-none px-1">×</button>
            </div>
            <div className="p-6 flex flex-col items-center gap-4">
              {order.pickupToken && (
                <p className="text-sm font-bold text-teal-700">Token: {order.pickupToken}</p>
              )}
              <p className="text-sm text-gray-600 font-medium">{order.customerName}</p>
              <div className="bg-white p-3 rounded-xl border-2 border-gray-200">
                <QRCode value={upiUrl} size={180} />
              </div>
              <p className="text-2xl font-black text-indigo-700">{fmt(liveTotal)}</p>
              <p className="text-xs text-indigo-600 font-medium">{merchantVpa}</p>
              <p className="text-xs text-gray-400 text-center">
                Customer scans this QR to pay via any UPI app
              </p>
            </div>
            <div className="px-5 pb-5">
              <button
                onClick={() => setShowUpiQR(false)}
                className="w-full py-2.5 bg-gray-100 hover:bg-gray-200 text-sm font-medium rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Takeaway() {
  const { profile } = useAuth();
  const isManager = isManagerRole(profile);
  const { document: settings } = useDocument('restaurantSettings', 'main');
  const merchantVpa  = settings?.upiId ?? '';
  const merchantName = settings?.restaurantName ?? 'Restaurant';
  const [activeTab, setActiveTab] = useState('takeaway');
  const [showCreate, setShowCreate] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const [orders, setOrders] = useState([]);
  const [orderItems, setOrderItems] = useState([]);

  useEffect(() => {
    const q = query(
      collection(db, 'orders'),
      where('type', 'in', ['takeaway', 'delivery'])
    );
    return onSnapshot(q, snap => {
      setOrders(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    });
  }, []);

  useEffect(() => {
    const q = query(
      collection(db, 'orderItems'),
      where('source', 'in', ['takeaway', 'delivery'])
    );
    return onSnapshot(q, snap => {
      setOrderItems(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    });
  }, []);

  const activeOrders = useMemo(
    () =>
      orders
        .filter(
          o =>
            o.type === activeTab &&
            !['completed', 'cancelled'].includes(o.status)
        )
        .sort(
          (a, b) =>
            (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)
        ),
    [orders, activeTab]
  );

  const completedOrders = useMemo(
    () =>
      orders
        .filter(
          o =>
            o.type === activeTab &&
            ['completed', 'cancelled'].includes(o.status)
        )
        .sort(
          (a, b) =>
            (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)
        )
        .slice(0, 20),
    [orders, activeTab]
  );

  const todayTakeawayCount = useMemo(
    () => orders.filter(o => o.type === 'takeaway').length,
    [orders]
  );

  const takeawayActive = orders.filter(
    o => o.type === 'takeaway' && !['completed', 'cancelled'].includes(o.status)
  ).length;
  const deliveryActive = orders.filter(
    o => o.type === 'delivery' && !['completed', 'cancelled'].includes(o.status)
  ).length;

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto">
      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Takeaway & Delivery</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Walk-in takeaway and delivery orders
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-sm transition-colors shadow-sm"
        >
          + New Order
        </button>
      </div>

      {/* Type tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {[
          { id: 'takeaway', label: '🥡 Takeaway', count: takeawayActive },
          { id: 'delivery', label: '🛵 Delivery', count: deliveryActive },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-white shadow text-gray-900'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 rounded-full bg-indigo-600 text-white text-xs font-bold px-1">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Active orders */}
      {activeOrders.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-5xl mb-4">{activeTab === 'takeaway' ? '🥡' : '🛵'}</p>
          <p className="font-medium text-gray-500">
            No active {activeTab} orders
          </p>
          <p className="text-sm mt-1">Tap "+ New Order" to get started</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {activeOrders.map(order => (
            <OrderCard
              key={order.id}
              order={order}
              allOrderItems={orderItems}
              isManager={isManager}
              merchantVpa={merchantVpa}
              merchantName={merchantName}
            />
          ))}
        </div>
      )}

      {/* Completed / history */}
      {completedOrders.length > 0 && (
        <div>
          <button
            onClick={() => setShowHistory(h => !h)}
            className="flex items-center gap-2 text-xs font-bold text-gray-400 uppercase tracking-wide mb-3 hover:text-gray-600 transition-colors"
          >
            <span>{showHistory ? '▾' : '▸'}</span>
            Recent Completed / Cancelled ({completedOrders.length})
          </button>
          {showHistory && (
            <div className="grid gap-3 lg:grid-cols-2 opacity-60">
              {completedOrders.map(order => (
                <OrderCard
                  key={order.id}
                  order={order}
                  allOrderItems={orderItems}
                  isManager={isManager}
                  merchantVpa={merchantVpa}
                  merchantName={merchantName}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <CreateOrderModal
          type={activeTab}
          todayTakeawayCount={todayTakeawayCount}
          onClose={() => setShowCreate(false)}
          onCreated={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
