import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useCollection } from '../../hooks/useCollection'
import PageHeader from '../../components/PageHeader'

const TODAY = new Date().toISOString().split('T')[0]

const FORMATTED_TODAY = new Date().toLocaleDateString('en-IN', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
})

function StatCard({ icon, value, label, color = 'text-amber-500', onClick }) {
  return (
    <div
      className={`bg-white rounded-xl shadow-sm p-5 flex items-center gap-4 ${onClick ? 'cursor-pointer hover:shadow-md hover:ring-2 hover:ring-indigo-200 transition-all' : ''}`}
      onClick={onClick}
    >
      <div className={`text-3xl ${color}`}>{icon}</div>
      <div>
        <p className="text-2xl font-bold text-gray-900 leading-none">{value}</p>
        <p className="text-sm text-gray-500 mt-0.5">{label}</p>
      </div>
    </div>
  )
}

const STATUS_STYLES = {
  placed:          'bg-gray-100 text-gray-700',
  'in-kitchen':    'bg-blue-100 text-blue-700',
  'in-preparation':'bg-amber-100 text-amber-700',
  ready:           'bg-green-100 text-green-700',
  served:          'bg-purple-100 text-purple-700',
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { docs: tables    = [] } = useCollection('tables',     'tableNumber')
  const { docs: bookings  = [] } = useCollection('bookings', null, null, [['date', '==', TODAY]])
  const { docs: orderItems = [] } = useCollection('orderItems', 'firedAt')
  const { docs: bills     = [] } = useCollection('bills', null, null, [['closedDate', '==', TODAY]])

  const [takeawayRevenue,     setTakeawayRevenue]     = useState(0)
  const [takeawayActiveCount, setTakeawayActiveCount] = useState(0)
  const [refundsToday,        setRefundsToday]        = useState(0)

  useEffect(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const end   = new Date(); end.setHours(23, 59, 59, 999)
    const tsStart = Timestamp.fromDate(start)
    const tsEnd   = Timestamp.fromDate(end)

    getDocs(query(
      collection(db, 'orders'),
      where('createdAt', '>=', tsStart),
      where('createdAt', '<=', tsEnd)
    )).then(snap => {
      const orders = snap.docs.map(d => d.data())
      const revenue = orders
        .filter(o => ['handed-over', 'completed', 'delivered'].includes(o.status))
        .reduce((s, o) => s + (o.total ?? 0), 0)
      const active = orders
        .filter(o => !['handed-over', 'completed', 'delivered', 'cancelled'].includes(o.status))
        .length
      setTakeawayRevenue(revenue)
      setTakeawayActiveCount(active)
    }).catch(() => {})

    getDocs(query(
      collection(db, 'refunds'),
      where('createdAt', '>=', tsStart),
      where('createdAt', '<=', tsEnd)
    )).then(snap => {
      const total = snap.docs.reduce((s, d) => s + (d.data().amount ?? 0), 0)
      setRefundsToday(total)
    }).catch(() => {})
  }, [])

  const tablesOccupied = tables.filter((t) => ['occupied','ordering','eating','bill_requested'].includes(t.status)).length
  const waitingQueue   = bookings.filter((b) => b.status === 'waiting').sort((a, b) => (a.queueSequence ?? 0) - (b.queueSequence ?? 0))
  const activeItems    = orderItems.filter((i) => ['placed','in-kitchen','in-preparation'].includes(i.status))

  const dineInRevenue  = bills.reduce((s, b) => s + (b.total ?? 0), 0)
  const revenueToday   = dineInRevenue + takeawayRevenue - refundsToday
  const totalActive    = activeItems.length + takeawayActiveCount

  const kitchenStatuses = ['placed', 'in-kitchen', 'in-preparation', 'ready', 'served']
  const kitchenCounts   = Object.fromEntries(
    kitchenStatuses.map((s) => [s, orderItems.filter((i) => i.status === s).length])
  )

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={FORMATTED_TODAY} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon="🪑" value={tablesOccupied}  label="Tables Occupied"  color="text-amber-500" onClick={() => navigate('/host', { state: { filterStatus: 'occupied' } })} />
        <StatCard icon="⏳" value={waitingQueue.length} label="Waiting Queue" color="text-blue-500" onClick={() => navigate('/host', { state: { activeTab: 'queue' } })} />
        <StatCard icon="🍳" value={totalActive} label="Active Orders" color="text-orange-500" onClick={() => navigate('/orders')} />
        <StatCard icon="💰" value={`₹${revenueToday.toLocaleString('en-IN')}`} label={`Revenue Today${refundsToday > 0 ? ` (−₹${refundsToday.toLocaleString('en-IN')} refunds)` : ''}`} color="text-green-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Today's Queue */}
        <div className="bg-white rounded-xl shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Today's Queue</h2>
            <button
              onClick={() => navigate('/host', { state: { activeTab: 'queue' } })}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
            >
              View all →
            </button>
          </div>
          {waitingQueue.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No guests waiting right now.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {waitingQueue.map((b, idx) => (
                <button
                  key={b.id}
                  onClick={() => navigate('/host', { state: { activeTab: 'queue' } })}
                  className="w-full flex items-center justify-between py-3 hover:bg-gray-50 -mx-1 px-1 rounded-lg transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">
                      {b.token ?? '#'}
                    </span>
                    <div className="text-left">
                      <p className="text-sm font-medium text-gray-900">{b.guestName}</p>
                      <p className="text-xs text-gray-500">Party of {b.partySize}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">EWT</p>
                    <p className="text-sm font-semibold text-gray-700">~{(idx + 1) * 20} min</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Kitchen Summary */}
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Kitchen Summary</h2>
          {orderItems.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No active items in the kitchen.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {kitchenStatuses.map((status) => (
                <button
                  key={status}
                  onClick={() => navigate('/kds', { state: { filterStatus: status } })}
                  className="w-full flex items-center justify-between py-2 px-1 -mx-1 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer group"
                >
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_STYLES[status]}`}>
                    {status.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-800">{kitchenCounts[status]}</span>
                    <span className="text-gray-300 group-hover:text-gray-500 text-xs">→</span>
                  </div>
                </button>
              ))}
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between text-sm">
            <span className="text-gray-500">Total items</span>
            <span className="font-semibold text-gray-900">{orderItems.length}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
