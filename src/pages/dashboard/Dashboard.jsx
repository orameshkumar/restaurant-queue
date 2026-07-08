import { useCollection } from '../../hooks/useCollection'
import PageHeader from '../../components/PageHeader'

const TODAY = new Date().toISOString().split('T')[0]

const FORMATTED_TODAY = new Date().toLocaleDateString('en-IN', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
})

function StatCard({ icon, value, label, color = 'text-amber-500' }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-5 flex items-center gap-4">
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
}

export default function Dashboard() {
  const { docs: tables   = [] } = useCollection('tables',     'tableNumber')
  const { docs: bookings = [] } = useCollection('bookings',   'queueSequence', 'asc', [['date', '==', TODAY]])
  const { docs: orderItems= []} = useCollection('orderItems', 'firedAt')
  const { docs: bills    = [] } = useCollection('bills',      'closedAt', 'desc', [['closedDate', '==', TODAY]])

  const tablesOccupied = tables.filter((t) => ['occupied','ordering','eating','bill_requested'].includes(t.status)).length
  const waitingQueue   = bookings.filter((b) => b.status === 'waiting')
  const activeItems    = orderItems.filter((i) => ['placed','in-kitchen','in-preparation'].includes(i.status))
  const revenueToday   = bills.reduce((sum, b) => sum + (b.total ?? 0), 0)

  const kitchenStatuses = ['placed', 'in-kitchen', 'in-preparation', 'ready']
  const kitchenCounts   = Object.fromEntries(
    kitchenStatuses.map((s) => [s, orderItems.filter((i) => i.status === s).length])
  )

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={FORMATTED_TODAY} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon="🪑" value={tablesOccupied}  label="Tables Occupied"  color="text-amber-500" />
        <StatCard icon="⏳" value={waitingQueue.length} label="Waiting Queue" color="text-blue-500" />
        <StatCard icon="🍳" value={activeItems.length}  label="Active Orders" color="text-orange-500" />
        <StatCard icon="💰" value={`₹${revenueToday.toLocaleString('en-IN')}`} label="Revenue Today" color="text-green-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Today's Queue */}
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Today's Queue</h2>
          {waitingQueue.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No guests waiting right now.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {waitingQueue.map((b, idx) => (
                <div key={b.id} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">
                      {b.token ?? '#'}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{b.guestName}</p>
                      <p className="text-xs text-gray-500">Party of {b.partySize}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">EWT</p>
                    <p className="text-sm font-semibold text-gray-700">~{(idx + 1) * 20} min</p>
                  </div>
                </div>
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
                <div key={status} className="flex items-center justify-between py-2">
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_STYLES[status]}`}>
                    {status.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </span>
                  <span className="text-sm font-semibold text-gray-800">{kitchenCounts[status]}</span>
                </div>
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
