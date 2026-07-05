import { useState, useMemo } from 'react';
import { collection, addDoc, updateDoc, doc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import PageHeader from '../../components/PageHeader';

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_STYLES = {
  available: 'bg-green-100 text-green-800 border-green-300',
  occupied:  'bg-amber-100 text-amber-800 border-amber-300',
  reserved:  'bg-blue-100 text-blue-800 border-blue-300',
  cleaning:  'bg-gray-100 text-gray-700 border-gray-300',
  blocked:   'bg-red-100 text-red-800 border-red-300',
};

const STATUS_CARD_BORDER = {
  available: 'border-green-300',
  occupied:  'border-amber-300',
  reserved:  'border-blue-300',
  cleaning:  'border-gray-300',
  blocked:   'border-red-300',
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

// ─── Assign Modal ─────────────────────────────────────────────────────────────

function AssignModal({ table, waitingBookings, onClose, onAssigned }) {
  const [search, setSearch] = useState('');
  const [selectedBookingId, setSelectedBookingId] = useState(null);
  const [guestName, setGuestName] = useState('');
  const [mobile, setMobile] = useState('');
  const [partySize, setPartySize] = useState(1);
  const [isWalkIn, setIsWalkIn] = useState(false);
  const [loading, setLoading] = useState(false);

  const filtered = useMemo(() => {
    if (!search.trim()) return waitingBookings;
    const q = search.toLowerCase();
    return waitingBookings.filter(
      b =>
        (b.token && b.token.toLowerCase().includes(q)) ||
        (b.guestName && b.guestName.toLowerCase().includes(q))
    );
  }, [search, waitingBookings]);

  async function handleAssign() {
    if (!isWalkIn && !selectedBookingId) {
      toast.error('Select a guest from the queue or use walk-in.');
      return;
    }
    if (isWalkIn && !guestName.trim()) {
      toast.error('Enter guest name.');
      return;
    }
    setLoading(true);
    try {
      let bookingId = selectedBookingId;

      if (isWalkIn) {
        const ref = await addDoc(collection(db, 'bookings'), {
          guestName: guestName.trim(),
          mobile: mobile.trim(),
          partySize: Number(partySize),
          tablePreference: 'Any',
          type: 'walk-in',
          status: 'seated',
          date: TODAY,
          token: generateToken(),
          firedAt: serverTimestamp(),
          queueSequence: Date.now(),
          tableId: table.id,
          seatedAt: serverTimestamp(),
        });
        bookingId = ref.id;
      } else {
        await updateDoc(doc(db, 'bookings', bookingId), {
          status: 'seated',
          tableId: table.id,
          seatedAt: serverTimestamp(),
        });
      }

      await updateDoc(doc(db, 'tables', table.id), {
        status: 'occupied',
        currentBookingId: bookingId,
        seatedAt: serverTimestamp(),
      });

      toast.success(`Table ${table.tableNumber} assigned.`);
      onAssigned();
    } catch (err) {
      console.error(err);
      toast.error('Failed to assign table.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-800">
            Assign Table {table.tableNumber}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex gap-2">
            <button
              onClick={() => { setIsWalkIn(false); setSelectedBookingId(null); }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border transition ${!isWalkIn ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
            >
              From Queue
            </button>
            <button
              onClick={() => { setIsWalkIn(true); setSelectedBookingId(null); }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border transition ${isWalkIn ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
            >
              Walk-in
            </button>
          </div>

          {!isWalkIn ? (
            <>
              <input
                type="text"
                placeholder="Search by token or guest name…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <div className="max-h-48 overflow-y-auto divide-y divide-gray-100 border border-gray-200 rounded-lg">
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
              <input
                type="text"
                placeholder="Guest name *"
                value={guestName}
                onChange={e => setGuestName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <input
                type="tel"
                placeholder="Mobile"
                value={mobile}
                onChange={e => setMobile(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <input
                type="number"
                placeholder="Party size"
                min={1}
                value={partySize}
                onChange={e => setPartySize(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleAssign}
            disabled={loading}
            className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 transition font-medium"
          >
            {loading ? 'Assigning…' : 'Confirm & Seat'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Table Card ───────────────────────────────────────────────────────────────

function TableCard({ table, waitingBookings, onRefresh }) {
  const [showAssign, setShowAssign] = useState(false);

  async function markStatus(status) {
    try {
      const updates = { status };
      if (status === 'available') {
        updates.currentBookingId = null;
        updates.seatedAt = null;
      }
      await updateDoc(doc(db, 'tables', table.id), updates);
      toast.success(`Table ${table.tableNumber} marked ${status}.`);
    } catch (err) {
      console.error(err);
      toast.error('Update failed.');
    }
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
          <span className={`text-xs font-semibold px-2 py-1 rounded-full border capitalize ${STATUS_STYLES[table.status] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
            {table.status}
          </span>
        </div>

        <div className="flex items-center gap-4 text-sm text-gray-600">
          <span>👥 {table.capacity}</span>
          {table.assignedServer && <span>🧑‍🍳 {table.assignedServer}</span>}
          {elapsed && <span className="text-amber-600">⏱ {elapsed}</span>}
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
          {table.status === 'occupied' && (
            <button
              onClick={() => markStatus('cleaning')}
              className="text-xs px-3 py-1.5 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition font-medium"
            >
              Mark Cleaning
            </button>
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
          waitingBookings={waitingBookings}
          onClose={() => setShowAssign(false)}
          onAssigned={() => setShowAssign(false)}
        />
      )}
    </>
  );
}

// ─── Floor Plan Tab ───────────────────────────────────────────────────────────

function FloorPlanTab({ waitingBookings }) {
  const { docs: tables = [], loading } = useCollection('tables', 'tableNumber');

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

  const sections = [...new Set(tables.map(t => t.section || 'Main'))].sort();

  return (
    <div className="space-y-6">
      {sections.map(section => {
        const sectionTables = tables.filter(t => (t.section || 'Main') === section);
        return (
          <div key={section}>
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">{section}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {sectionTables.map(table => (
                <TableCard
                  key={table.id}
                  table={table}
                  waitingBookings={waitingBookings}
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

  // Walk-in form state
  const [wiGuestName, setWiGuestName]         = useState('');
  const [wiMobile, setWiMobile]               = useState('');
  const [wiPartySize, setWiPartySize]         = useState(2);
  const [wiPref, setWiPref]                   = useState('Any');
  const [wiLoading, setWiLoading]             = useState(false);

  // Reservation form state
  const [resGuestName, setResGuestName]       = useState('');
  const [resMobile, setResMobile]             = useState('');
  const [resPartySize, setResPartySize]       = useState(2);
  const [resPref, setResPref]                 = useState('Any');
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
    if (!resGuestName.trim()) { toast.error('Guest name is required.'); return; }
    if (!resDateTime) { toast.error('Reservation date/time is required.'); return; }
    setResLoading(true);
    try {
      const dt = new Date(resDateTime);
      await addDoc(collection(db, 'bookings'), {
        guestName: resGuestName.trim(),
        mobile: resMobile.trim(),
        partySize: Number(resPartySize),
        tablePreference: resPref,
        type: 'reservation',
        status: 'waiting',
        date: format(dt, 'yyyy-MM-dd'),
        reservationTime: Timestamp.fromDate(dt),
        token: generateToken(),
        firedAt: serverTimestamp(),
        queueSequence: dt.getTime(),
      });
      toast.success('Reservation created.');
      setResGuestName(''); setResMobile(''); setResPartySize(2); setResPref('Any'); setResDateTime('');
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

  return (
    <div className="space-y-6">
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
                placeholder="+1 555 0100"
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

        {/* Reservation Form (collapsible) */}
        {showReservationForm && (
          <div className="border-t border-gray-100 bg-gray-50 rounded-b-xl">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-700 text-sm">New Reservation</h3>
            </div>
            <form onSubmit={addReservation} className="p-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Guest Name *</label>
                  <input
                    type="text"
                    value={resGuestName}
                    onChange={e => setResGuestName(e.target.value)}
                    placeholder="Jane Doe"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Mobile</label>
                  <input
                    type="tel"
                    value={resMobile}
                    onChange={e => setResMobile(e.target.value)}
                    placeholder="+1 555 0200"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Party Size</label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={resPartySize}
                    onChange={e => setResPartySize(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Table Preference</label>
                  <select
                    value={resPref}
                    onChange={e => setResPref(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                  >
                    {TABLE_PREFS.map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Date & Time *</label>
                  <input
                    type="datetime-local"
                    value={resDateTime}
                    onChange={e => setResDateTime(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                  />
                </div>
              </div>
              <div className="mt-4">
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

      {/* Assign modal triggered from queue */}
      {assignTarget && tables && (
        <AssignModal
          table={{ id: '__queue__', tableNumber: 'TBD', ...assignTarget }}
          waitingBookings={waitingBookings.filter(b => b.id !== assignTarget.id)}
          onClose={() => setAssignTarget(null)}
          onAssigned={() => setAssignTarget(null)}
        />
      )}
    </div>
  );
}

// ─── Host Page ────────────────────────────────────────────────────────────────

export default function Host() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('floor');

  const { docs: allBookings = [] } = useCollection('bookings', 'queueSequence', 'asc');

  const waitingBookings = useMemo(() => {
    if (!allBookings) return [];
    return allBookings.filter(b => b.date === TODAY && b.status === 'waiting');
  }, [allBookings]);

  const tabs = [
    { id: 'floor', label: 'Floor Plan' },
    { id: 'queue', label: 'Queue & Reservations' },
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
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'floor' ? (
          <FloorPlanTab waitingBookings={waitingBookings} />
        ) : (
          <QueueTab />
        )}
      </div>
    </div>
  );
}
