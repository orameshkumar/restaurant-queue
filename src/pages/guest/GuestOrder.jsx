import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { doc, getDoc, collection, getDocs, query, where, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase/config'

export default function GuestOrder() {
  const { tableId, bookingId } = useParams()
  const [table, setTable]         = useState(null)
  const [booking, setBooking]     = useState(null)
  const [menuItems, setMenuItems] = useState([])
  const [loadingPage, setLoadingPage] = useState(true)
  const [pageError, setPageError] = useState(null)
  const [autoFire, setAutoFire]   = useState(false)

  // Order state
  const [cart, setCart]           = useState({})
  const [note, setNote]           = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [orderError, setOrderError] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const tableSnap = await getDoc(doc(db, 'tables', tableId))
        if (!tableSnap.exists()) { setPageError('Table not found.'); setLoadingPage(false); return }
        const tableData = { id: tableSnap.id, ...tableSnap.data() }
        setTable(tableData)

        const bSnap = await getDoc(doc(db, 'bookings', bookingId))
        if (bSnap.exists()) setBooking({ id: bSnap.id, ...bSnap.data() })

        const settingsSnap = await getDoc(doc(db, 'restaurantSettings', 'main'))
        if (settingsSnap.exists()) {
          setAutoFire(settingsSnap.data().autoFireGuestOrders === true)
        }

        const mSnap = await getDocs(query(collection(db, 'menuItems'), where('available', '==', true)))
        const items = mSnap.docs.map(d => ({ ...d.data(), id: d.id }))
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
  }, [tableId, bookingId])

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

  async function handleSubmit(fireDirectly = false) {
    if (cartItems.length === 0) return
    setSubmitting(true)
    setOrderError('')
    try {
      // Re-read table to confirm this booking is still the active one
      const freshTable = await getDoc(doc(db, 'tables', tableId))
      if (!freshTable.exists() || freshTable.data().currentBookingId !== bookingId) {
        setOrderError('This table has changed hands. Your QR code is no longer valid — please ask your server.')
        setSubmitting(false)
        return
      }

      const items = cartItems.map(i => ({
        menuItemId: i.id,
        name:       i.name,
        price:      i.price,
        qty:        cart[i.id],
        category:   i.category,
        station:    i.station ?? 'Main Kitchen',
      }))

      const status = fireDirectly ? 'placed' : 'draft'

      const orderRef = await addDoc(collection(db, 'orders'), {
        tableId,
        tableNumber: table.tableNumber,
        bookingId,
        guestName:   booking?.guestName ?? 'Guest',
        items,
        note:        note.trim(),
        status,
        total,
        createdAt:   serverTimestamp(),
        source:      'guest',
      })

      if (fireDirectly) {
        await Promise.all(
          cartItems.map(item =>
            addDoc(collection(db, 'orderItems'), {
              tableId,
              tableNumber:  table.tableNumber,
              bookingId,
              orderId:      orderRef.id,
              name:         item.name,
              menuItemId:   item.id,
              qty:          cart[item.id],
              price:        item.price,
              category:     item.category,
              station:      item.station ?? 'Main Kitchen',
              status:       'placed',
              source:       'guest',
              firedAt:      serverTimestamp(),
            })
          )
        )
      }

      setSubmitted(true)
      setShowConfirm(false)
    } catch (err) {
      console.error(err)
      setOrderError('Could not place order. Please ask your server.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loadingPage) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-gray-500 text-sm animate-pulse">Loading menu…</div>
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

  // ── Order submitted ──────────────────────────────────────────────────────────
  if (submitted) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <p className="text-5xl mb-4">🎉</p>
        <h2 className="text-xl font-bold text-gray-800 mb-2">
          {autoFire ? 'Order sent to kitchen!' : 'Order Placed!'}
        </h2>
        <p className="text-gray-500 text-sm">
          {autoFire
            ? 'Your order is on its way to the kitchen. Sit back and relax!'
            : 'Your order has been sent to the kitchen. Sit back and relax!'}
        </p>
        <button
          onClick={() => { setSubmitted(false); setCart({}); setNote(''); setShowConfirm(false) }}
          className="mt-6 px-6 py-2 bg-amber-500 text-white rounded-full text-sm font-medium hover:bg-amber-600 transition"
        >
          Order More
        </button>
      </div>
    </div>
  )

  // ── Confirm screen (autoFire only) ───────────────────────────────────────────
  if (showConfirm) return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-gray-900 text-white px-4 py-4 sticky top-0 z-10">
        <div className="max-w-lg mx-auto">
          <p className="text-amber-400 font-bold text-base leading-tight">Confirm Order</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Table <span className="text-amber-400 font-semibold">{table?.tableNumber}</span>
            {' '}· <span className="text-white font-medium">{booking?.guestName ?? 'Guest'}</span>
          </p>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 max-w-lg mx-auto w-full px-4 py-5 space-y-4">
        <div className="bg-white rounded-xl shadow-sm divide-y divide-gray-100">
          {cartItems.map(item => (
            <div key={item.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800">{item.name}</p>
                <p className="text-xs text-gray-400">qty {cart[item.id]}</p>
              </div>
              <p className="text-sm font-semibold text-amber-600 ml-4">
                ₹{(item.price * cart[item.id]).toLocaleString('en-IN')}
              </p>
            </div>
          ))}
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-b-xl">
            <p className="text-sm font-semibold text-gray-700">Total</p>
            <p className="text-sm font-bold text-gray-900">₹{total.toLocaleString('en-IN')}</p>
          </div>
        </div>

        {note.trim() && (
          <div className="bg-white rounded-xl shadow-sm px-4 py-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Special Request</p>
            <p className="text-sm text-gray-700">{note.trim()}</p>
          </div>
        )}

        {orderError && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{orderError}</p>
        )}
      </div>

      {/* Buttons */}
      <div className="sticky bottom-0 bg-white border-t border-gray-200 shadow-lg p-4 z-20">
        <div className="max-w-lg mx-auto space-y-3">
          <button
            onClick={() => { setShowConfirm(false); setOrderError('') }}
            disabled={submitting}
            className="w-full py-3 border border-gray-300 text-gray-700 rounded-xl font-semibold text-sm hover:bg-gray-50 disabled:opacity-60 transition"
          >
            Edit Order
          </button>
          <button
            onClick={() => handleSubmit(true)}
            disabled={submitting}
            className="w-full py-3 bg-amber-500 text-white rounded-xl font-semibold text-sm hover:bg-amber-600 disabled:opacity-60 transition flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Sending…
              </>
            ) : 'Send to Kitchen'}
          </button>
        </div>
      </div>
    </div>
  )

  // ── Menu ─────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gray-900 text-white px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <div>
            <p className="text-amber-400 font-bold text-base leading-tight">🍽️ Order Menu</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Welcome, <span className="text-white font-medium">{booking?.guestName ?? 'Guest'}</span>
              {' '}· Table <span className="text-amber-400 font-semibold">{table?.tableNumber}</span>
            </p>
          </div>
          {cartItems.length > 0 && (
            <div className="bg-amber-500 text-white text-xs font-bold px-3 py-1.5 rounded-full">
              🛒 {cartItems.reduce((s, i) => s + cart[i.id], 0)} · ₹{total.toLocaleString('en-IN')}
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
            {orderError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{orderError}</p>
            )}
            <button
              onClick={() => {
                if (autoFire) {
                  setShowConfirm(true)
                } else {
                  handleSubmit(false)
                }
              }}
              disabled={submitting}
              className="w-full py-3 bg-amber-500 text-white rounded-xl font-semibold text-sm hover:bg-amber-600 disabled:opacity-60 transition"
            >
              {submitting
                ? 'Placing order…'
                : autoFire
                  ? `Review Order → · ₹${total.toLocaleString('en-IN')}`
                  : `Place Order · ₹${total.toLocaleString('en-IN')}`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
