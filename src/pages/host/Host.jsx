import { useState, useMemo, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { collection, addDoc, updateDoc, doc, getDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import QRCode from 'react-qr-code';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import PageHeader from '../../components/PageHeader';
import TakeOrderModal from '../../components/TakeOrderModal';

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_STYLES = {
  available:      'bg-green-100 text-green-800 border-green-300',
  occupied:       'bg-amber-100 text-amber-800 border-amber-300',
  ordering:       'bg-orange-100 text-orange-800 border-orange-300',
  eating:         'bg-teal-100 text-teal-800 border-teal-300',
  bill_requested: 'bg-purple-100 text-purple-800 border-purple-300',
  reserved:       'bg-blue-100 text-blue-800 border-blue-300',
  cleaning:       'bg-gray-100 text-gray-700 border-gray-300',
  blocked:        'bg-red-100 text-red-800 border-red-300',
};

const STATUS_LABELS = {
  available:      'Available',
  occupied:       'Occupied',
  ordering:       'Ordering',
  eating:         'Eating',
  bill_requested: 'Bill Req.',
  reserved:       'Reserved',
  cleaning:       'Cleaning',
  blocked:        'Blocked',
};

const STATUS_CARD_BORDER = {
  available:      'border-green-300',
  occupied:       'border-amber-300',
  ordering:       'border-orange-300',
  eating:         'border-teal-300',
  bill_requested: 'border-purple-400',
  reserved:       'border-blue-300',
  cleaning:       'border-gray-300',
  blocked:        'border-red-300',
};

const TABLE_PREFS = ['Any', 'Window', 'Booth', 'Outdoor'];

const BOOKING_STATUS_STYLES = {
  waiting:   'bg-yellow-100 text-yellow-800',
  seated:    'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
  completed: 'bg-gray-100 text-gray-700',
};

const TODAY = format(new Date(), 'yyyy-MM-dd');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateToken() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return letters[Math.floor(Math.random() * letters.length)] + String(Math.floor(100 + Math.random() * 900));
}

function timeOccupied(seatedAt) {
  if (!seatedAt) return null;
  const ts = seatedAt.toDate ? seatedAt.toDate() : new Date(seatedAt);
  const diffMs = Date.now() - ts.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// ─── Auto-suggest helper ──────────────────────────────────────────────────────

function autoSuggest(partySize, preference, availableTables) {
  if (!partySize || availableTables.length === 0) return null

  const preferred = preference && preference !== 'Any'
    ? availableTables.filter(t => t.section === preference)
    : []
  const pool = preferred.length ? preferred : availableTables

  // 1. Single table — smallest capacity that fits, prefer preference section
  const single = pool
    .filter(t => t.capacity >= partySize)
    .sort((a, b) => a.capacity - b.capacity)
  if (single.length > 0) return { type: 'single', tables: [single[0]] }

  // Fallback: any section single fit
  const singleAny = availableTables
    .filter(t => t.capacity >= partySize)
    .sort((a, b) => a.capacity - b.capacity)
  if (singleAny.length > 0) return { type: 'single', tables: [singleAny[0]] }

  // 2. Two tables — prefer same section, pick largest two that combine to fit
  const sorted = [...availableTables].sort((a, b) => b.capacity - a.capacity)
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[i].capacity + sorted[j].capacity >= partySize) {
        return { type: 'linked', tables: [sorted[i], sorted[j]] }
      }
    }
  }

  return null // no solution found
}

// ─── Assign Modal ─────────────────────────────────────────────────────────────

