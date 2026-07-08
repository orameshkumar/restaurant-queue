import { useState, useMemo, useEffect } from 'react'
import toast from 'react-hot-toast'
import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, onSnapshot, query, where,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { useCollection } from '../hooks/useCollection'

export default function TakeOrderModal({ table, onClose }) {
  // Load ALL menu items — filter in JS to avoid composite-index requirement
  const { docs: allMenuItems = [] } = useCollection('menuItems', 'name', 'asc')
  const menuItems = useMemo(() => allMenuItems.filter(i => i.available !== false), [allMenuItems])

  // Live orders for this table (draft + new + preparing) — guest or staff
  const [existingOrders, setExistingOrders] = useState([])
  useEffect(() => {
    if (!table?.id) return
    const q = query(
      collection(db, 'orders'),
      where('tableId', '==', table.id),
      where('status', 'in', ['draft', 'new', 'preparing']),
    )
    return onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      docs.sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0))
      setExistingOrders(docs)
    })
  }, [table?.id])

  const [cart, setCart] = useState({})       // new additions: { itemId: { item, qty } }
  const [instructions, setInstructions] = useState({})
  const [note, setNote] = useState('')
  const [firing, setFiring] = useState(false)
  const [removingItem, setRemovingItem] = useState(null) // { orderId, itemIdx }

  const grouped = useMemo(() => {
    const map = {}
    menuItems.forEach(item => {
      const cat = item.category ?? 'Uncategorized'
      if (!map[cat]) map[cat] = []
      map[cat].push(item)
    })
    return map
  }, [menuItems])

  function addToCart(item) {
    setCart(prev => ({ ...prev, [item.id]: { item, qty: (prev[item.id]?.qty ?? 0) + 1 } }))
  }
  function removeFromCart(itemId) {
    setCart(prev => {
      const next = { ...prev }
      if ((next[itemId]?.qty ?? 0) > 1) next[itemId] = { ...next[itemId], qty: next[itemId].qty - 1 }
      else delete next[itemId]
      return next
    })
  }

  // Remove a single item from an existing order doc
  async function removeExistingItem(order, itemIdx) {
    setRemovingItem(`${order.id}-${itemIdx}`)
    try {
      const newItems = order.items.filter((_, i) => i !== itemIdx)
      if (newItems.length === 0) {
        // No items left — delete the whole order
        await deleteDoc(doc(db, 'orders', order.id))
        toast.success('Order removed.')
      } else {
        const newTotal = newItems.reduce((s, it) => s + (it.price ?? 0) * (it.qty ?? 1), 0)
        await updateDoc(doc(db, 'orders', order.id), { items: newItems, total: newTotal })
        toast.success('Item removed.')
      }
    } catch (err) {
      console.error(err)
      toast.error('Could not remove item.')
    } finally {
      setRemovingItem(null)
    }
  }

  // Change qty of an existing order item (+1 / -1)
  async function adjustExistingItem(order, itemIdx, delta) {
    const item = order.items[itemIdx]
    const newQty = (item.qty ?? 1) + delta
    if (newQty <= 0) { removeExistingItem(order, itemIdx); return }
    const newItems = order.items.map((it, i) => i === itemIdx ? { ...it, qty: newQty } : it)
    const newTotal = newItems.reduce((s, it) => s + (it.price ?? 0) * (it.qty ?? 1), 0)
    try {
      await updateDoc(doc(db, 'orders', order.id), { items: newItems, total: newTotal })
    } catch (err) {
      console.error(err)
      toast.error('Update failed.')
    }
  }

  const newEntries = Object.values(cart)
  const newCartCount = newEntries.reduce((s, v) => s + v.qty, 0)
  const newTotal = newEntries.reduce((s, { item, qty }) => s + (item.price ?? 0) * qty, 0)

  async function handleFire() {
    if (!newEntries.length) { toast.error('Add at least one new item to fire.'); return }
    setFiring(true)
    try {
      const itemsPayload = newEntries.map(({ item, qty }) => ({
        menuItemId: item.id,
        name: item.name,
        category: item.category ?? 'Uncategorized',
        price: item.price ?? 0,
        qty,
        specialInstructions: instructions[item.id] ?? '',
      }))

      // orders doc → Cashier consolidation
      const orderRef = await addDoc(collection(db, 'orders'), {
        tableId:    table.id,
        tableNumber: table.tableNumber,
        bookingId:  table.currentBookingId ?? null,
        guestName:  null,
        items:      itemsPayload,
        note:       note.trim(),
        total:      newTotal,
        status:     'new',
        source:     'staff',
        createdAt:  serverTimestamp(),
      })

      // orderItems docs → KDS
      await Promise.all(
        newEntries.map(({ item, qty }) =>
          addDoc(collection(db, 'orderItems'), {
            tableId:              table.id,
            orderId:              orderRef.id,
            menuItemId:           item.id,
            name:                 item.name,
            category:             item.category ?? 'Uncategorized',
            price:                item.price ?? 0,
            qty,
            modifiers:            [],
            specialInstructions:  instructions[item.id] ?? '',
            status:               'placed',
            firedAt:              serverTimestamp(),
            servedAt:             null,
            claimedByChefId:      null,
          })
        )
      )

      if (table.status === 'occupied') {
        await updateDoc(doc(db, 'tables', table.id), { status: 'ordering' })
      }

      toast.success('New items fired to kitchen!')
      setCart({})
      setNote('')
    } catch (err) {
      console.error(err)
      toast.error('Failed to fire order.')
    } finally {
      setFiring(false)
    }
  }

  // Confirm a draft order (guest-placed, not yet sent to kitchen)
  async function confirmDraft(order) {
    try {
      await updateDoc(doc(db, 'orders', order.id), { status: 'new', confirmedAt: serverTimestamp() })
      toast.success('Order confirmed — sent to kitchen.')
    } catch (err) {
      console.error(err)
      toast.error('Could not confirm order.')
    }
  }

  const SOURCE_LABEL = { guest: '📱 Guest', staff: '👨‍💼 Staff' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Table {table.tableNumber} — Orders</h2>
            {table.section && <p className="text-xs text-gray-400 mt-0.5">{table.section}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-6">

          {/* ── Existing orders ── */}
          {existingOrders.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-gray-700 mb-3">Current Orders</h3>
              <div className="space-y-3">
                {existingOrders.map((order, oi) => (
                  <div key={order.id} className={`rounded-xl border p-3 ${order.status === 'draft' ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-gray-500">
                        Round {oi + 1} · {SOURCE_LABEL[order.source] ?? '👤'}
                        {order.status === 'draft' && <span className="ml-2 text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded text-xs">Pending Confirm</span>}
                        {order.status === 'new' && <span className="ml-2 text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded text-xs">In Kitchen</span>}
                        {order.status === 'preparing' && <span className="ml-2 text-orange-600 bg-orange-100 px-1.5 py-0.5 rounded text-xs">Preparing</span>}
                      </span>
                      {order.status === 'draft' && (
                        <button onClick={() => confirmDraft(order)}
                          className="text-xs px-2 py-1 bg-green-600 text-white rounded-lg hover:bg-green-700 transition">
                          ✓ Confirm
                        </button>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      {(order.items ?? []).map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between text-sm">
                          <span className="text-gray-800 flex-1 truncate">{item.name}</span>
                          <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                            <button onClick={() => adjustExistingItem(order, idx, -1)}
                              className="w-6 h-6 rounded-full bg-white border border-gray-300 text-gray-600 font-bold text-base flex items-center justify-center hover:bg-gray-100">−</button>
                            <span className="w-5 text-center font-semibold text-gray-700">{item.qty}</span>
                            <button onClick={() => adjustExistingItem(order, idx, +1)}
                              className="w-6 h-6 rounded-full bg-white border border-gray-300 text-gray-600 font-bold text-base flex items-center justify-center hover:bg-gray-100">+</button>
                            <span className="text-gray-400 text-xs w-16 text-right">₹{((item.price ?? 0) * item.qty).toLocaleString('en-IN')}</span>
                            <button onClick={() => removeExistingItem(order, idx)}
                              disabled={removingItem === `${order.id}-${idx}`}
                              className="w-6 h-6 rounded-full text-red-400 hover:bg-red-50 flex items-center justify-center text-sm">✕</button>
                          </div>
                        </div>
                      ))}
                    </div>
                    {order.note && <p className="text-xs text-gray-400 mt-2 italic">"{order.note}"</p>}
                    <p className="text-xs font-semibold text-gray-600 mt-2 text-right">₹{(order.total ?? 0).toLocaleString('en-IN')}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Add new items ── */}
          <div>
            <h3 className="text-sm font-bold text-gray-700 mb-3">
              {existingOrders.length > 0 ? 'Add More Items' : 'Menu'}
            </h3>
            {Object.entries(grouped).map(([category, items]) => (
              <div key={category} className="mb-5">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2 pb-1 border-b border-gray-100">{category}</h4>
                <div className="space-y-2">
                  {items.map(item => {
                    const inCart = cart[item.id]
                    return (
                      <div key={item.id} className="border border-gray-200 rounded-xl p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium text-gray-900 text-sm">{item.name}</p>
                            {item.description && <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{item.description}</p>}
                            <p className="text-amber-600 font-semibold text-sm mt-0.5">₹{(item.price ?? 0).toLocaleString('en-IN')}</p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {inCart ? (
                              <>
                                <button onClick={() => removeFromCart(item.id)}
                                  className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 font-bold text-lg flex items-center justify-center">−</button>
                                <span className="w-5 text-center font-semibold text-sm">{inCart.qty}</span>
                                <button onClick={() => addToCart(item)}
                                  className="w-8 h-8 rounded-full bg-orange-500 hover:bg-orange-600 text-white font-bold text-lg flex items-center justify-center">+</button>
                              </>
                            ) : (
                              <button onClick={() => addToCart(item)}
                                className="px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium">+ Add</button>
                            )}
                          </div>
                        </div>
                        {inCart && (
                          <input type="text" placeholder="Special instructions (optional)"
                            value={instructions[item.id] ?? ''}
                            onChange={e => setInstructions(p => ({ ...p, [item.id]: e.target.value }))}
                            className="mt-2 w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-400" />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
            {menuItems.length === 0 && (
              <p className="text-center text-gray-400 py-10">No menu items available.</p>
            )}
          </div>
        </div>

        {/* Note + footer */}
        {newCartCount > 0 && (
          <div className="px-5 py-3 bg-gray-50 border-t flex-shrink-0">
            <input type="text" placeholder="Order note (optional)"
              value={note} onChange={e => setNote(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-400" />
          </div>
        )}

        <div className="px-5 py-4 border-t flex items-center justify-between flex-shrink-0">
          <div>
            {newCartCount > 0 && (
              <>
                <p className="text-xs text-gray-500">{newCartCount} new item{newCartCount !== 1 ? 's' : ''} to fire</p>
                <p className="text-base font-bold text-gray-800">₹{newTotal.toLocaleString('en-IN')}</p>
              </>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium">
              Close
            </button>
            <button onClick={handleFire} disabled={firing || !newCartCount}
              className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold">
              {firing ? 'Firing…' : '🔥 Fire to Kitchen'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
