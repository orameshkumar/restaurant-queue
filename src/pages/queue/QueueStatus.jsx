import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { doc, onSnapshot, collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useEwt } from '../../hooks/useEwt'

const TODAY = new Date().toISOString().split('T')[0]

export default function QueueStatus() {
  const { bookingId } = useParams()
  const { calcEwt } = useEwt()
  const [booking, setBooking]     = useState(null)
  const [position, setPosition]   = useState(null)
  const [loading, setLoading]     = useState(true)
  const [notFound, setNotFound]   = useState(false)
  const [seated, setSeated]       = useState(false)
  const [countdown, setCountdown] = useState(8)
  const [tableNumber, setTableNumber] = useState(null)
  const [closeFailed, setCloseFailed] = useState(false)

  // Live listener on this booking
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'bookings', bookingId), snap => {
      if (!snap.exists()) { setNotFound(true); setLoading(false); return }
      const data = { id: snap.id, ...snap.data() }
      setBooking(data)
      setLoading(false)

      if (data.status === 'seated') {
        // Fetch table number if available
        if (data.tableId) {
          import('firebase/firestore').then(({ getDoc, doc: fdoc }) => {
            getDoc(fdoc(db, 'tables', data.tableId)).then(t => {
              if (t.exists()) setTableNumber(t.data().tableNumber)
            })
          })
        }
        setSeated(true)
      }
    })
    return unsub
  }, [bookingId])

  // Compute live queue position — count waiting bookings ahead of this one
  useEffect(() => {
    if (!booking || seated) return

    async function computePosition() {
      const q = query(
        collection(db, 'bookings'),
        where('date', '==', TODAY),
        where('status', '==', 'waiting')
      )
      const snap = await getDocs(q)
      const ahead = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(b => b.id !== bookingId && (b.queueSequence ?? 0) < (booking.queueSequence ?? 0))
      setPosition(ahead.length + 1)
    }
    computePosition()

    // Recompute every 30s
    const t = setInterval(computePosition, 30000)
    return () => clearInterval(t)
  }, [booking, seated, bookingId])

  // Countdown + close when seated
  useEffect(() => {
    if (!seated) return
    if (countdown <= 0) {
      window.close()
      // If close was blocked (QR-scanned tabs), show manual close message after 300ms
      const t = setTimeout(() => setCloseFailed(true), 300)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [seated, countdown])

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-gray-400 text-sm animate-pulse">Loading your queue status…</div>
    </div>
  )

  if (notFound) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="text-center">
        <p className="text-4xl mb-3">⚠️</p>
        <p className="text-gray-600 font-medium">Booking not found.</p>
        <p className="text-sm text-gray-400 mt-1">Please ask staff for assistance.</p>
      </div>
    </div>
  )

  // ── Seated / table assigned ──────────────────────────────────────────────
  if (seated) return (
    <div className="min-h-screen bg-green-50 flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <p className="text-6xl mb-4">🎉</p>
        <h2 className="text-2xl font-bold text-green-800 mb-2">Your table is ready!</h2>
        {tableNumber && (
          <p className="text-lg font-semibold text-green-700 mb-2">
            Please proceed to <span className="text-2xl font-bold">Table {tableNumber}</span>
          </p>
        )}
        <p className="text-sm text-green-600 mb-6">
          Welcome, {booking?.guestName}! Enjoy your meal.
        </p>
        {closeFailed ? (
          <p className="text-sm font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl px-4 py-3">
            You can now close this tab 👆
          </p>
        ) : (
          <p className="text-xs text-gray-400">
            This page will close in <span className="font-semibold text-red-500">{countdown}</span> second{countdown !== 1 ? 's' : ''}…
          </p>
        )}
        <button
          onClick={() => { window.close(); setTimeout(() => setCloseFailed(true), 300) }}
          className="mt-4 px-5 py-2 bg-green-600 text-white rounded-full text-sm font-medium hover:bg-green-700 transition"
        >
          Close Tab
        </button>
      </div>
    </div>
  )

  // ── Cancelled / removed ─────────────────────────────────────────────────
  if (booking?.status === 'cancelled') return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <p className="text-4xl mb-3">❌</p>
        <h2 className="text-lg font-bold text-gray-700 mb-1">Booking Cancelled</h2>
        <p className="text-sm text-gray-400">Please speak to our staff if you'd like to re-join the queue.</p>
      </div>
    </div>
  )

  const ewt = position != null ? calcEwt(booking?.tablePreference ?? 'Any', position - 1) : null

  // ── Live waiting status ──────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 gap-6">
      {/* Token badge */}
      <div className="text-center">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Your Token</p>
        <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-amber-500 text-white shadow-lg">
          <span className="text-2xl font-black">{booking?.token ?? '—'}</span>
        </div>
      </div>

      {/* Guest info */}
      <div className="text-center">
        <p className="text-xl font-bold text-gray-800">{booking?.guestName}</p>
        <p className="text-sm text-gray-500">Party of {booking?.partySize}</p>
      </div>

      {/* Position card */}
      <div className="bg-white rounded-2xl shadow-sm w-full max-w-xs p-6 text-center space-y-4">
        {position === 1 ? (
          <>
            <p className="text-4xl">🔔</p>
            <p className="text-lg font-bold text-amber-600 animate-pulse">You're next!</p>
            <p className="text-sm text-gray-500">Please be ready — your table is being prepared.</p>
          </>
        ) : (
          <>
            <div>
              <p className="text-5xl font-black text-indigo-600">{position ?? '…'}</p>
              <p className="text-sm text-gray-500 mt-1">
                {position != null ? `${position - 1} ${position - 1 === 1 ? 'party' : 'parties'} ahead of you` : 'Calculating position…'}
              </p>
            </div>
            {ewt != null && (
              <div className="border-t pt-4">
                <p className="text-xs text-gray-400">Estimated wait</p>
                <p className="text-2xl font-bold text-gray-800">~{ewt} min</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Refresh note */}
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse inline-block" />
        Live — updates automatically
      </div>

      {/* Table preference reminder */}
      {booking?.tablePreference && booking.tablePreference !== 'Any' && (
        <p className="text-xs text-gray-400">Requested: {booking.tablePreference} seating</p>
      )}
    </div>
  )
}
