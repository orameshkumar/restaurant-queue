import { useState, useEffect, useMemo } from 'react';
import { updateDoc, doc, serverTimestamp, getDoc } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { useLocation } from 'react-router-dom';
import { db } from '../../firebase/config';
import { isKitchenManagerRole } from '../../utils/roles';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';

const STATIONS = ['All', 'Main Kitchen', 'Grill', 'Cold Kitchen', 'Pastry', 'Bar'];

const STATION_COLORS = {
  'Main Kitchen':  'bg-orange-100 text-orange-700',
  'Grill':         'bg-red-100 text-red-700',
  'Cold Kitchen':  'bg-blue-100 text-blue-700',
  'Pastry':        'bg-pink-100 text-pink-700',
  'Bar':           'bg-purple-100 text-purple-700',
};

// Map dashboard status → kanban column index
const STATUS_TO_COLUMN = {
  placed: 0, 'in-kitchen': 0,
  'in-preparation': 1,
  ready: 2,
}

function timeAgo(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const then = timestamp.toDate ? timestamp.toDate().getTime() : new Date(timestamp).getTime();
  const diffMin = Math.floor((now - then) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin === 1) return '1 min ago';
  return `${diffMin} min ago`;
}

function isOverdue(timestamp) {
  if (!timestamp) return false;
  const then = timestamp.toDate ? timestamp.toDate().getTime() : new Date(timestamp).getTime();
  return Date.now() - then > 15 * 60 * 1000;
}

