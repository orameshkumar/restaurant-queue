import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { doc, onSnapshot, collection, query, where, getDocs, getDoc } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useEwt } from '../../hooks/useEwt'

const TODAY = new Date().toISOString().split('T')[0]
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

export default function QueueStatus() {
  const { bookingId } = useParams()
  const { calcEwt } = useEwt()
  const [booking, setBooking]         = useState(null)
  const [position, setPosition]       = useState(null)
  const [personsAhead, setPersonsAhead] = useState(0)
  const [loading, setLoading]         = useState(true)
  const [notFound, setNotFound]       = useState(false)
  const [seated, setSeated]           = useState(false)
  const [tableNumber, setTableNumber] = useState(null)
  const [tableId, setTableId]         = useState(null)
  const [autoFire, setAutoFire]       = useState(false)

  // Load autoFireGuestOrders config once
  useEffect(() => {
    getDoc(doc(db, 'restaurantSettings', 'main')).then(snap => {
      if (snap.exists()) setAutoFire(snap.data().autoFireGuestOrders === true)
    })
  }, [])

  // Live listener on this booking
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'bookings', bookingId), snap => {
      if (!snap.exists()) { setNotFound(true); setLoading(false); return }
      const data = { ...snap.data(), id: snap.id }
      setBooking(data)
      setLoading(false)

      if (data.status === 'seated' && data.tableId) {
        setTableId(data.tableId)
        getDoc(doc(db, 'tables', data.tableId)).then(t => {
          if (t.exists()) setTableNumber(t.data().tableNumber)
        })
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
        .map(d => ({ ...d.data(), id: d.id }))
        .filter(b => b.id !== bookingId && (b.queueSequence ?? 0) < (booking.queueSequence ?? 0))
      setPosition(ahead.length + 1)
      setPersonsAhead(ahead.reduce((s, b) => s + (b.partySize || 2), 0))
    }
    computePosition()

    // Recompute every 30s
    const t = setInterval(computePosition, 30000)
    return () => clearInterval(t)
  }, [booking, seated, bookingId])


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
  if (seated) {
    const orderUrl = tableId ? `${window.location.origin}${BASE}/guest/${tableId}/${bookingId}` : null
    return (
      <div className="min-h-screen bg-green-50 flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-5">

          {/* Header */}
          <div className="text-center">
            <p className="text-6xl mb-3">🎉</p>
            <h2 className="text-2xl font-bold text-green-800">Your table is ready!</h2>
            {tableNumber && (
              <p className="text-lg font-semibold text-green-700 mt-1">
                Please proceed to <span className="text-3xl font-black text-green-800">Table {tableNumber}</span>
              </p>
            )}
            <p className="text-sm text-green-600 mt-1">Welcome, {booking?.guestName}!</p>
          </div>

          {/* Token */}
          <div className="flex justify-center">
            <div className="inline-flex flex-col items-center bg-white rounded-2xl shadow-sm px-8 py-4 border border-green-200">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Your Token</p>
              <span className="text-3xl font-black text-amber-500">{booking?.token ?? '—'}</span>
            </div>
          </div>

          {/* Order food button */}
          {orderUrl && (
            <div className="bg-white rounded-2xl shadow-sm border p-5 space-y-3">
              {autoFire ? (
                <>
                  <a
                    href={orderUrl}
                    className="flex items-center justify-center gap-2 w-full py-3.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl text-base transition"
                  >
                    🍽️ Order Food Now
                  </a>
                  <div className="flex gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                    <span className="text-amber-500 text-sm flex-shrink-0">⚡</span>
                    <p className="text-xs text-amber-800 leading-relaxed">
                      <strong>Orders go straight to the kitchen.</strong> Please review your items carefully on the next screen before confirming — orders cannot be cancelled once sent.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <a
                    href={orderUrl}
                    className="flex items-center justify-center gap-2 w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-base transition"
                  >
                    🍽️ Browse Menu & Order
                  </a>
                  <div className="flex gap-2 bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-2.5">
                    <span className="text-indigo-400 text-sm flex-shrink-0">ℹ️</span>
                    <p className="text-xs text-indigo-800 leading-relaxed">
                      Your order will be sent to your server for review before going to the kitchen. Feel free to add notes or ask for changes.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

        </div>
      </div>
    )
  }

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

  const ewt = position != null ? calcEwt(booking?.tablePreference ?? 'Any', personsAhead) : null

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
