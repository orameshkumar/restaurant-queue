import { useState, useMemo, useEffect } from 'react'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useCollection } from '../../hooks/useCollection'
import PageHeader from '../../components/PageHeader'

// Effective order status derived from its live orderItems
function effectiveStatus(itemStatuses) {
  if (itemStatuses.includes('ready') && !itemStatuses.includes('in-preparation')) return 'ready'
  if (itemStatuses.some(s => s === 'ready' || s === 'in-preparation')) return 'preparing'
  return 'queued'
}

const STATUS_META = {
  queued:   { label: 'Queued',         color: 'bg-blue-100 text-blue-700' },
  preparing:{ label: 'In Preparation', color: 'bg-amber-100 text-amber-700' },
  ready:    { label: 'Ready to Serve', color: 'bg-green-100 text-green-700' },
}

const ITEM_STATUS_META = {
  placed:         { label: 'Queued',      dot: 'bg-blue-400' },
  'in-kitchen':   { label: 'Queued',      dot: 'bg-blue-400' },
  'in-preparation':{ label: 'Preparing',  dot: 'bg-amber-400' },
  ready:          { label: 'Ready',       dot: 'bg-green-500' },
  served:         { label: 'Served',      dot: 'bg-gray-400' },
  cancelled:      { label: 'Cancelled',   dot: 'bg-red-400' },
}

function timeAgo(ts) {
  if (!ts) return ''
  const ms = Date.now() - (ts.toDate ? ts.toDate().getTime() : new Date(ts).getTime())
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'just now'
  if (min === 1) return '1 min ago'
  return `${min} min ago`
}