// ─── Per-item card (Kanban view) ──────────────────────────────────────────────
function ItemCard({ item, tables, staffMap, currentProfile, tick }) {
  const tableObj = tables.find((t) => t.id === item.tableId);
  const tableName = tableObj ? `Table ${tableObj.tableNumber}` : item.tableId || '—';
  const claimedByName = item.claimedByChefId ? staffMap[item.claimedByChefId] || 'Chef' : null;
  const isClaimedByMe = item.claimedByChefId === currentProfile?.id;
  const isClaimedByOther = item.claimedByChefId && !isClaimedByMe;
  const overdue = isOverdue(item.firedAt);
  const isManager = isKitchenManagerRole(currentProfile);

  async function handleClaimAndStart() {
    try {
      await updateDoc(doc(db, 'orderItems', item.id), {
        status: 'in-preparation', claimedByChefId: currentProfile.id, prepStartAt: serverTimestamp(),
      });
      toast.success('Claimed & started!');
    } catch { toast.error('Failed to claim item.'); }
  }

  async function handleMarkReady() {
    try {
      await updateDoc(doc(db, 'orderItems', item.id), { status: 'ready', readyAt: serverTimestamp() });
      toast.success('Marked ready!');
    } catch { toast.error('Failed to mark ready.'); }
  }

  async function handleBump() {
    try {
      await updateDoc(doc(db, 'orderItems', item.id), { status: 'served' });
      toast.success('Item bumped.');
    } catch { toast.error('Failed to bump item.'); }
  }

  async function handleNotAvailable() {
    if (!window.confirm(`Mark "${item.name}" as not available? It will be removed from the order and the bill will be adjusted.`)) return;
    try {
      await updateDoc(doc(db, 'orderItems', item.id), {
        status: 'cancelled',
        cancelledAt: serverTimestamp(),
        cancelReason: 'not_available',
      });
      if (item.orderId) {
        const orderSnap = await getDoc(doc(db, 'orders', item.orderId));
        if (orderSnap.exists()) {
          const orderData = orderSnap.data();
          const idx = (orderData.items ?? []).findIndex(i => i.menuItemId === item.menuItemId);
          if (idx !== -1) {
            const newItems = orderData.items.filter((_, i) => i !== idx);
            const newTotal = newItems.reduce((s, i) => s + (i.price ?? 0) * (i.qty ?? 1), 0);
            await updateDoc(doc(db, 'orders', item.orderId), { items: newItems, total: newTotal });
          }
        }
      }
      toast.success(`"${item.name}" marked as not available.`);
    } catch (err) {
      console.error(err);
      toast.error('Failed to cancel item.');
    }
  }

  async function handleRelease() {
    try {
      if (item.status === 'ready') {
        // Put back from ready → in-preparation (chef keeps ownership, just un-marks ready)
        await updateDoc(doc(db, 'orderItems', item.id), { status: 'in-preparation', readyAt: null });
        toast('Moved back to In Preparation.', { icon: '↩️' });
      } else {
        // Full release from in-preparation → placed (unclaimed, re-enters claim queue)
        await updateDoc(doc(db, 'orderItems', item.id), { claimedByChefId: null, status: 'placed', prepStartAt: null });
        toast('Item released — back in queue.', { icon: '↩️' });
      }
    } catch { toast.error('Failed to release item.'); }
  }

  return (
    <div className={`relative bg-white rounded-xl shadow-sm border-2 p-4 flex flex-col gap-2 transition-all duration-300 ${overdue ? 'border-red-500 animate-pulse' : 'border-gray-200'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-lg font-bold text-gray-900 truncate">{tableName}</span>
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 font-bold text-sm flex-shrink-0">
          ×{item.qty ?? 1}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <p className="text-base font-semibold text-gray-800 leading-tight flex-1">{item.itemName || item.name || 'Unknown Item'}</p>
        {item.station && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${STATION_COLORS[item.station] ?? 'bg-gray-100 text-gray-600'}`}>
            {item.station}
          </span>
        )}
      </div>
      {item.modifiers?.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {item.modifiers.map((mod, i) => (
            <li key={i} className="text-xs text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">{mod}</li>
          ))}
        </ul>
      )}
      {item.specialInstructions && (
        <p className="text-xs italic text-amber-600 bg-amber-50 rounded px-2 py-1">⚠ {item.specialInstructions}</p>
      )}
      <div className="flex items-center justify-between gap-2 mt-1">
        <span className={`text-xs font-medium ${overdue ? 'text-red-600 font-bold' : 'text-gray-400'}`}>
          {timeAgo(item.firedAt)}{overdue && ' ⚠ LATE'}
        </span>
        {claimedByName ? (
          <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 truncate max-w-[120px]">
            👨‍🍳 {claimedByName}
          </span>
        ) : item.source === 'guest' ? (
          <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 truncate max-w-[120px]">
            👤 {item.guestName ?? 'Guest'}
          </span>
        ) : null}
      </div>
      <div className="flex gap-2 mt-1 flex-wrap">
        {(item.status === 'placed' || item.status === 'in-kitchen') && !item.claimedByChefId && (
          <button onClick={handleClaimAndStart} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg px-3 py-1.5 transition-colors">
            Claim &amp; Start
          </button>
        )}
        {item.status === 'in-preparation' && isClaimedByMe && (
          <button onClick={handleMarkReady} className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg px-3 py-1.5 transition-colors">
            Mark Ready ✓
          </button>
        )}
        {item.status === 'in-preparation' && isClaimedByOther && (
          <span className="flex-1 text-center text-xs text-gray-500 bg-gray-100 rounded-lg px-3 py-1.5">
            Claimed by {claimedByName}
          </span>
        )}
        {item.status === 'ready' && (isClaimedByMe || isManager) && (
          <button onClick={handleBump} className="flex-1 bg-gray-700 hover:bg-gray-800 text-white text-sm font-semibold rounded-lg px-3 py-1.5 transition-colors">
            Pickup / Deliver ✓
          </button>
        )}
        {item.status === 'ready' && !isClaimedByMe && !isManager && (
          <span className="flex-1 text-center text-xs text-gray-500 bg-gray-100 rounded-lg px-3 py-1.5">
            Waiting for pickup
          </span>
        )}
        {/* Release only available while in-preparation — not once ready */}
        {item.status === 'in-preparation' && item.claimedByChefId && (isClaimedByMe || isManager) && (
          <button onClick={handleRelease} title="Release item" className="w-8 h-8 flex-shrink-0 flex items-center justify-center bg-red-100 hover:bg-red-200 text-red-600 rounded-lg text-sm font-bold transition-colors">
            ×
          </button>
        )}
        {/* Not Available — placed (unclaimed, any staff) or in-preparation (claimed chef + manager) */}
        {(
          (item.status === 'placed' && !item.claimedByChefId) ||
          (item.status === 'in-preparation' && (isClaimedByMe || isManager))
        ) && (
          <button onClick={handleNotAvailable} className="w-full mt-1 bg-orange-100 hover:bg-orange-200 text-orange-700 text-xs font-semibold rounded-lg px-3 py-1.5 transition-colors">
            Out of Stock / Not Available
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Kanban column ────────────────────────────────────────────────────────────
function KanbanColumn({ title, items, tables, staffMap, currentProfile, tick, highlighted }) {
  return (
    <div className={`flex flex-col gap-3 min-w-0 flex-1 rounded-xl transition-all ${highlighted ? 'ring-2 ring-indigo-400 bg-indigo-50/40 p-2' : ''}`}>
      <div className="flex items-center gap-2 px-1">
        <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide flex-1 truncate">{title}</h2>
        <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 rounded-full bg-gray-200 text-gray-700 font-bold text-xs px-1.5">
          {items.length}
        </span>
      </div>
      <div className="flex flex-col gap-3 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 160px)' }}>
        {items.length === 0 ? (
          <div className="text-center text-gray-400 text-sm py-10 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">No items</div>
        ) : (
          items.map((item) => (
            <ItemCard key={item.id} item={item} tables={tables} staffMap={staffMap} currentProfile={currentProfile} tick={tick} />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Batch card (Batch view) ──────────────────────────────────────────────────
function BatchCard({ batch, tables, currentProfile, tick }) {
  const isManager = isKitchenManagerRole(currentProfile);
  const pendingItems  = batch.items.filter(i => i.status === 'placed' || i.status === 'in-kitchen');
  const prepItems     = batch.items.filter(i => i.status === 'in-preparation');
  const readyItems    = batch.items.filter(i => i.status === 'ready');

  // Oldest firedAt across all items in the batch
  const oldestTs = batch.items.reduce((oldest, i) => {
    const ms = i.firedAt?.toMillis?.() ?? 0;
    return ms < oldest ? ms : oldest;
  }, Infinity);
  const overdue = oldestTs !== Infinity && Date.now() - oldestTs > 15 * 60 * 1000;

  async function claimAll() {
    const targets = batch.items.filter(i => i.status === 'placed' || i.status === 'in-kitchen');
    if (!targets.length) return;
    try {
      await Promise.all(targets.map(i =>
        updateDoc(doc(db, 'orderItems', i.id), {
          status: 'in-preparation', claimedByChefId: currentProfile.id, prepStartAt: serverTimestamp(),
        })
      ));
      toast.success(`Claimed ${targets.length} × ${batch.name}`);
    } catch { toast.error('Failed to claim batch.'); }
  }

  async function markAllReady() {
    const targets = batch.items.filter(i => i.status === 'in-preparation');
    if (!targets.length) return;
    try {
      await Promise.all(targets.map(i =>
        updateDoc(doc(db, 'orderItems', i.id), { status: 'ready', readyAt: serverTimestamp() })
      ));
      toast.success(`${targets.length} × ${batch.name} ready!`);
    } catch { toast.error('Failed to mark batch ready.'); }
  }

  async function bumpAll() {
    const targets = batch.items.filter(i => i.status === 'ready');
    if (!targets.length) return;
    try {
      await Promise.all(targets.map(i =>
        updateDoc(doc(db, 'orderItems', i.id), { status: 'served' })
      ));
      toast.success(`${targets.length} × ${batch.name} bumped.`);
    } catch { toast.error('Failed to bump batch.'); }
  }

  return (
    <div className={`bg-white rounded-xl shadow-sm border-2 p-4 flex flex-col gap-3 ${overdue ? 'border-red-400 animate-pulse' : 'border-gray-200'}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-base font-bold text-gray-900 leading-tight">{batch.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {overdue && <span className="text-red-500 font-semibold mr-1">⚠ LATE ·</span>}
            Oldest: {oldestTs !== Infinity ? timeAgo({ toDate: () => new Date(oldestTs) }) : '—'}
          </p>
        </div>
        <span className="flex-shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 font-bold text-lg">
          ×{batch.totalQty}
        </span>
      </div>

      {/* Per-table breakdown */}
      <div className="flex flex-col gap-1">
        {batch.tableBreakdown.map(({ tableId, tableNumber, qty, statuses, source, guestName }) => {
          const hasReady  = statuses.includes('ready');
          const hasPrep   = statuses.includes('in-preparation');
          return (
            <div key={tableId} className="flex items-center justify-between text-xs px-2 py-1 rounded-lg bg-gray-50">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-medium text-gray-700">Table {tableNumber ?? '?'}</span>
                {source === 'guest' && guestName && (
                  <span className="bg-amber-100 text-amber-700 rounded-full px-1.5 py-0.5 truncate max-w-[80px]">
                    👤 {guestName}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">×{qty}</span>
                <span className={`px-1.5 py-0.5 rounded-full font-medium ${
                  hasReady  ? 'bg-green-100 text-green-700'  :
                  hasPrep   ? 'bg-amber-100 text-amber-700'  :
                              'bg-gray-100 text-gray-500'
                }`}>
                  {hasReady ? 'Ready' : hasPrep ? 'In Prep' : 'Pending'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      {batch.items.length > 1 && (
        <div className="flex gap-1 h-1.5 rounded-full overflow-hidden">
          {pendingItems.length > 0 && (
            <div className="bg-gray-300 rounded-full" style={{ flex: pendingItems.length }} />
          )}
          {prepItems.length > 0 && (
            <div className="bg-amber-400 rounded-full" style={{ flex: prepItems.length }} />
          )}
          {readyItems.length > 0 && (
            <div className="bg-green-500 rounded-full" style={{ flex: readyItems.length }} />
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 flex-wrap">
        {pendingItems.length > 0 && (
          <button
            onClick={claimAll}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg px-3 py-1.5 transition-colors"
          >
            Claim &amp; Start All ({pendingItems.length})
          </button>
        )}
        {prepItems.length > 0 && (
          <button
            onClick={markAllReady}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg px-3 py-1.5 transition-colors"
          >
            Mark All Ready ({prepItems.length})
          </button>
        )}
        {readyItems.length > 0 && (
          <button
            onClick={bumpAll}
            className="flex-1 bg-gray-700 hover:bg-gray-800 text-white text-sm font-semibold rounded-lg px-3 py-1.5 transition-colors"
          >
            Pickup / Deliver All ({readyItems.length})
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Batch view ───────────────────────────────────────────────────────────────
function BatchView({ filteredItems, tables, currentProfile, tick }) {
  // Group by item name across all active statuses
  const batches = useMemo(() => {
    const map = {};
    filteredItems.forEach(item => {
      const key = item.itemName || item.name || 'Unknown';
      if (!map[key]) map[key] = { name: key, items: [], totalQty: 0, tableBreakdown: [] };
      map[key].items.push(item);
      map[key].totalQty += item.qty ?? 1;
    });

    // Build per-table breakdown for each batch
    Object.values(map).forEach(batch => {
      const byTable = {};
      batch.items.forEach(item => {
        if (!byTable[item.tableId]) {
          const t = tables.find(t => t.id === item.tableId);
          byTable[item.tableId] = { tableId: item.tableId, tableNumber: t?.tableNumber, qty: 0, statuses: [], source: item.source, guestName: item.guestName ?? null };
        }
        byTable[item.tableId].qty += item.qty ?? 1;
        byTable[item.tableId].statuses.push(item.status);
      });
      batch.tableBreakdown = Object.values(byTable).sort((a, b) => (a.tableNumber ?? 0) - (b.tableNumber ?? 0));
    });

    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredItems, tables]);

  if (batches.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-400 py-20">
        <p className="text-4xl mb-2">🍳</p>
        <p className="text-sm">No active items.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 p-4 overflow-auto">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {batches.map(batch => (
          <BatchCard
            key={batch.name}
            batch={batch}
            tables={tables}
            currentProfile={currentProfile}
            tick={tick}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main KDS component ───────────────────────────────────────────────────────
export default function KDS() {
  const { profile } = useAuth();
  const location = useLocation();
  const incomingStatus = location.state?.filterStatus ?? null;
  const highlightCol = incomingStatus != null ? (STATUS_TO_COLUMN[incomingStatus] ?? null) : null;

  const [selectedStation, setSelectedStation] = useState('All');
  const [selectedTables, setSelectedTables] = useState(new Set());
  const [tick, setTick] = useState(0);

  // Persist batch mode preference in localStorage
  const [batchMode, setBatchMode] = useState(() => {
    try { return localStorage.getItem('kds_batchMode') === 'true'; } catch { return false; }
  });
  function toggleBatchMode() {
    setBatchMode(prev => {
      const next = !prev;
      try { localStorage.setItem('kds_batchMode', String(next)); } catch {}
      return next;
    });
  }

  const { docs: rawOrderItems = [], loading: itemsLoading } = useCollection('orderItems', null, null);
  const { docs: tables = [] } = useCollection('tables', 'tableNumber');
  const { docs: staff = [] } = useCollection('staff', 'name');

  const orderItems = rawOrderItems
    .filter(i => ['placed', 'in-kitchen', 'in-preparation', 'ready'].includes(i.status))
    .sort((a, b) => (a.firedAt?.toMillis?.() ?? 0) - (b.firedAt?.toMillis?.() ?? 0));

  const staffMap = useMemo(() => {
    const map = {};
    staff.forEach(s => { map[s.id] = s.name; });
    return map;
  }, [staff]);

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  const activeTableNums = useMemo(() => {
    return [...new Set(orderItems.map(i => i.tableId))]
      .map(tid => tables.find(t => t.id === tid)?.tableNumber)
      .filter(Boolean)
      .sort((a, b) => a - b);
  }, [orderItems, tables]);

  function toggleTable(num) {
    setSelectedTables(prev => {
      const next = new Set(prev);
      next.has(num) ? next.delete(num) : next.add(num);
      return next;
    });
  }

  const filteredItems = useMemo(() => {
    let items = selectedStation === 'All' ? orderItems : orderItems.filter(i => i.station === selectedStation);
    if (selectedTables.size > 0) {
      const allowedIds = new Set(tables.filter(t => selectedTables.has(t.tableNumber)).map(t => t.id));
      items = items.filter(i => allowedIds.has(i.tableId));
    }
    return items;
  }, [orderItems, selectedStation, selectedTables, tables]);

  const newOrders = filteredItems.filter(i => i.status === 'placed' || i.status === 'in-kitchen');
  const inPrep    = filteredItems.filter(i => i.status === 'in-preparation');
  const ready     = filteredItems.filter(i => i.status === 'ready');
  const isKitchenBusy = inPrep.length > 8;

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 flex-wrap">
        <span className="text-lg font-bold text-gray-800">Kitchen Display</span>

        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold ${isKitchenBusy ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
          🍳 {inPrep.length} in prep{isKitchenBusy && <span className="ml-1 font-bold">· Kitchen Busy</span>}
        </div>

        {/* Table filter */}
        {activeTableNums.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-gray-400 font-medium">Tables:</span>
            {activeTableNums.map(num => (
              <button
                key={num}
                onClick={() => toggleTable(num)}
                className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border transition-colors ${
                  selectedTables.has(num)
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-amber-400 hover:text-amber-600'
                }`}
              >
                T{num}
              </button>
            ))}
            {selectedTables.size > 0 && (
              <button onClick={() => setSelectedTables(new Set())} className="text-xs text-gray-400 hover:text-gray-600 underline ml-1">
                Clear
              </button>
            )}
          </div>
        )}

        <div className="flex-1" />

        {/* Batch mode toggle */}
        <button
          onClick={toggleBatchMode}
          title={batchMode ? 'Switch to Kanban view' : 'Switch to Batch view'}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
            batchMode
              ? 'bg-orange-500 text-white border-orange-500 shadow-sm'
              : 'bg-white text-gray-600 border-gray-300 hover:border-orange-400 hover:text-orange-600'
          }`}
        >
          {batchMode ? '🔀 Batch ON' : '🔀 Batch OFF'}
        </button>

        {/* Station filter */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {STATIONS.map(station => (
            <button
              key={station}
              onClick={() => setSelectedStation(station)}
              className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                selectedStation === station ? 'bg-indigo-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {station}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {itemsLoading ? (
        <div className="flex-1 flex items-center justify-center text-gray-400 text-lg">Loading orders…</div>
      ) : batchMode ? (
        <BatchView filteredItems={filteredItems} tables={tables} currentProfile={profile} tick={tick} />
      ) : (
        <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 p-4 overflow-auto">
          <KanbanColumn title="New Orders 🆕"       items={newOrders} tables={tables} staffMap={staffMap} currentProfile={profile} tick={tick} highlighted={highlightCol === 0} />
          <KanbanColumn title="In Preparation 🍳"   items={inPrep}    tables={tables} staffMap={staffMap} currentProfile={profile} tick={tick} highlighted={highlightCol === 1} />
          <KanbanColumn title="Ready for Pickup ✅"  items={ready}     tables={tables} staffMap={staffMap} currentProfile={profile} tick={tick} highlighted={highlightCol === 2} />
        </div>
      )}
    </div>
  );
}
