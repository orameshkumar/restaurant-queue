import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { doc, getDoc, collection, getDocs, query, where, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase/config'

// Normalise for comparison — lowercase, strip extra spaces
const norm = (s = '') => s.toLowerCase().replace(/\s+/g, ' ').trim()
// Normalise mobile — digits only
const normMobile = (s = '') => s.replace(/\D/g, '')

export default function GuestOrder() {
  const { tableId } = useParams()
  const [table, setTable]         = useState(null)
  const [booking, setBooking]     = useState(null)
  const [menuItems, setMenuItems] = useState([])
  const [loadingPage, setLoadingPage] = useState(true)
  const [pageError, setPageError] = useState(null)

  // Verification state
  const [verified, setVerified]   = useState(false)
  const [denied, setDenied]       = useState(false)
  const [countdown, setCountdown] = useState(5)
  const [verifyName, setVerifyName]     = useState('')
  const [verifyMobile, setVerifyMobile] = useState('')
  const [verifyError, setVerifyError]   = useState('')
  const [verifying, setVerifying]       = useState(false)

  // Order state
  const [cart, setCart]           = useState({})
  const [note, setNote]           = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const tableSnap = await getDoc(doc(db, 'tables', tableId))
        if (!tableSnap.exists()) { setPageError('Table not found.'); setLoadingPage(false); return }
        const tableData = { id: tableSnap.id, ...tableSnap.data() }
        setTable(tableData)

        if (tableData.currentBookingId) {
          const bSnap = await getDoc(doc(db, 'bookings', tableData.currentBookingId))
          if (bSnap.exists()) setBooking({ id: bSnap.id, ...bSnap.data() })
        }

        const mSnap = await getDocs(query(collection(db, 'menuItems'), where('available', '==', true)))
        const items = mSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        items.sort((a, b) => (a.category ?? '').localeCompare(b.category ?? ''))
        setMenuItems(items)
      } catch (err) {
        console.error(err)
        setPageError('Could not load menu. Please ask your server.')
      } finally {
        setLoadingPage(false)
      }
    }
    load()
  }, [tableId])

  // Countdown + close when denied
  useEffect(() => {
    if (!denied) return
    if (countdown <= 0) { window.close(); return }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [denied, countdown])

  function handleVerify(e) {
    e.preventDefault()
    setVerifyError('')
    setVerifying(true)

    if (!booking) {
      // No booking on this table — cannot verify
      setVerifyError('No active booking found for this table. Please ask your server.')
      setVerifying(false)
      return
    }

    const nameMatch   = norm(verifyName) === norm(booking.guestName)
    const bookingMobile = normMobile(booking.mobile ?? '')
    // If no mobile was recorded at booking time, only name is checked
    const mobileMatch = bookingMobile === '' || bookingMobile === normMobile(verifyMobile)

    if (nameMatch && mobileMatch) {
      setVerified(true)
    } else {
      setDenied(true)
    }
    setVerifying(false)
  }

  // Group menu by category
  const grouped = useMemo(() => {
    const map = {}
    menuItems.forEach(item => {
      if (!map[item.category]) map[item.category] = []
      map[item.category].push(item)
    })
    return map
  }, [menuItems])

  function addItem(id)    { setCart(c => ({ ...c, [id]: (c[id] ?? 0) + 1 })) }
  function removeItem(id) { setCart(c => { const n = { ...c }; if (n[id] > 1) n[id]--; else delete n[id]; return n }) }

  const cartItems = menuItems.filter(i => cart[i.id])
  const total     = cartItems.reduce((s, i) => s + i.price * cart[i.id], 0)

  async function handleSubmit() {
    if (cartItems.length === 0) return
    setSubmitting(true)
    try {
      const items = cartItems.map(i => ({
        menuItemId: i.id, name: i.name, price: i.price, qty: cart[i.id], category: i.category,
      }))
      await addDoc(collection(db, 'orders'), {
        tableId,
        tableNumber: table.tableNumber,
        bookingId:   booking?.id ?? null,
        guestName:   booking?.guestName ?? 'Guest',
        items,
        note:        note.trim(),
        status:      'draft',
        total,
        createdAt:   serverTimestamp(),
        source:      'guest',
      })
      setSubmitted(true)
    } catch (err) {
      console.error(err)
      alert('Could not place order. Please ask your server.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loadingPage) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-gray-500 text-sm animate-pulse">Loading…</div>
    </div>
  )

  if (pageError) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="text-center">
        <p className="text-4xl mb-3">⚠️</p>
        <p className="text-gray-700 font-medium">{pageError}</p>
      </div>
    </div>
  )

  // ── Access denied ────────────────────────────────────────────────────────────
  if (denied) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <p className="text-5xl mb-4">🚫</p>
        <h2 className="text-xl font-bold text-gray-800 mb-2">Access Denied</h2>
        <p className="text-gray-500 text-sm mb-4">
          The name or mobile number you entered does not match the booking for this table.
        </p>
        <p className="text-xs text-gray-400">
          This page will close in <span className="font-semibold text-red-500">{countdown}</span> second{countdown !== 1 ? 's' : ''}…
        </p>
        <button
          onClick={() => window.close()}
          className="mt-5 px-5 py-2 bg-red-500 text-white rounded-full text-sm font-medium hover:bg-red-600 transition"
        >
          Close Now
        </button>
      </div>
    </div>
  )

  // ── Verification form ────────────────────────────────────────────────────────
  if (!verified) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <p className="text-4xl mb-2">🍽️</p>
          <h1 className="text-xl font-bold text-gray-800">Welcome to Table {table?.tableNumber}</h1>
          <p className="text-sm text-gray-500 mt-1">Please verify your identity to continue.</p>
        </div>

        <form onSubmit={handleVerify} className="bg-white rounded-2xl shadow-sm p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
            <input
              type="text"
              required
              autoComplete="name"
              value={verifyName}
              onChange={e => setVerifyName(e.target.value)}
              placeholder="As given at reception"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mobile Number</label>
            <input
              type="tel"
              required
              autoComplete="tel"
              value={verifyMobile}
              onChange={e => setVerifyMobile(e.target.value)}
              placeholder="10-digit mobile number"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>

          {verifyError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {verifyError}
            </p>
          )}

          <button
            type="submit"
            disabled={verifying || !verifyName.trim() || !verifyMobile.trim()}
            className="w-full py-3 bg-amber-500 text-white rounded-xl font-semibold text-sm hover:bg-amber-600 disabled:opacity-50 transition"
          >
            {verifying ? 'Verifying…' : 'Continue to Menu →'}
          </button>
        </form>

        <p className="text-xs text-gray-400 text-center mt-4">
          Your details are only used to confirm your booking.
        </p>
      </div>
    </div>
  )

  // ── Order submitted ──────────────────────────────────────────────────────────
  if (submitted) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <p className="text-5xl mb-4">🎉</p>
        <h2 className="text-xl font-bold text-gray-800 mb-2">Order Placed!</h2>
        <p className="text-gray-500 text-sm">Your order has been sent to the host for confirmation. Sit back and relax!</p>
        <button
          onClick={() => { setSubmitted(false); setCart({}); setNote('') }}
          className="mt-6 px-6 py-2 bg-amber-500 text-white rounded-full text-sm font-medium hover:bg-amber-600 transition"
        >
          Order More
        </button>
      </div>
    </div>
  )

  // ── Menu ─────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gray-900 text-white px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <div>
            <p className="text-amber-400 font-bold text-base leading-tight">🍽️ RestQueue</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Welcome, <span className="text-white font-medium">{booking?.guestName ?? 'Guest'}</span>
              {' '}· Table <span className="text-amber-400 font-semibold">{table?.tableNumber}</span>
            </p>
          </div>
          {cartItems.length > 0 && (
            <div className="bg-amber-500 text-white text-xs font-bold px-3 py-1.5 rounded-full">
              🛒 {cartItems.reduce((s, i) => s + cart[i.id], 0)} items · ₹{total.toLocaleString('en-IN')}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 pb-40 space-y-6">
        {Object.entries(grouped).map(([category, items]) => (
          <div key={category}>
            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3 pb-1 border-b border-gray-200">{category}</h3>
            <div className="space-y-3">
              {items.map(item => (
                <div key={item.id} className="bg-white rounded-xl shadow-sm p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-800 text-sm leading-tight">{item.name}</p>
                    {item.description && <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{item.description}</p>}
                    <p className="text-amber-600 font-semibold text-sm mt-1">₹{item.price?.toLocaleString('en-IN')}</p>
                  </div>
                  {cart[item.id] ? (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => removeItem(item.id)}
                        className="w-8 h-8 rounded-full bg-gray-100 text-gray-700 font-bold text-lg leading-none flex items-center justify-center hover:bg-gray-200 transition">−</button>
                      <span className="w-5 text-center text-sm font-semibold">{cart[item.id]}</span>
                      <button onClick={() => addItem(item.id)}
                        className="w-8 h-8 rounded-full bg-amber-500 text-white font-bold text-lg leading-none flex items-center justify-center hover:bg-amber-600 transition">+</button>
                    </div>
                  ) : (
                    <button onClick={() => addItem(item.id)}
                      className="flex-shrink-0 w-8 h-8 rounded-full bg-amber-500 text-white font-bold text-lg leading-none flex items-center justify-center hover:bg-amber-600 transition">+</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {menuItems.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <p className="text-3xl mb-2">🍽️</p>
            <p className="text-sm">Menu not available. Please ask your server.</p>
          </div>
        )}
      </div>

      {cartItems.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg p-4 z-20">
          <div className="max-w-lg mx-auto space-y-3">
            <input
              type="text"
              placeholder="Any special requests? (optional)"
              value={note}
              onChange={e => setNote(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            <button onClick={handleSubmit} disabled={submitting}
              className="w-full py-3 bg-amber-500 text-white rounded-xl font-semibold text-sm hover:bg-amber-600 disabled:opacity-60 transition">
              {submitting ? 'Placing order…' : `Place Order · ₹${total.toLocaleString('en-IN')}`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
