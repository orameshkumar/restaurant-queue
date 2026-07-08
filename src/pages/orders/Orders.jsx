import { useState, useMemo } from 'react'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { useEffect } from 'react'
import { db } from '../../firebase/config'
import { useCollection } from '../../hooks/useCollection'
import PageHeader from '../../components/PageHeader'

const ACTIVE_STATUSES = ['new', 'preparing', 'ready']

const STATUS_META = {
  new:       { label: 'New',       color: 'bg-blue-100 text-blue-700' },
  preparing: { label: 'Preparing', color: 'bg-amber-100 text-amber-700' },
  ready:     { label: 'Ready',     color: 'bg-green-100 text-green-700' },
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

  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)

  // Single-field query by status 'in' list — no composite index needed
  useEffect(() => {
    const q = query(collection(db, 'orders'), where('status', 'in', ACTIVE_STATUSES))
    const unsub = onSnapshot(q, snap => {
      const docs = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0))
      setOrders(docs)
      setLoading(false)
    })
    return unsub
  }, [])

  const tableMap = useMemo(() => {
    const m = {}
    tables.forEach(t => { m[t.id] = t })
    return m
  }, [tables])

  // Filter state
  const [statusFilter, setStatusFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    return orders.filter(o => {
      if (statusFilter !== 'all' && o.status !== statusFilter) return false
      if (sourceFilter !== 'all' && (o.source ?? 'staff') !== sourceFilter) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        const tableName = `table ${tableMap[o.tableId]?.tableNumber ?? ''}`.toLowerCase()
        const itemNames = (o.items ?? []).map(i => i.name.toLowerCase()).join(' ')
        if (!tableName.includes(q) && !itemNames.includes(q)) return false
      }
      return true
    })
  }, [orders, statusFilter, sourceFilter, search, tableMap])

  const counts = useMemo(() => {
    const c = { all: orders.length }
    ACTIVE_STATUSES.forEach(s => { c[s] = orders.filter(o => o.status === s).length })
    return c
  }, [orders])

  return (
    <div>
      <PageHeader title="Active Orders" subtitle="All live orders across tables" />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5 items-center">
        {/* Status pills */}
        <div className="flex gap-1.5 flex-wrap">
          {[['all', 'All'], ...ACTIVE_STATUSES.map(s => [s, STATUS_META[s].label])].map(([val, lbl]) => (
            <button
              key={val}
              onClick={() => setStatusFilter(val)}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                statusFilter === val
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-400'
              }`}
            >
              {lbl} {val === 'all' ? `(${counts.all})` : `(${counts[val] ?? 0})`}
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
            const table = tableMap[order.tableId]
            const meta = STATUS_META[order.status] ?? { label: order.status, color: 'bg-gray-100 text-gray-600' }
            const isGuest = order.source === 'guest'
            return (
              <div key={order.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex gap-4">
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

                  {/* Items */}
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    {(order.items ?? []).map((item, i) => (
                      <span key={i} className="text-sm text-gray-700">
                        <span className="font-medium">{item.name}</span>
                        <span className="text-gray-400"> ×{item.qty ?? 1}</span>
                      </span>
                    ))}
                  </div>

                  {/* Footer */}
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
                    {order.guestName && <span>👤 {order.guestName}</span>}
                    {order.note && <span className="italic">"{order.note}"</span>}
                    <span className="ml-auto font-medium text-gray-600">
                      ₹{((order.total ?? 0)).toLocaleString('en-IN')}
                    </span>
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
