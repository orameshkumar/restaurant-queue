import { useState, useMemo, useEffect } from 'react';
import toast from 'react-hot-toast';
import { collection, addDoc, updateDoc, doc, serverTimestamp, query, where, getDocs } from 'firebase/firestore';
import QRCode from 'react-qr-code';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import PageHeader from '../../components/PageHeader';
import TakeOrderModal from '../../components/TakeOrderModal';

// ─── Guest QR Modal ───────────────────────────────────────────────────────────

function GuestQRModal({ table, onClose }) {
  const base = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, '');
  const url  = `${base}/guest/${table.id}/${table.currentBookingId}`;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm text-center p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-1">Table {table.tableNumber} — Guest Order</h2>
        <p className="text-sm text-gray-500 mb-5">Share this QR with the guest to let them order from their phone</p>
        <div className="flex justify-center mb-5 p-3 bg-white border border-gray-200 rounded-xl">
          <QRCode value={url} size={180} />
        </div>
        <p className="text-xs text-gray-400 mb-5 break-all">{url}</p>
        <div className="flex gap-3">
          <button
            onClick={() => navigator.clipboard?.writeText(url).then(() => toast.success('Link copied!'))}
            className="flex-1 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50 transition"
          >📋 Copy Link</button>
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium transition"
          >Done</button>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function timeSince(ts) {
  if (!ts) return '—';
  const secs = Math.floor((Date.now() - ts.toDate().getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

const STATUS_BADGE = {
  occupied:       'bg-blue-100 text-blue-800',
  ordering:       'bg-yellow-100 text-yellow-800',
  eating:         'bg-green-100 text-green-800',
  bill_requested: 'bg-purple-100 text-purple-800',
};

const STATUS_LABEL = {
  occupied:       'Occupied',
  ordering:       'Ordering',
  eating:         'Eating',
  bill_requested: 'Bill Requested',
};

function StatusBadge({ status }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[status] ?? 'bg-gray-100 text-gray-700'}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

// ─── Add Items Modal ─────────────────────────────────────────────────────────

// AddItemsModal removed — TakeOrderModal handles all server order entry

function _AddItemsModal_UNUSED({ tableId, tableStatus, onClose }) {
  const { docs: menuItems = [] } = useCollection('menuItems', 'name', 'asc', [['available', '==', true]]);

  const grouped = useMemo(() => {
    const map = {};
    (menuItems ?? []).forEach((item) => {
      const cat = item.category ?? 'Uncategorized';
      if (!map[cat]) map[cat] = [];
      map[cat].push(item);
    });
    return map;
  }, [menuItems]);

  const [cart, setCart] = useState({});
  const [instructions, setInstructions] = useState({});
  const [firing, setFiring] = useState(false);

  function addToCart(item) {
    setCart((prev) => ({ ...prev, [item.id]: { item, qty: (prev[item.id]?.qty ?? 0) + 1 } }));
  }

  function removeFromCart(itemId) {
    setCart((prev) => {
      const next = { ...prev };
      if (next[itemId]?.qty > 1) next[itemId] = { ...next[itemId], qty: next[itemId].qty - 1 };
      else delete next[itemId];
      return next;
    });
  }

  async function handleFire() {
    const entries = Object.values(cart);
    if (!entries.length) { toast.error('Add at least one item'); return; }
    setFiring(true);
    try {
      const batch = entries.map(({ item, qty }) =>
        addDoc(collection(db, 'orderItems'), {
          tableId,
          orderId: 'direct',
          menuItemId: item.id,
          name: item.name,
          category: item.category ?? 'Uncategorized',
          price: item.price ?? 0,
          qty,
          modifiers: [],
          specialInstructions: instructions[item.id] ?? '',
          status: 'placed',
          firedAt: serverTimestamp(),
          servedAt: null,
          claimedByChefId: null,
        })
      );
      await Promise.all(batch);
      if (tableStatus === 'occupied') {
        await updateDoc(doc(db, 'tables', tableId), { status: 'ordering' });
      }
      toast.success('Items fired to kitchen!');
      onClose();
    } catch (err) {
      console.error(err);
      toast.error('Failed to fire items');
    } finally {
      setFiring(false);
    }
  }

  const cartCount = Object.values(cart).reduce((s, v) => s + v.qty, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-lg font-bold text-gray-900">Add Items</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        {/* Menu */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-6">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-2">{category}</h3>
              <div className="space-y-2">
                {items.map((item) => {
                  const inCart = cart[item.id];
                  return (
                    <div key={item.id} className="border rounded-xl p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-gray-900">{item.name}</p>
                          <p className="text-sm text-gray-500">${(item.price ?? 0).toFixed(2)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {inCart ? (
                            <>
                              <button
                                onClick={() => removeFromCart(item.id)}
                                className="w-7 h-7 rounded-full bg-gray-200 hover:bg-gray-300 font-bold text-lg flex items-center justify-center"
                              >−</button>
                              <span className="w-5 text-center font-semibold">{inCart.qty}</span>
                              <button
                                onClick={() => addToCart(item)}
                                className="w-7 h-7 rounded-full bg-orange-500 hover:bg-orange-600 text-white font-bold text-lg flex items-center justify-center"
                              >+</button>
                            </>
                          ) : (
                            <button
                              onClick={() => addToCart(item)}
                              className="px-3 py-1 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium"
                            >+ Add</button>
                          )}
                        </div>
                      </div>
                      {inCart && (
                        <div className="mt-2">
                          <input
                            type="text"
                            id="server-special-instructions"
                            name="specialInstructions"
                            placeholder="Special instructions (optional)"
                            value={instructions[item.id] ?? ''}
                            onChange={(e) => setInstructions((p) => ({ ...p, [item.id]: e.target.value }))}
                            className="w-full text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-400"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {!menuItems?.length && (
            <p className="text-center text-gray-400 py-8">No menu items available</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t flex items-center justify-between">
          <p className="text-sm text-gray-500">{cartCount} item{cartCount !== 1 ? 's' : ''} selected</p>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border text-gray-700 hover:bg-gray-50 text-sm font-medium"
            >Cancel</button>
            <button
              onClick={handleFire}
              disabled={firing || !cartCount}
              className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold"
            >{firing ? 'Firing…' : '🔥 Fire to Kitchen'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Bulk Handoff Modal ───────────────────────────────────────────────────────

function BulkHandoffModal({ tables, onClose }) {
  const { docs: _allStaffHandoff = [] } = useCollection('staff', 'name', 'asc');
  const staffList = _allStaffHandoff.filter(s => s.role === 'server' && s.active !== false);
  const staffNameMap = useMemo(() => Object.fromEntries(_allStaffHandoff.map(s => [s.id, s.name])), [_allStaffHandoff]);
  const [selectedId, setSelectedId] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleHandoff() {
    if (!selectedId) { toast.error('Select a server'); return; }
    setSaving(true);
    try {
      const serverDoc = staffList.find(s => s.id === selectedId);
      await Promise.all(tables.map(t =>
        updateDoc(doc(db, 'tables', t.id), {
          assignedServerId:   selectedId,
          assignedServerName: serverDoc?.name ?? null,
        })
      ));
      toast.success(`${tables.length} table(s) handed off to ${serverDoc?.name ?? 'server'}`);
      onClose();
    } catch (err) {
      console.error(err);
      toast.error('Handoff failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-lg font-bold text-gray-900">Handoff Tables</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-gray-600">
            Transferring {tables.length === 1 ? `Table ${tables[0].tableNumber}` : `${tables.length} tables`} to:
          </p>
          <div className="flex flex-wrap gap-1">
            {tables.map(t => (
              <span key={t.id} className="text-xs bg-orange-100 text-orange-800 px-2 py-0.5 rounded-full font-medium">
                T{t.tableNumber}
              </span>
            ))}
          </div>
          <select
            id="server-handoff-select"
            name="handoffServer"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          >
            <option value="">— Select server —</option>
            {staffList.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="px-5 py-4 border-t flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border text-gray-700 hover:bg-gray-50 text-sm font-medium">Cancel</button>
          <button
            onClick={handleHandoff}
            disabled={saving || !selectedId}
            className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold"
          >{saving ? 'Saving…' : `Handoff ${tables.length > 1 ? `${tables.length} Tables` : 'Table'}`}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Order Panel ─────────────────────────────────────────────────────────────

function OrderPanel({ table, allOrderItems = [], onRequestBill, onAddItems, onShowQR }) {
  // Isolate current sitting's items.
  // Primary: match by bookingId (exact, written by TakeOrderModal).
  // Fallback: seatedAt fence for items missing bookingId.
  // If table has no active booking at all, show nothing.
  const currentBookingId = table.currentBookingId ?? null;
  const linkedTableId    = table.linkedTableId ?? null;
  const seatedAtSecs = table.seatedAt?.seconds ?? 0;
  const orderItems = allOrderItems
    .filter(i => {
      const belongsHere = i.tableId === table.id || (linkedTableId && i.tableId === linkedTableId);
      if (!belongsHere) return false;
      if (i.bookingId) return i.bookingId === currentBookingId;
      if (seatedAtSecs > 0) return (i.firedAt?.seconds ?? 0) >= seatedAtSecs;
      return false;
    })
    .slice()
    .sort((a, b) => (a.firedAt?.seconds ?? 0) - (b.firedAt?.seconds ?? 0));

  const ready      = orderItems.filter((i) => i.status === 'ready');
  const inKitchen  = orderItems.filter((i) => ['in-kitchen', 'in-preparation'].includes(i.status));
  const placed     = orderItems.filter((i) => i.status === 'placed');
  const served     = orderItems.filter((i) => i.status === 'served');
  const allServed  = orderItems.length > 0 && ready.length === 0 && inKitchen.length === 0 && placed.length === 0;

  async function handleServe(item) {
    try {
      await updateDoc(doc(db, 'orderItems', item.id), {
        status: 'served',
        servedAt: serverTimestamp(),
      });
      toast.success(`${item.name} marked as served`);
    } catch (err) {
      console.error(err);
      toast.error('Failed to update item');
    }
  }

  function ItemRow({ item, actions }) {
    const chefName = item.claimedByChefId ? (staffNameMap[item.claimedByChefId] ?? 'Chef') : null;
    return (
      <div className="flex items-start justify-between gap-3 py-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900 text-sm">{item.name}</span>
            <span className="text-xs text-gray-500">×{item.qty}</span>
          </div>
          {item.modifiers?.length > 0 && (
            <p className="text-xs text-gray-500 mt-0.5">{item.modifiers.join(', ')}</p>
          )}
          {item.specialInstructions && (
            <p className="text-xs italic text-gray-400 mt-0.5">"{item.specialInstructions}"</p>
          )}
          {chefName && (
            <p className="text-xs text-blue-500 mt-0.5">👨‍🍳 {chefName}</p>
          )}
          {!chefName && item.source === 'guest' && item.guestName && (
            <p className="text-xs text-amber-600 mt-0.5">👤 {item.guestName}</p>
          )}
        </div>
        {actions}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-gray-900">Table {table.tableNumber}</h2>
          <StatusBadge status={table.status} />
        </div>
        <div className="flex gap-2 flex-wrap">
          {table.currentBookingId && (
            <button
              onClick={() => onShowQR(table)}
              className="px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-semibold"
              title="Show guest QR to order from phone"
            >📲 Guest QR</button>
          )}
          {table.status !== 'bill_requested' && (
            <button
              onClick={() => onRequestBill(table)}
              disabled={!allServed}
              title={!allServed ? 'All items must be served before requesting bill' : ''}
              className={`px-3 py-1.5 rounded-lg text-white text-sm font-semibold transition ${
                allServed
                  ? 'bg-green-600 hover:bg-green-700'
                  : 'bg-gray-300 cursor-not-allowed'
              }`}
            >💳 Request Bill</button>
          )}
          <button
            onClick={() => onAddItems(table)}
            className="px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold"
          >+ Add Items</button>
        </div>
      </div>

      {/* Order sections */}
      <div className="flex-1 overflow-y-auto space-y-5">
        {/* Ready to serve */}
        {ready.length > 0 && (
          <div className="rounded-xl bg-green-50 border border-green-200 p-4">
            <h3 className="text-sm font-bold text-green-800 mb-2">Ready to Serve 🔔</h3>
            <div className="divide-y divide-green-100">
              {ready.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  actions={
                    <button
                      onClick={() => handleServe(item)}
                      className="shrink-0 px-3 py-1 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-semibold"
                    >Serve ✓</button>
                  }
                />
              ))}
            </div>
          </div>
        )}

        {/* In kitchen */}
        {inKitchen.length > 0 && (
          <div className="rounded-xl bg-orange-50 border border-orange-200 p-4">
            <h3 className="text-sm font-bold text-orange-800 mb-2">In Kitchen 🍳</h3>
            <div className="divide-y divide-orange-100">
              {inKitchen.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  actions={
                    <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-orange-200 text-orange-800 font-medium capitalize">
                      {item.status === 'in-preparation' ? 'Preparing' : 'In Kitchen'}
                    </span>
                  }
                />
              ))}
            </div>
          </div>
        )}

        {/* Placed / waiting for kitchen */}
        {placed.length > 0 && (
          <div className="rounded-xl bg-yellow-50 border border-yellow-200 p-4">
            <h3 className="text-sm font-bold text-yellow-800 mb-2">Waiting for Kitchen ⏳</h3>
            <div className="divide-y divide-yellow-100">
              {placed.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  actions={
                    <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-yellow-200 text-yellow-800 font-medium">
                      Placed
                    </span>
                  }
                />
              ))}
            </div>
          </div>
        )}

        {/* Served */}
        {served.length > 0 && (
          <div className="rounded-xl bg-gray-50 border border-gray-200 p-4">
            <h3 className="text-sm font-bold text-gray-500 mb-2">Served ✓</h3>
            <div className="divide-y divide-gray-100 opacity-70">
              {served.map((item) => (
                <ItemRow key={item.id} item={item} actions={null} />
              ))}
            </div>
          </div>
        )}

        {!orderItems?.length && (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <span className="text-4xl mb-3">🍽️</span>
            <p className="text-sm">No items yet — add some!</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Server() {
  const { profile } = useAuth();

  // My assigned tables — fetch all, filter client-side to avoid composite index requirement
  const activeStatuses = ['occupied', 'ordering', 'eating', 'bill_requested'];
  const visibleStatuses = [...activeStatuses, 'available', 'reserved', 'cleaning'];
  const { docs: allTables = [] } = useCollection('tables', 'tableNumber', 'asc');
  const myTables = useMemo(() => {
    const direct = allTables.filter(
      (t) => t.assignedServerId === profile?.id && visibleStatuses.includes(t.status)
    );
    const directIds = new Set(direct.map(t => t.id));
    const linkedPartners = direct
      .filter(t => t.linkedTableId && !directIds.has(t.linkedTableId))
      .map(t => allTables.find(x => x.id === t.linkedTableId))
      .filter(Boolean)
      .filter(t => visibleStatuses.includes(t.status));
    const result = [...direct, ...linkedPartners].sort((a, b) => (a.tableNumber ?? 0) - (b.tableNumber ?? 0));
    return result;
  }, [allTables, profile?.id]);

  // All order items for pending count (across my tables)
  const myTableIds = myTables.map((t) => t.id);
  const { docs: allOrderItems = [] } = useCollection('orderItems', 'firedAt', 'asc');
  const pendingByTable = useMemo(() => {
    const map = {};
    (allOrderItems ?? []).forEach((item) => {
      if (myTableIds.includes(item.tableId) && item.status !== 'served') {
        map[item.tableId] = (map[item.tableId] ?? 0) + 1;
      }
    });
    return map;
  }, [allOrderItems, myTableIds.join(',')]);

  const [selectedTable, setSelectedTable]     = useState(null);
  const [addItemsTable, setAddItemsTable]     = useState(null);
  const [qrTable, setQrTable]                = useState(null);
  const [showBulkHandoff, setShowBulkHandoff] = useState(false);
  const [checkedIds, setCheckedIds]           = useState(new Set());

  function toggleCheck(tableId, e) {
    e.stopPropagation();
    setCheckedIds(prev => {
      const next = new Set(prev);
      next.has(tableId) ? next.delete(tableId) : next.add(tableId);
      return next;
    });
  }

  const checkedTables = myTables.filter(t => checkedIds.has(t.id));

  // Keep selectedTable in sync with live data
  const liveSelectedTable = myTables.find((t) => t.id === selectedTable?.id) ?? null;

  // Auto-select: retain if still occupied; otherwise pick first occupied table
  useEffect(() => {
    if (myTables.length === 0) return;
    const occupiedTables = myTables.filter(t => activeStatuses.includes(t.status));
    if (occupiedTables.length === 0) return;
    const currentStillActive = selectedTable && occupiedTables.some(t => t.id === selectedTable.id);
    if (!currentStillActive) {
      setSelectedTable(occupiedTables[0]);
    }
  }, [myTables.map(t => t.id + t.status).join(',')]);

  async function handleRequestBill(table) {
    if (table.assignedServerId !== profile?.id) {
      toast.error('You are not assigned to this table.');
      return;
    }
    try {
      await updateDoc(doc(db, 'tables', table.id), { status: 'bill_requested' });
      toast.success(`Bill requested for Table ${table.tableNumber}`);
    } catch (err) {
      console.error(err);
      toast.error('Failed to request bill');
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader
        title="My Tables"
        subtitle={`Welcome, ${profile?.name ?? 'Server'}`}
      />

      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* ── Left: My Tables ── */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-2xl shadow-sm border p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-bold text-gray-800">
                  My Tables
                  {myTables.length > 0 && (
                    <span className="ml-2 text-sm font-normal text-gray-400">({myTables.length})</span>
                  )}
                </h2>
                {checkedIds.size > 0 && (
                  <button
                    onClick={() => setShowBulkHandoff(true)}
                    className="text-xs px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-medium transition"
                  >
                    Handoff {checkedIds.size} selected
                  </button>
                )}
              </div>

              {myTables.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-10">No active tables assigned</p>
              ) : (
                <div className="space-y-2">
                  {myTables.map((table) => {
                    const isSelected = selectedTable?.id === table.id;
                    const isChecked  = checkedIds.has(table.id);
                    const pending = pendingByTable[table.id] ?? 0;
                    return (
                      <div
                        key={table.id}
                        onClick={() => setSelectedTable(table)}
                        className={`rounded-xl border p-3 cursor-pointer transition-all ${
                          isSelected
                            ? 'border-orange-400 bg-orange-50 ring-2 ring-orange-300'
                            : 'border-gray-200 hover:border-orange-200 hover:bg-orange-50/40'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => toggleCheck(table.id, e)}
                              onClick={(e) => e.stopPropagation()}
                              className="h-4 w-4 rounded border-gray-300 text-orange-500 focus:ring-orange-400 cursor-pointer"
                            />
                            <span className="font-bold text-gray-900 text-sm">
                              Table {table.tableNumber}
                              {table.section ? <span className="ml-1 text-xs font-normal text-gray-500">· {table.section}</span> : null}
                            </span>
                          </div>
                          <StatusBadge status={table.status} />
                        </div>
                        <div className="flex items-center justify-between text-xs text-gray-500 pl-6">
                          <span>👥 {table.partySize ?? '—'} guests · ⏱ {timeSince(table.seatedAt)}</span>
                          {pending > 0 && (
                            <span className="bg-orange-500 text-white px-1.5 py-0.5 rounded-full font-semibold">
                              {pending}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Right: Order panel ── */}
          <div className="lg:col-span-2">
            {liveSelectedTable ? (
              <div className="bg-white rounded-2xl shadow-sm border p-5 min-h-[500px] flex flex-col">
                <OrderPanel
                  table={liveSelectedTable}
                  allOrderItems={allOrderItems}
                  onRequestBill={handleRequestBill}
                  onAddItems={(t) => setAddItemsTable(t)}
                  onShowQR={(t) => setQrTable(t)}
                />
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-sm border min-h-[500px] flex flex-col items-center justify-center text-gray-400">
                <span className="text-5xl mb-4">👆</span>
                <p className="text-base font-medium">Select a table to manage orders</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {addItemsTable && (
        <TakeOrderModal
          table={addItemsTable}
          onClose={() => setAddItemsTable(null)}
        />
      )}
      {qrTable?.currentBookingId && (
        <GuestQRModal
          table={qrTable}
          onClose={() => setQrTable(null)}
        />
      )}
      {showBulkHandoff && checkedTables.length > 0 && (
        <BulkHandoffModal
          tables={checkedTables}
          onClose={() => { setShowBulkHandoff(false); setCheckedIds(new Set()); }}
        />
      )}
    </div>
  );
}