export default function Orders() {
  const { docs: tables = [] } = useCollection('tables', 'tableNumber')

  // Live orderItems that are still active (not served/cancelled)
  const [activeItems, setActiveItems] = useState([])
  const [loadingItems, setLoadingItems] = useState(true)

  useEffect(() => {
    const q = query(
      collection(db, 'orderItems'),
      where('status', 'in', ['placed', 'in-kitchen', 'in-preparation', 'ready'])
    )
    return onSnapshot(q, snap => {
      setActiveItems(snap.docs.map(d => ({ ...d.data(), id: d.id })))
      setLoadingItems(false)
    })
  }, [])

  // Orders collection for metadata (guestName, note, total, source, createdAt)
  const [ordersMap, setOrdersMap] = useState({})
  useEffect(() => {
    const q = query(
      collection(db, 'orders'),
      where('status', 'in', ['new', 'placed', 'preparing', 'draft'])
    )
    return onSnapshot(q, snap => {
      const m = {}
      snap.docs.forEach(d => { m[d.id] = { ...d.data(), id: d.id } })
      setOrdersMap(m)
    })
  }, [])

  const tableMap = useMemo(() => {
    const m = {}
    tables.forEach(t => { m[t.id] = t })
    return m
  }, [tables])

  // Group orderItems by orderId → derive one row per active order
  const orderRows = useMemo(() => {
    const byOrder = {}
    activeItems.forEach(item => {
      const oid = item.orderId
      if (!oid) return
      if (!byOrder[oid]) byOrder[oid] = { orderId: oid, items: [], tableId: item.tableId, bookingId: item.bookingId }
      byOrder[oid].items.push(item)
    })

    return Object.values(byOrder).map(row => {
      const meta = ordersMap[row.orderId] ?? {}
      const statuses = row.items.map(i => i.status)
      const effStatus = effectiveStatus(statuses)
      const firedAt = row.items.reduce((earliest, i) =>
        !earliest ? i.firedAt : (i.firedAt?.seconds ?? 0) < (earliest?.seconds ?? 0) ? i.firedAt : earliest
      , null)
      return {
        orderId:   row.orderId,
        tableId:   row.tableId ?? meta.tableId,
        source:    meta.source ?? row.items[0]?.source ?? 'staff',
        guestName: meta.guestName ?? row.items[0]?.guestName ?? null,
        note:      meta.note ?? null,
        total:     meta.total ?? null,
        createdAt: meta.createdAt ?? firedAt,
        items:     row.items,
        status:    effStatus,
      }
    }).sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0))
  }, [activeItems, ordersMap])

  // Filter state
  const [statusFilter, setStatusFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [search, setSearch]             = useState('')

  const filtered = useMemo(() => {
    return orderRows.filter(o => {
      if (statusFilter !== 'all' && o.status !== statusFilter) return false
      if (sourceFilter !== 'all' && o.source !== sourceFilter) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        const tableName = `table ${tableMap[o.tableId]?.tableNumber ?? ''}`.toLowerCase()
        const itemNames = o.items.map(i => i.name.toLowerCase()).join(' ')
        if (!tableName.includes(q) && !itemNames.includes(q)) return false
      }
      return true
    })
  }, [orderRows, statusFilter, sourceFilter, search, tableMap])

  const counts = useMemo(() => {
    const c = { all: orderRows.length, queued: 0, preparing: 0, ready: 0 }
    orderRows.forEach(o => { c[o.status] = (c[o.status] ?? 0) + 1 })
    return c
  }, [orderRows])

  const loading = loadingItems

  return (
    <div>
      <PageHeader title="Active Orders" subtitle="All live orders across tables" />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5 items-center">
        {/* Status pills */}
        <div className="flex gap-1.5 flex-wrap">
          {[['all', 'All'], ['queued', 'Queued'], ['preparing', 'In Preparation'], ['ready', 'Ready']].map(([val, lbl]) => (
            <button
              key={val}
              onClick={() => setStatusFilter(val)}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                statusFilter === val
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-400'
              }`}
            >
              {lbl} ({val === 'all' ? counts.all : (counts[val] ?? 0)})
            </button>
          ))}
        </div>

        {/* Source pills */}
        <div className="flex gap-1.5">
          {[['all', 'All Sources'], ['staff', 'Staff'], ['guest', 'Guest QR']].map(([val, lbl]) => (
            <button
              key={val}
              onClick={() => setSourceFilter(val)}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                sourceFilter === val
                  ? 'bg-purple-600 text-white border-purple-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-purple-400'
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="ml-auto">
          <input
            type="text"
            placeholder="Search table or item…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="text-center text-gray-400 py-20 text-sm">Loading orders…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-gray-400 py-20">
          <p className="text-4xl mb-2">🍽️</p>
          <p className="text-sm">No active orders{statusFilter !== 'all' || search ? ' matching filters' : ''}.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(order => {
            const table    = tableMap[order.tableId]
            const meta     = STATUS_META[order.status] ?? { label: order.status, color: 'bg-gray-100 text-gray-600' }
            const isGuest  = order.source === 'guest'
            return (
              <div key={order.orderId} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex gap-4">
                {/* Table badge */}
                <div className="flex-shrink-0 flex flex-col items-center justify-center w-14 h-14 rounded-xl bg-indigo-50 border border-indigo-100">
                  <span className="text-xs text-indigo-400 font-medium leading-none">Table</span>
                  <span className="text-xl font-bold text-indigo-700 leading-tight">
                    {table?.tableNumber ?? '?'}
                  </span>
                </div>

                {/* Main content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${meta.color}`}>
                      {meta.label}
                    </span>
                    {isGuest && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                        📱 Guest QR
                      </span>
                    )}
                    <span className="text-xs text-gray-400 ml-auto">{timeAgo(order.createdAt)}</span>
                  </div>

                  {/* Items with per-item status dot */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {order.items.map(item => {
                      const im = ITEM_STATUS_META[item.status] ?? { dot: 'bg-gray-300', label: item.status }
                      return (
                        <span key={item.id} className="flex items-center gap-1.5 text-sm text-gray-700">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${im.dot}`} title={im.label} />
                          <span className="font-medium">{item.name}</span>
                          <span className="text-gray-400">×{item.qty ?? 1}</span>
                        </span>
                      )
                    })}
                  </div>

                  {/* Footer */}
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
                    {order.guestName && <span>👤 {order.guestName}</span>}
                    {order.note && <span className="italic">"{order.note}"</span>}
                    {order.total != null && (
                      <span className="ml-auto font-medium text-gray-600">
                        ₹{order.total.toLocaleString('en-IN')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
