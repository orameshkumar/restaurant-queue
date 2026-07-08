import { useState, useEffect, useMemo } from 'react';
import { updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { useLocation } from 'react-router-dom';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import PageHeader from '../../components/PageHeader';

const STATIONS = ['All', 'Grill', 'Cold Kitchen', 'Pastry', 'Bar'];

function timeAgo(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const then = timestamp.toDate ? timestamp.toDate().getTime() : new Date(timestamp).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin === 1) return '1 min ago';
  return `${diffMin} min ago`;
}

function isOverdue(timestamp) {
  if (!timestamp) return false;
  const then = timestamp.toDate ? timestamp.toDate().getTime() : new Date(timestamp).getTime();
  return Date.now() - then > 15 * 60 * 1000;
}

function ItemCard({ item, tables, staffMap, currentProfile, tick }) {
  const tableObj = tables.find((t) => t.id === item.tableId);
  const tableName = tableObj ? `Table ${tableObj.tableNumber}` : item.tableId || '—';
  const claimedByName = item.claimedByChefId ? staffMap[item.claimedByChefId] || 'Chef' : null;
  const isClaimedByMe = item.claimedByChefId === currentProfile?.id;
  const isClaimedByOther = item.claimedByChefId && !isClaimedByMe;
  const overdue = isOverdue(item.firedAt);
  const isManager = currentProfile?.role === 'kitchen_manager' || currentProfile?.role === 'admin';

  async function handleClaimAndStart() {
    try {
      await updateDoc(doc(db, 'orderItems', item.id), {
        status: 'in-preparation',
        claimedByChefId: currentProfile.id,
        prepStartAt: serverTimestamp(),
      });
      toast.success('Claimed & started!');
    } catch (err) {
      toast.error('Failed to claim item.');
      console.error(err);
    }
  }

  async function handleMarkReady() {
    try {
      await updateDoc(doc(db, 'orderItems', item.id), {
        status: 'ready',
        readyAt: serverTimestamp(),
      });
      toast.success('Marked ready!');
    } catch (err) {
      toast.error('Failed to mark ready.');
      console.error(err);
    }
  }

  async function handleBump() {
    try {
      await updateDoc(doc(db, 'orderItems', item.id), {
        status: 'served',
      });
      toast.success('Item bumped.');
    } catch (err) {
      toast.error('Failed to bump item.');
      console.error(err);
    }
  }

  async function handleRelease() {
    try {
      await updateDoc(doc(db, 'orderItems', item.id), {
        claimedByChefId: null,
        status: 'in-kitchen',
        prepStartAt: null,
      });
      toast('Item released.', { icon: '↩️' });
    } catch (err) {
      toast.error('Failed to release item.');
      console.error(err);
    }
  }

  return (
    <div
      className={`relative bg-white rounded-xl shadow-sm border-2 p-4 flex flex-col gap-2 transition-all duration-300
        ${overdue ? 'border-red-500 animate-pulse' : 'border-gray-200'}
      `}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-lg font-bold text-gray-900 truncate">{tableName}</span>
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 font-bold text-sm flex-shrink-0">
          ×{item.qty ?? 1}
        </span>
      </div>

      {/* Item name */}
      <p className="text-base font-semibold text-gray-800 leading-tight">{item.itemName || item.name || 'Unknown Item'}</p>

      {/* Modifiers */}
      {item.modifiers && item.modifiers.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {item.modifiers.map((mod, i) => (
            <li key={i} className="text-xs text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">
              {mod}
            </li>
          ))}
        </ul>
      )}

      {/* Special instructions */}
      {item.specialInstructions && (
        <p className="text-xs italic text-amber-600 bg-amber-50 rounded px-2 py-1">
          ⚠ {item.specialInstructions}
        </p>
      )}

      {/* Footer row: time + claimed badge */}
      <div className="flex items-center justify-between gap-2 mt-1">
        <span className={`text-xs font-medium ${overdue ? 'text-red-600 font-bold' : 'text-gray-400'}`}>
          {timeAgo(item.firedAt)}
          {overdue && ' ⚠ LATE'}
        </span>
        {claimedByName && (
          <span className="text-xs bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 truncate max-w-[120px]">
            👨‍🍳 {claimedByName}
          </span>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 mt-1 flex-wrap">
        {(item.status === 'placed' || item.status === 'in-kitchen') && !item.claimedByChefId && (
          <button
            onClick={handleClaimAndStart}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg px-3 py-1.5 transition-colors"
          >
            Claim &amp; Start
          </button>
        )}

        {item.status === 'in-preparation' && isClaimedByMe && (
          <button
            onClick={handleMarkReady}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg px-3 py-1.5 transition-colors"
          >
            Mark Ready ✓
          </button>
        )}

        {item.status === 'in-preparation' && isClaimedByOther && (
          <span className="flex-1 text-center text-xs text-gray-500 bg-gray-100 rounded-lg px-3 py-1.5">
            Claimed by {claimedByName}
          </span>
        )}

        {item.status === 'ready' && isManager && (
          <button
            onClick={handleBump}
            className="flex-1 bg-gray-700 hover:bg-gray-800 text-white text-sm font-semibold rounded-lg px-3 py-1.5 transition-colors"
          >
            Bump ✓
          </button>
        )}

        {item.claimedByChefId && (isClaimedByMe || isManager) && (
          <button
            onClick={handleRelease}
            title="Release item"
            className="w-8 h-8 flex-shrink-0 flex items-center justify-center bg-red-100 hover:bg-red-200 text-red-600 rounded-lg text-sm font-bold transition-colors"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

function KanbanColumn({ title, items, tables, staffMap, currentProfile, tick, highlighted }) {
  return (
    <div className={`flex flex-col gap-3 min-w-0 flex-1 rounded-xl transition-all ${highlighted ? 'ring-2 ring-indigo-400 bg-indigo-50/40 p-2' : ''}`}>
      {/* Column header */}
      <div className="flex items-center gap-2 px-1">
        <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide flex-1 truncate">{title}</h2>
        <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 rounded-full bg-gray-200 text-gray-700 font-bold text-xs px-1.5">
          {items.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-3 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 160px)' }}>
        {items.length === 0 ? (
          <div className="text-center text-gray-400 text-sm py-10 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
            No items
          </div>
        ) : (
          items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              tables={tables}
              staffMap={staffMap}
              currentProfile={currentProfile}
              tick={tick}
            />
          ))
        )}
      </div>
    </div>
  );
}

// Map dashboard orderItem status → KDS column index (0=New, 1=InPrep, 2=Ready)
const STATUS_TO_COLUMN = {
  placed: 0, 'in-kitchen': 0,
  'in-preparation': 1,
  ready: 2,
}

export default function KDS() {
  const { profile } = useAuth();
  const location = useLocation();
  const incomingStatus = location.state?.filterStatus ?? null;
  const highlightCol = incomingStatus != null ? (STATUS_TO_COLUMN[incomingStatus] ?? null) : null;

  const [selectedStation, setSelectedStation] = useState('All');
  const [selectedTables, setSelectedTables] = useState(new Set()); // empty = all tables
  const [tick, setTick] = useState(0);

  // Live collections — no orderBy combined with 'in' filter (needs composite index);
  // sort by firedAt in JS instead.
  const { docs: rawOrderItems = [], loading: itemsLoading } = useCollection('orderItems', null, null);
  const { docs: tables = [] } = useCollection('tables', 'tableNumber');
  const { docs: staff = [] } = useCollection('staff', 'name');

  // Filter active statuses and sort by firedAt ascending
  const orderItems = rawOrderItems
    .filter((i) => ['placed', 'in-kitchen', 'in-preparation', 'ready'].includes(i.status))
    .sort((a, b) => (a.firedAt?.toMillis?.() ?? 0) - (b.firedAt?.toMillis?.() ?? 0));

  // Build staff id→name map
  const staffMap = useMemo(() => {
    const map = {};
    staff.forEach((s) => { map[s.id] = s.name; });
    return map;
  }, [staff]);

  // Tick every 30s to refresh relative timestamps
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  // Unique table numbers present in active orders — for filter pills
  const activeTableNums = useMemo(() => {
    const nums = [...new Set(orderItems.map(i => i.tableId))]
      .map(tid => tables.find(t => t.id === tid)?.tableNumber)
      .filter(Boolean)
      .sort((a, b) => a - b)
    return nums
  }, [orderItems, tables])

  // Toggle a table in/out of the selection set
  function toggleTable(num) {
    setSelectedTables(prev => {
      const next = new Set(prev)
      next.has(num) ? next.delete(num) : next.add(num)
      return next
    })
  }

  // Station + table filter
  const filteredItems = useMemo(() => {
    let items = selectedStation === 'All' ? orderItems : orderItems.filter(i => i.station === selectedStation)
    if (selectedTables.size > 0) {
      const allowedIds = new Set(
        tables.filter(t => selectedTables.has(t.tableNumber)).map(t => t.id)
      )
      items = items.filter(i => allowedIds.has(i.tableId))
    }
    return items
  }, [orderItems, selectedStation, selectedTables, tables]);

  // Kanban columns
  const newOrders = filteredItems.filter((i) => i.status === 'placed' || i.status === 'in-kitchen');
  const inPrep = filteredItems.filter((i) => i.status === 'in-preparation');
  const ready = filteredItems.filter((i) => i.status === 'ready');

  const isKitchenBusy = inPrep.length > 8;

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 flex-wrap">
        {/* Page title */}
        <div className="flex items-center gap-2 mr-2">
          <span className="text-lg font-bold text-gray-800">Kitchen Display</span>
        </div>

        {/* Kitchen load indicator */}
        <div
          className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold
            ${isKitchenBusy ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}
          `}
        >
          🍳 {inPrep.length} in prep
          {isKitchenBusy && <span className="ml-1 font-bold">· Kitchen Busy</span>}
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
              <button
                onClick={() => setSelectedTables(new Set())}
                className="text-xs text-gray-400 hover:text-gray-600 underline ml-1"
              >
                Clear
              </button>
            )}
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Station filter pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {STATIONS.map((station) => (
            <button
              key={station}
              onClick={() => setSelectedStation(station)}
              className={`px-3 py-1 rounded-full text-sm font-medium transition-colors
                ${selectedStation === station
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}
              `}
            >
              {station}
            </button>
          ))}
        </div>
      </div>

      {/* Kanban board */}
      {itemsLoading ? (
        <div className="flex-1 flex items-center justify-center text-gray-400 text-lg">
          Loading orders…
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 p-4 overflow-auto">
          <KanbanColumn
            title="New Orders 🆕"
            items={newOrders}
            tables={tables}
            staffMap={staffMap}
            currentProfile={profile}
            tick={tick}
            highlighted={highlightCol === 0}
          />
          <KanbanColumn
            title="In Preparation 🍳"
            items={inPrep}
            tables={tables}
            staffMap={staffMap}
            currentProfile={profile}
            tick={tick}
            highlighted={highlightCol === 1}
          />
          <KanbanColumn
            title="Ready for Pickup ✅"
            items={ready}
            tables={tables}
            staffMap={staffMap}
            currentProfile={profile}
            tick={tick}
            highlighted={highlightCol === 2}
          />
        </div>
      )}
    </div>
  );
}
