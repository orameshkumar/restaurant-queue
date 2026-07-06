import { useState, useMemo } from 'react'
import toast from 'react-hot-toast'
import { collection, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useCollection } from '../hooks/useCollection'

export default function TakeOrderModal({ table, onClose }) {
  const { docs: menuItems = [] } = useCollection('menuItems', 'name', 'asc', [['available', '==', true]])
  const [cart, setCart] = useState({})         // { itemId: { item, qty } }
  const [instructions, setInstructions] = useState({})
  const [note, setNote] = useState('')
  const [firing, setFiring] = useState(false)

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
      if (next[itemId]?.qty > 1) next[itemId] = { ...next[itemId], qty: next[itemId].qty - 1 }
      else delete next[itemId]
      return next
    })
  }

  const entries = Object.values(cart)
  const cartCount = entries.reduce((s, v) => s + v.qty, 0)
  const total = entries.reduce((s, { item, qty }) => s + (item.price ?? 0) * qty, 0)

  async function handleFire() {
    if (!entries.length) { toast.error('Add at least one item'); return }
    setFiring(true)
    try {
      const itemsPayload = entries.map(({ item, qty }) => ({
        menuItemId: item.id,
        name: item.name,
        category: item.category ?? 'Uncategorized',
        price: item.price ?? 0,
        qty,
        specialInstructions: instructions[item.id] ?? '',
      }))

      // 1. Create orders doc (Cashier consolidation)
      const orderRef = await addDoc(collection(db, 'orders'), {
        tableId: table.id,
        tableNumber: table.tableNumber,
        bookingId: table.currentBookingId ?? null,
        guestName: null,
        items: itemsPayload,
        note: note.trim(),
        total,
        status: 'new',
        source: 'staff',
        createdAt: serverTimestamp(),
      })

      // 2. Create individual orderItems docs (KDS pickup)
      await Promise.all(
        entries.map(({ item, qty }) =>
          addDoc(collection(db, 'orderItems'), {
            tableId: table.id,
            orderId: orderRef.id,
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
        )
      )

      // 3. Advance table status
      if (table.status === 'occupied' || table.status === 'available') {
        await updateDoc(doc(db, 'tables', table.id), { status: 'ordering' })
      }

      toast.success('Order fired to kitchen!')
      onClose()
    } catch (err) {
      console.error(err)
      toast.error('Failed to fire order.')
    } finally {
      setFiring(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Take Order — Table {table.tableNumber}</h2>
            {table.section && <p className="text-xs text-gray-400 mt-0.5">{table.section}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-6">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-2 pb-1 border-b border-gray-100">{category}</h3>
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

        {cartCount > 0 && (
          <div className="px-5 py-3 bg-gray-50 border-t border-b flex-shrink-0">
            <input type="text" placeholder="Order note (optional)"
              value={note} onChange={e => setNote(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-orange-400" />
          </div>
        )}

        <div className="px-5 py-4 border-t flex items-center justify-between flex-shrink-0">
          <div>
            <p className="text-sm text-gray-500">{cartCount} item{cartCount !== 1 ? 's' : ''}</p>
            {cartCount > 0 && <p className="text-base font-bold text-gray-800">₹{total.toLocaleString('en-IN')}</p>}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium">Cancel</button>
            <button onClick={handleFire} disabled={firing || !cartCount}
              className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-semibold">
              {firing ? 'Firing…' : '🔥 Fire to Kitchen'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