// table prop is the pre-selected table (from floor plan) or null (from queue — user must pick)
function AssignModal({ table: preselectedTable, availableTables = [], waitingBookings, preselectedBookingId, onClose, onAssigned }) {
  const [search, setSearch]                   = useState('')
  const [selectedBookingId, setSelectedBookingId] = useState(preselectedBookingId ?? null)
  const [selectedTableId, setSelectedTableId] = useState(preselectedTable?.id ?? '')
  const [linkedMode, setLinkedMode]           = useState(false)
  const [secondTableId, setSecondTableId]     = useState('')
  const [guestName, setGuestName]             = useState('')
  const [mobile, setMobile]                   = useState('')
  const [partySize, setPartySize]             = useState(1)
  const [isWalkIn, setIsWalkIn]               = useState(false)
  const [loading, setLoading]                 = useState(false)

  // Effective party size from selected booking or walk-in input
  const selectedBooking = waitingBookings.find(b => b.id === selectedBookingId)
  const effectivePartySize = isWalkIn ? Number(partySize) : (selectedBooking?.partySize ?? 0)
  const effectivePreference = isWalkIn ? 'Any' : (selectedBooking?.tablePreference ?? 'Any')

  // Auto-suggest — runs whenever party size / preference / available tables change
  const suggestion = useMemo(
    () => preselectedTable ? null : autoSuggest(effectivePartySize, effectivePreference, availableTables),
    [effectivePartySize, effectivePreference, JSON.stringify(availableTables.map(t => t.id))]
  )

  // Apply suggestion automatically when it changes
  useEffect(() => {
    if (!suggestion) return
    if (suggestion.type === 'single') {
      setSelectedTableId(suggestion.tables[0].id)
      setLinkedMode(false)
      setSecondTableId('')
    } else {
      setSelectedTableId(suggestion.tables[0].id)
      setSecondTableId(suggestion.tables[1].id)
      setLinkedMode(true)
    }
  }, [suggestion?.type, suggestion?.tables?.map(t => t.id).join(',')])

  const resolvedTable  = preselectedTable ?? availableTables.find(t => t.id === selectedTableId) ?? null
  const resolvedTable2 = linkedMode ? availableTables.find(t => t.id === secondTableId) ?? null : null

  const filtered = useMemo(() => {
    if (!search.trim()) return waitingBookings
    const q = search.toLowerCase()
    return waitingBookings.filter(b =>
      (b.token && b.token.toLowerCase().includes(q)) ||
      (b.guestName && b.guestName.toLowerCase().includes(q))
    )
  }, [search, waitingBookings])

  async function handleAssign() {
    if (!resolvedTable) { toast.error('Select an available table first.'); return }
    if (linkedMode && !resolvedTable2) { toast.error('Select the second table for linking.'); return }
    if (!isWalkIn && !selectedBookingId) { toast.error('Select a guest from the queue or use walk-in.'); return }
    if (isWalkIn && !guestName.trim()) { toast.error('Enter guest name.'); return }

    setLoading(true)
    try {
      let bookingId = selectedBookingId
      const tableIds = [resolvedTable.id, ...(resolvedTable2 ? [resolvedTable2.id] : [])]

      if (isWalkIn) {
        const ref = await addDoc(collection(db, 'bookings'), {
          guestName:      guestName.trim(),
          mobile:         mobile.trim(),
          partySize:      Number(partySize),
          tablePreference: 'Any',
          type:           'walk-in',
          status:         'seated',
          date:           TODAY,
          token:          generateToken(),
          firedAt:        serverTimestamp(),
          queueSequence:  Date.now(),
          tableId:        resolvedTable.id,
          tableIds,
          seatedAt:       serverTimestamp(),
        })
        bookingId = ref.id
      } else {
        await updateDoc(doc(db, 'bookings', bookingId), {
          status:   'seated',
          tableId:  resolvedTable.id,
          tableIds,
          seatedAt: serverTimestamp(),
        })
      }

      await updateDoc(doc(db, 'tables', resolvedTable.id), {
        status:           'occupied',
        currentBookingId: bookingId,
        linkedTableId:    resolvedTable2?.id ?? null,
        seatedAt:         serverTimestamp(),
      })

      if (resolvedTable2) {
        await updateDoc(doc(db, 'tables', resolvedTable2.id), {
          status:           'occupied',
          currentBookingId: bookingId,
          linkedTableId:    resolvedTable.id,
          seatedAt:         serverTimestamp(),
        })
      }

      const msg = resolvedTable2
        ? `Tables ${resolvedTable.tableNumber} & ${resolvedTable2.tableNumber} linked and assigned.`
        : `Table ${resolvedTable.tableNumber} assigned.`
      toast.success(msg)
      onAssigned({
        tableId: resolvedTable.id,
        tableNumber: resolvedTable.tableNumber,
        guestName: isWalkIn ? guestName.trim() : (selectedBooking?.guestName ?? 'Guest'),
      })
    } catch (err) {
      console.error(err)
      toast.error('Failed to assign table.')
    } finally {
      setLoading(false)
    }
  }

  const combinedCapacity = (resolvedTable?.capacity ?? 0) + (resolvedTable2?.capacity ?? 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-800">
            {preselectedTable ? `Assign Table ${preselectedTable.tableNumber}` : 'Seat Guest'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Guest source toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => { setIsWalkIn(false); setSelectedBookingId(null) }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border transition ${!isWalkIn ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
            >
              From Queue
            </button>
            <button
              onClick={() => { setIsWalkIn(true); setSelectedBookingId(null) }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border transition ${isWalkIn ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
            >
              Walk-in
            </button>
          </div>

          {/* Guest selection */}
          {!isWalkIn ? (
            <>
              <input
                type="text"
                placeholder="Search by token or guest name…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <div className="max-h-40 overflow-y-auto divide-y divide-gray-100 border border-gray-200 rounded-lg">
                {filtered.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">No waiting guests.</p>
                ) : (
                  filtered.map(b => (
                    <button
                      key={b.id}
                      onClick={() => setSelectedBookingId(b.id)}
                      className={`w-full flex items-center justify-between px-4 py-2 text-sm text-left hover:bg-indigo-50 transition ${selectedBookingId === b.id ? 'bg-indigo-100' : ''}`}
                    >
                      <span className="font-medium text-gray-800">{b.token} — {b.guestName}</span>
                      <span className="text-gray-500">👥 {b.partySize}</span>
                    </button>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <input type="text" placeholder="Guest name *" value={guestName} onChange={e => setGuestName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              <input type="tel" placeholder="+91 98765 43210" value={mobile} onChange={e => setMobile(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              <input type="number" placeholder="Party size" min={1} value={partySize} onChange={e => setPartySize(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
          )}

          {/* Auto-suggestion banner */}
          {!preselectedTable && suggestion && effectivePartySize > 0 && (
            <div className={`rounded-lg px-4 py-3 text-sm flex items-start gap-2 ${suggestion.type === 'linked' ? 'bg-amber-50 border border-amber-200' : 'bg-green-50 border border-green-200'}`}>
              <span className="text-lg leading-none mt-0.5">{suggestion.type === 'linked' ? '🔗' : '✅'}</span>
              <div>
                <p className={`font-medium ${suggestion.type === 'linked' ? 'text-amber-800' : 'text-green-800'}`}>
                  {suggestion.type === 'single'
                    ? `Best fit: Table ${suggestion.tables[0].tableNumber} (${suggestion.tables[0].section}, ${suggestion.tables[0].capacity} seats)`
                    : `No single table fits — linking Table ${suggestion.tables[0].tableNumber} + Table ${suggestion.tables[1].tableNumber} (${suggestion.tables[0].capacity + suggestion.tables[1].capacity} seats combined)`
                  }
                </p>
                <p className="text-xs text-gray-500 mt-0.5">Auto-selected below. Override if needed.</p>
              </div>
            </div>
          )}

          {!preselectedTable && !suggestion && effectivePartySize > 0 && (
            <div className="rounded-lg px-4 py-3 text-sm bg-red-50 border border-red-200 text-red-700">
              ⚠ No available tables can fit a party of {effectivePartySize}. Free up tables first.
            </div>
          )}

          {/* Table selectors — shown when opening from queue */}
          {!preselectedTable && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  {linkedMode ? 'Table 1 *' : 'Table *'}
                </label>
                <select
                  value={selectedTableId}
                  onChange={e => setSelectedTableId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                >
                  <option value="">— choose a table —</option>
                  {availableTables.map(t => (
                    <option key={t.id} value={t.id} disabled={t.id === secondTableId}>
                      Table {t.tableNumber} · {t.section} · Seats {t.capacity}
                    </option>
                  ))}
                </select>
              </div>

              {/* Link second table toggle */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setLinkedMode(v => !v); setSecondTableId('') }}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${linkedMode ? 'bg-amber-500' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${linkedMode ? 'translate-x-4' : 'translate-x-1'}`} />
                </button>
                <span className="text-sm text-gray-700">Link a second table</span>
                {linkedMode && combinedCapacity > 0 && (
                  <span className="text-xs text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full ml-auto">
                    {combinedCapacity} seats combined
                  </span>
                )}
              </div>

              {linkedMode && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Table 2 *</label>
                  <select
                    value={secondTableId}
                    onChange={e => setSecondTableId(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                  >
                    <option value="">— choose second table —</option>
                    {availableTables.map(t => (
                      <option key={t.id} value={t.id} disabled={t.id === selectedTableId}>
                        Table {t.tableNumber} · {t.section} · Seats {t.capacity}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* When opened from floor plan, optionally link a second table */}
          {preselectedTable && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setLinkedMode(v => !v); setSecondTableId('') }}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${linkedMode ? 'bg-amber-500' : 'bg-gray-300'}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${linkedMode ? 'translate-x-4' : 'translate-x-1'}`} />
                </button>
                <span className="text-sm text-gray-700">Link a second table</span>
                {linkedMode && combinedCapacity > 0 && (
                  <span className="text-xs text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full ml-auto">
                    {combinedCapacity} seats combined
                  </span>
                )}
              </div>
              {linkedMode && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Second Table *</label>
                  <select
                    value={secondTableId}
                    onChange={e => setSecondTableId(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                  >
                    <option value="">— choose second table —</option>
                    {availableTables.map(t => (
                      <option key={t.id} value={t.id} disabled={t.id === preselectedTable.id}>
                        Table {t.tableNumber} · {t.section} · Seats {t.capacity}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t flex-shrink-0">
          <button onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition">
            Cancel
          </button>
          <button onClick={handleAssign} disabled={loading}
            className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 transition font-medium">
            {loading ? 'Assigning…' : linkedMode ? '🔗 Link & Seat' : 'Confirm & Seat'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── QR Code Modal ────────────────────────────────────────────────────────────

function QRCodeModal({ tableId, tableNumber, guestName, onClose }) {
  const base = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, '')
  const url = `${base}/guest/${tableId}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm text-center p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-1">Table {tableNumber} — Seated</h2>
        <p className="text-sm text-gray-500 mb-5">
          Share this QR with <span className="font-medium text-gray-700">{guestName}</span> to order directly from their phone
        </p>
        <div className="flex justify-center mb-5 p-3 bg-white border border-gray-200 rounded-xl">
          <QRCode value={url} size={180} />
        </div>
        <p className="text-xs text-gray-400 mb-5 break-all">{url}</p>
        <div className="flex gap-3">
          <button
            onClick={() => navigator.clipboard?.writeText(url).then(() => alert('Link copied!'))}
            className="flex-1 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50 transition"
          >
            📋 Copy Link
          </button>
          <button onClick={onClose}
            className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Table Card ───────────────────────────────────────────────────────────────

function TableCard({ table, waitingBookings, availableTables = [], hasReadyItems = false, allDelivered = false }) {
  const [showAssign, setShowAssign] = useState(false);
  const [showOrder, setShowOrder] = useState(false);
  const [qrInfo, setQrInfo] = useState(null);

  async function markStatus(status) {
    try {
      const updates = { status }
      if (status === 'available') {
        updates.currentBookingId = null
        updates.seatedAt = null
        updates.linkedTableId = null
      }
      await updateDoc(doc(db, 'tables', table.id), updates)
      // If freeing a linked table, free the partner too
      if (status === 'available' && table.linkedTableId) {
        await updateDoc(doc(db, 'tables', table.linkedTableId), {
          status: 'available',
          currentBookingId: null,
          seatedAt: null,
          linkedTableId: null,
        })
        toast.success(`Tables ${table.tableNumber} & linked table freed.`)
      } else {
        toast.success(`Table ${table.tableNumber} marked ${status}.`)
      }
    } catch (err) {
      console.error(err)
      toast.error('Update failed.')
    }
  }

  async function returnToQueue() {
    if (!window.confirm(`Return Table ${table.tableNumber} guest to the waiting queue?`)) return
    try {
      // Free this table
      await updateDoc(doc(db, 'tables', table.id), {
        status: 'available',
        currentBookingId: null,
        seatedAt: null,
        linkedTableId: null,
      })
      // Free linked table if any
      if (table.linkedTableId) {
        await updateDoc(doc(db, 'tables', table.linkedTableId), {
          status: 'available',
          currentBookingId: null,
          seatedAt: null,
          linkedTableId: null,
        })
      }
      // Put booking back to waiting
      if (table.currentBookingId) {
        await updateDoc(doc(db, 'bookings', table.currentBookingId), {
          status: 'waiting',
          tableId: null,
          tableIds: null,
          seatedAt: null,
        })
      }
      toast.success(`Table ${table.tableNumber} freed — guest returned to queue.`)
    } catch (err) {
      console.error(err)
      toast.error('Could not return guest to queue.')
    }
  }

  async function showQR() {
    let guestName = 'Guest'
    if (table.currentBookingId) {
      try {
        const snap = await getDoc(doc(db, 'bookings', table.currentBookingId))
        if (snap.exists()) guestName = snap.data().guestName ?? 'Guest'
      } catch {}
    }
    setQrInfo({ tableId: table.id, tableNumber: table.tableNumber, guestName })
  }

  const elapsed = table.status === 'occupied' ? timeOccupied(table.seatedAt) : null;

  return (
    <>
      <div className={`bg-white rounded-xl border-2 ${STATUS_CARD_BORDER[table.status] || 'border-gray-200'} shadow-sm p-4 flex flex-col gap-3`}>
        <div className="flex items-start justify-between">
          <div>
            <span className="text-lg font-bold text-gray-800">Table {table.tableNumber}</span>
            {table.section && (
              <span className="ml-2 text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full">{table.section}</span>
            )}
          </div>
          <span className={`text-xs font-semibold px-2 py-1 rounded-full border whitespace-nowrap ${STATUS_STYLES[table.status] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
            {STATUS_LABELS[table.status] ?? table.status}
          </span>
        </div>

        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>👥 {table.capacity}</span>
          {table.assignedServer && <span>🧑‍🍳 {table.assignedServer}</span>}
          {elapsed && <span className="text-amber-600">⏱ {elapsed}</span>}
          {table.linkedTableId && <span className="text-xs text-amber-600 font-medium">🔗 Linked</span>}
          {hasReadyItems && (
            <span className="flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full animate-pulse">
              🔔 Ready
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mt-1">
          {(table.status === 'available') && (
            <button
              onClick={() => setShowAssign(true)}
              className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium"
            >
              Assign Guest
            </button>
          )}
          {table.status === 'reserved' && (
            <button
              onClick={() => setShowAssign(true)}
              className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium"
            >
              Seat Guest
            </button>
          )}
          {['occupied', 'ordering', 'eating', 'bill_requested'].includes(table.status) && (
            <>
              <button
                onClick={() => setShowOrder(true)}
                className={`text-xs px-3 py-1.5 rounded-lg text-white transition font-medium ${hasReadyItems ? 'bg-green-600 hover:bg-green-700 animate-pulse' : 'bg-orange-500 hover:bg-orange-600'}`}
              >
                {hasReadyItems ? '🔔 Orders Ready' : '🍽️ Take Order'}
              </button>
              <button
                onClick={showQR}
                className="text-xs px-3 py-1.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition font-medium"
              >
                📱 Show QR
              </button>
              {table.status !== 'bill_requested' && (
                <button
                  onClick={() => markStatus('bill_requested')}
                  className={`text-xs px-3 py-1.5 rounded-lg text-white transition font-medium ${
                    allDelivered
                      ? 'bg-green-600 hover:bg-green-700 animate-pulse'
                      : 'bg-purple-600 hover:bg-purple-700'
                  }`}
                >
                  {allDelivered ? '✅ Send to Billing' : '💳 Send to Billing'}
                </button>
              )}
              <button
                onClick={returnToQueue}
                className="text-xs px-3 py-1.5 bg-rose-500 text-white rounded-lg hover:bg-rose-600 transition font-medium"
              >
                ↩ Return to Queue
              </button>
              <button
                onClick={() => markStatus('cleaning')}
                className="text-xs px-3 py-1.5 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition font-medium"
              >
                Mark Cleaning
              </button>
            </>
          )}
          {table.status === 'cleaning' && (
            <button
              onClick={() => markStatus('available')}
              className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-medium"
            >
              Mark Available
            </button>
          )}
        </div>
      </div>

      {showAssign && (
        <AssignModal
          table={table}
          availableTables={availableTables.filter(t => t.id !== table.id)}
          waitingBookings={waitingBookings}
          onClose={() => setShowAssign(false)}
          onAssigned={(info) => { setShowAssign(false); setQrInfo(info); }}
        />
      )}

      {showOrder && (
        <TakeOrderModal table={table} onClose={() => setShowOrder(false)} />
      )}

      {qrInfo && (
        <QRCodeModal {...qrInfo} onClose={() => setQrInfo(null)} />
      )}
    </>
  );
}

// ─── Floor Plan Tab ───────────────────────────────────────────────────────────

const FLOOR_FILTER_PILLS = [
  { key: 'all',       label: 'All' },
  { key: 'occupied',  label: 'Occupied' },
  { key: 'available', label: 'Available' },
  { key: 'cleaning',  label: 'Cleaning' },
];

const OCCUPIED_STATUSES = ['occupied', 'ordering', 'eating', 'bill_requested'];

function FloorPlanTab({ waitingBookings, initialFilter = 'all' }) {
  const { docs: tables = [], loading } = useCollection('tables', 'tableNumber');
  const { docs: readyItems = [] } = useCollection('orderItems', null, null, [['status', '==', 'ready']]);
  const { docs: activeItems = [] } = useCollection('orderItems', null, null, [['status', 'in', ['placed','in-kitchen','in-preparation']]]);
  const { docs: servedItems = [] } = useCollection('orderItems', null, null, [['status', '==', 'served']]);

  const readyTableIds = useMemo(() => new Set(readyItems.map(i => i.tableId)), [readyItems]);

  // Tables where every kitchen item is served (none still cooking/ready) and at least one was served
  const allDeliveredTableIds = useMemo(() => {
    const activeSet = new Set(activeItems.map(i => i.tableId));
    const readySet  = new Set(readyItems.map(i => i.tableId));
    const servedSet = new Set(servedItems.map(i => i.tableId));
    // All delivered = has served items, zero active items, zero ready items
    return new Set([...servedSet].filter(tid => !activeSet.has(tid) && !readySet.has(tid)));
  }, [activeItems, readyItems, servedItems]);

  const [statusFilter, setStatusFilter] = useState(initialFilter === 'occupied' ? 'occupied' : 'all');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
        Loading floor plan…
      </div>
    );
  }

  if (!tables || tables.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
        No tables configured.
      </div>
    );
  }

  const filteredTables = tables.filter(t => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'occupied') return OCCUPIED_STATUSES.includes(t.status);
    return t.status === statusFilter;
  });

  const sections = [...new Set(filteredTables.map(t => t.section || 'Main'))].sort();
  const availableTables = tables.filter(t => t.status === 'available');

  return (
    <div className="space-y-6">
      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2">
        {FLOOR_FILTER_PILLS.map(pill => (
          <button
            key={pill.key}
            onClick={() => setStatusFilter(pill.key)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              statusFilter === pill.key
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400 hover:text-indigo-600'
            }`}
          >
            {pill.label}
          </button>
        ))}
      </div>

      {filteredTables.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-8">No tables match this filter.</p>
      )}

      {sections.map(section => {
        const sectionTables = filteredTables.filter(t => (t.section || 'Main') === section);
        if (sectionTables.length === 0) return null;
        return (
          <div key={section}>
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{section}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {sectionTables.map(table => (
                <TableCard
                  key={table.id}
                  table={table}
                  waitingBookings={waitingBookings}
                  availableTables={availableTables}
                  hasReadyItems={readyTableIds.has(table.id)}
                  allDelivered={allDeliveredTableIds.has(table.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Queue & Reservations Tab ─────────────────────────────────────────────────

function QueueTab() {
  const { docs: allBookings = [], loading } = useCollection('bookings', 'queueSequence', 'asc');

  const [showReservationForm, setShowReservationForm] = useState(false);
  const [assignTarget, setAssignTarget] = useState(null);
  const [qrInfo, setQrInfo] = useState(null);

  // Walk-in form state
  const [wiGuestName, setWiGuestName]         = useState('');
  const [wiMobile, setWiMobile]               = useState('');
  const [wiPartySize, setWiPartySize]         = useState(2);
  const [wiPref, setWiPref]                   = useState('Any');
  const [wiLoading, setWiLoading]             = useState(false);

  // Reservation form state — reuses walk-in fields, only needs date/time
  const [resDateTime, setResDateTime]         = useState('');
  const [resLoading, setResLoading]           = useState(false);

  const todayBookings = useMemo(() => {
    if (!allBookings) return [];
    return allBookings
      .filter(b => b.date === TODAY && b.status !== 'cancelled' && b.status !== 'completed')
      .sort((a, b) => (a.queueSequence || 0) - (b.queueSequence || 0));
  }, [allBookings]);

  const waitingBookings = useMemo(() => todayBookings.filter(b => b.status === 'waiting'), [todayBookings]);

  async function addWalkIn(e) {
    e.preventDefault();
    if (!wiGuestName.trim()) { toast.error('Guest name is required.'); return; }
    if (!wiPartySize || wiPartySize < 1) { toast.error('Party size must be at least 1.'); return; }
    setWiLoading(true);
    try {
      await addDoc(collection(db, 'bookings'), {
        guestName: wiGuestName.trim(),
        mobile: wiMobile.trim(),
        partySize: Number(wiPartySize),
        tablePreference: wiPref,
        type: 'walk-in',
        status: 'waiting',
        date: TODAY,
        token: generateToken(),
        firedAt: serverTimestamp(),
        queueSequence: Date.now(),
      });
      toast.success('Walk-in added to queue.');
      setWiGuestName(''); setWiMobile(''); setWiPartySize(2); setWiPref('Any');
    } catch (err) {
      console.error(err);
      toast.error('Failed to add walk-in.');
    } finally {
      setWiLoading(false);
    }
  }

  async function addReservation(e) {
    e.preventDefault();
    if (!wiGuestName.trim()) { toast.error('Guest name is required — fill in the walk-in form above.'); return; }
    if (!resDateTime) { toast.error('Reservation date/time is required.'); return; }
    setResLoading(true);
    try {
      const dt = new Date(resDateTime);
      await addDoc(collection(db, 'bookings'), {
        guestName: wiGuestName.trim(),
        mobile: wiMobile.trim(),
        partySize: Number(wiPartySize),
        tablePreference: wiPref,
        type: 'reservation',
        status: 'waiting',
        date: format(dt, 'yyyy-MM-dd'),
        reservationTime: Timestamp.fromDate(dt),
        token: generateToken(),
        firedAt: serverTimestamp(),
        queueSequence: dt.getTime(),
      });
      toast.success('Reservation created.');
      setWiGuestName(''); setWiMobile(''); setWiPartySize(2); setWiPref('Any'); setResDateTime('');
      setShowReservationForm(false);
    } catch (err) {
      console.error(err);
      toast.error('Failed to create reservation.');
    } finally {
      setResLoading(false);
    }
  }

  async function moveToEnd(bookingId) {
    try {
      await updateDoc(doc(db, 'bookings', bookingId), { queueSequence: Date.now() });
      toast.success('Moved to end of queue.');
    } catch (err) {
      toast.error('Update failed.');
    }
  }

  async function cancelBooking(bookingId) {
    try {
      await updateDoc(doc(db, 'bookings', bookingId), { status: 'cancelled' });
      toast.success('Booking cancelled.');
    } catch (err) {
      toast.error('Cancel failed.');
    }
  }

  const { docs: tables = [] } = useCollection('tables', 'tableNumber');
  const { docs: rawDraftOrders1 = [] } = useCollection('orders', null, null, [['status', '==', 'draft']]);
  const draftOrders = rawDraftOrders1.slice().sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0));

  async function confirmOrder(orderId) {
    try {
      const orderSnap = await getDoc(doc(db, 'orders', orderId));
      if (!orderSnap.exists()) { toast.error('Order not found.'); return; }
      const order = { id: orderSnap.id, ...orderSnap.data() };

      // Create orderItems so KDS picks them up
      await Promise.all(
        (order.items ?? []).map(item =>
          addDoc(collection(db, 'orderItems'), {
            tableId:             order.tableId,
            orderId:             orderId,
            menuItemId:          item.menuItemId ?? null,
            name:                item.name,
            category:            item.category ?? 'Uncategorized',
            price:               item.price ?? 0,
            qty:                 item.qty ?? 1,
            modifiers:           [],
            specialInstructions: item.specialInstructions ?? '',
            status:              'placed',
            firedAt:             serverTimestamp(),
            servedAt:            null,
            claimedByChefId:     null,
          })
        )
      );

      await updateDoc(doc(db, 'orders', orderId), {
        status: 'new',
        confirmedAt: serverTimestamp(),
      });

      toast.success('Order confirmed — sent to kitchen.');
    } catch (err) {
      console.error(err);
      toast.error('Failed to confirm order.');
    }
  }

  async function rejectOrder(orderId) {
    try {
      await updateDoc(doc(db, 'orders', orderId), { status: 'rejected' });
      toast.success('Order rejected.');
    } catch (err) {
      console.error(err);
      toast.error('Failed to reject order.');
    }
  }

  return (
    <div className="space-y-6">
      {/* Pending Draft Orders */}
      {draftOrders.length > 0 && (
        <div className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-amber-100 bg-amber-50 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-amber-800">Pending Guest Orders</h3>
              <p className="text-xs text-amber-600 mt-0.5">Confirm to send to kitchen, or reject.</p>
            </div>
            <span className="bg-amber-500 text-white text-xs font-bold px-2.5 py-1 rounded-full">{draftOrders.length}</span>
          </div>
          <div className="divide-y divide-gray-100">
            {draftOrders.map(order => (
              <div key={order.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="font-medium text-gray-800 text-sm">
                      Table {order.tableNumber}
                      <span className="ml-2 text-gray-500 font-normal">· {order.guestName}</span>
                    </p>
                    {order.createdAt?.toDate && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {order.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    )}
                  </div>
                  <p className="text-amber-600 font-semibold text-sm flex-shrink-0">₹{order.total?.toLocaleString('en-IN')}</p>
                </div>
                <ul className="text-xs text-gray-600 space-y-0.5 mb-3">
                  {(order.items ?? []).map((item, i) => (
                    <li key={i} className="flex justify-between">
                      <span>{item.qty}× {item.name}</span>
                      <span className="text-gray-400">₹{(item.price * item.qty).toLocaleString('en-IN')}</span>
                    </li>
                  ))}
                </ul>
                {order.note && (
                  <p className="text-xs text-gray-500 italic mb-3">Note: {order.note}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => confirmOrder(order.id)}
                    className="flex-1 py-1.5 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 transition"
                  >
                    ✓ Confirm & Send to Kitchen
                  </button>
                  <button
                    onClick={() => rejectOrder(order.id)}
                    className="px-4 py-1.5 border border-red-200 text-red-600 text-xs font-semibold rounded-lg hover:bg-red-50 transition"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Walk-in Form */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800">Add Walk-in Guest</h3>
        </div>
        <form onSubmit={addWalkIn} className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Guest Name *</label>
              <input
                type="text"
                value={wiGuestName}
                onChange={e => setWiGuestName(e.target.value)}
                placeholder="John Smith"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Mobile</label>
              <input
                type="tel"
                value={wiMobile}
                onChange={e => setWiMobile(e.target.value)}
                placeholder="+91 98765 43210"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Party Size</label>
              <input
                type="number"
                min={1}
                max={20}
                value={wiPartySize}
                onChange={e => setWiPartySize(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Table Preference</label>
              <select
                value={wiPref}
                onChange={e => setWiPref(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
              >
                {TABLE_PREFS.map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="submit"
              disabled={wiLoading}
              className="px-5 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-60 transition"
            >
              {wiLoading ? 'Adding…' : 'Add to Queue'}
            </button>
            <button
              type="button"
              onClick={() => setShowReservationForm(v => !v)}
              className="px-5 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition"
            >
              {showReservationForm ? 'Hide Reservation Form' : '+ Add Reservation'}
            </button>
          </div>
        </form>

        {/* Reservation Form (collapsible) — guest details reused from walk-in form above */}
        {showReservationForm && (
          <div className="border-t border-gray-100 bg-gray-50 rounded-b-xl">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-700 text-sm">New Reservation</h3>
              <p className="text-xs text-gray-400 mt-0.5">Guest details are taken from the form above — just pick a date &amp; time.</p>
            </div>
            <form onSubmit={addReservation} className="p-5">
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date &amp; Time *</label>
                  <input
                    type="datetime-local"
                    value={resDateTime}
                    onChange={e => setResDateTime(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                  />
                </div>
                <button
                  type="submit"
                  disabled={resLoading}
                  className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition"
                >
                  {resLoading ? 'Saving…' : 'Create Reservation'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* Queue Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-800">Today's Queue</h3>
            <p className="text-xs text-gray-400 mt-0.5">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
          </div>
          <span className="text-sm text-gray-500">
            {waitingBookings.length} waiting
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-32 text-gray-400 text-sm">Loading queue…</div>
        ) : todayBookings.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-400 text-sm">No guests today yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Token</th>
                  <th className="px-4 py-3 text-left font-semibold">Guest</th>
                  <th className="px-4 py-3 text-left font-semibold">Party</th>
                  <th className="px-4 py-3 text-left font-semibold">Preference</th>
                  <th className="px-4 py-3 text-left font-semibold">Type</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-left font-semibold">EWT</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {todayBookings.map((booking, idx) => {
                  const waitingPosition = waitingBookings.findIndex(b => b.id === booking.id);
                  const ewt = waitingPosition >= 0 ? `~${(waitingPosition + 1) * 20} min` : '—';

                  return (
                    <tr key={booking.id} className="hover:bg-gray-50 transition">
                      <td className="px-4 py-3 font-mono font-semibold text-indigo-700">
                        {booking.token || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-800">{booking.guestName}</div>
                        {booking.mobile && <div className="text-xs text-gray-400">{booking.mobile}</div>}
                      </td>
                      <td className="px-4 py-3 text-gray-700">👥 {booking.partySize}</td>
                      <td className="px-4 py-3 text-gray-600">{booking.tablePreference || 'Any'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${booking.type === 'reservation' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                          {booking.type === 'reservation' ? 'Reservation' : 'Walk-in'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${BOOKING_STATUS_STYLES[booking.status] || 'bg-gray-100 text-gray-600'}`}>
                          {booking.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{ewt}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {booking.status === 'waiting' && (
                            <>
                              <button
                                onClick={() => setAssignTarget(booking)}
                                className="text-xs px-2.5 py-1 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium whitespace-nowrap"
                              >
                                Seat
                              </button>
                              <button
                                onClick={() => moveToEnd(booking.id)}
                                className="text-xs px-2.5 py-1 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-100 transition font-medium whitespace-nowrap"
                              >
                                Move to End
                              </button>
                              <button
                                onClick={() => cancelBooking(booking.id)}
                                className="text-xs px-2.5 py-1 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition font-medium"
                              >
                                Cancel
                              </button>
                            </>
                          )}
                          {booking.status === 'seated' && (
                            <span className="text-xs text-green-600 font-medium">Seated</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Assign modal triggered from queue — user picks table; booking pre-selected */}
      {assignTarget && (
        <AssignModal
          table={null}
          availableTables={tables.filter(t => t.status === 'available')}
          waitingBookings={waitingBookings}
          preselectedBookingId={assignTarget.id}
          onClose={() => setAssignTarget(null)}
          onAssigned={(info) => { setAssignTarget(null); setQrInfo(info); }}
        />
      )}

      {qrInfo && (
        <QRCodeModal {...qrInfo} onClose={() => setQrInfo(null)} />
      )}
    </div>
  );
}

// ─── Host Page ────────────────────────────────────────────────────────────────

export default function Host() {
  const { user } = useAuth();
  const location = useLocation();
  const initialFilter = location.state?.filterStatus ?? 'all';
  const [activeTab, setActiveTab] = useState('floor');

  const { docs: allBookings = [] } = useCollection('bookings', null, null);
  const { docs: rawDraftOrders2 = [] } = useCollection('orders', null, null, [['status', '==', 'draft']]);
  const draftOrders = rawDraftOrders2.slice().sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0));

  const waitingBookings = useMemo(() => {
    if (!allBookings) return [];
    return allBookings.filter(b => b.date === TODAY && b.status === 'waiting');
  }, [allBookings]);

  const tabs = [
    { id: 'floor', label: 'Floor Plan' },
    { id: 'queue', label: 'Queue & Reservations', draftCount: draftOrders.length },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader
        title="Host Station"
        subtitle={`${format(new Date(), 'EEEE, MMMM d')} · ${waitingBookings.length} waiting`}
        actions={
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="hidden sm:inline">Signed in as</span>
            <span className="font-medium text-gray-700">{user?.displayName || user?.email || 'Host'}</span>
          </div>
        }
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Tab Bar */}
        <div className="flex gap-1 bg-white border border-gray-200 rounded-xl p-1 shadow-sm mb-6 w-fit">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition ${
                activeTab === tab.id
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {tab.label}
              {tab.id === 'queue' && waitingBookings.length > 0 && (
                <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full font-semibold ${activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-700'}`}>
                  {waitingBookings.length}
                </span>
              )}
              {tab.id === 'queue' && tab.draftCount > 0 && (
                <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full font-semibold ${activeTab === tab.id ? 'bg-amber-400 text-white' : 'bg-amber-500 text-white'}`}>
                  {tab.draftCount} orders
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'floor' ? (
          <FloorPlanTab waitingBookings={waitingBookings} initialFilter={initialFilter} />
        ) : (
          <QueueTab />
        )}
      </div>
    </div>
  );
}
