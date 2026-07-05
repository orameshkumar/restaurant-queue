import PageHeader from '../../components/PageHeader';
import { useCollection } from '../../hooks/useCollection';

const TODAY = new Date().toISOString().split('T')[0];

const FORMATTED_TODAY = new Date().toLocaleDateString('en-US', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------
function StatCard({ icon, value, label, color = 'text-amber-500' }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-5 flex items-center gap-4">
      <div className={`text-3xl ${color}`}>{icon}</div>
      <div>
        <p className="text-2xl font-bold text-gray-900 leading-none">{value}</p>
        <p className="text-sm text-gray-500 mt-0.5">{label}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kitchen status badge
// ---------------------------------------------------------------------------
const STATUS_STYLES = {
  placed: 'bg-gray-100 text-gray-700',
  'in-kitchen': 'bg-blue-100 text-blue-700',
  'in-preparation': 'bg-amber-100 text-amber-700',
  ready: 'bg-green-100 text-green-700',
};

function KitchenRow({ status, count }) {
  const label = status.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <div className="flex items-center justify-between py-2">
      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700'}`}>
        {label}
      </span>
      <span className="text-sm font-semibold text-gray-800">{count}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function Dashboard() {
  const { data: tables = [] } = useCollection('tables', 'number', 'asc');
  const { data: bookings = [] } = useCollection('bookings', 'createdAt', 'asc', [
    { field: 'date', op: '==', value: TODAY },
  ]);
  const { data: orderItems = [] } = useCollection('orderItems', 'createdAt', 'asc', [
    { field: 'status', op: 'not-in', value: ['served', 'voided'] },
  ]);
  const { data: bills = [] } = useCollection('bills', 'closedAt', 'desc', [
    { field: 'closedDate', op: '==', value: TODAY },
  ]);

  // --- Derived stats ---
  const tablesOccupied = tables.filter((t) => t.status === 'occupied').length;
  const waitingQueue = bookings.filter((b) => b.status === 'waiting');
  const activeOrders = orderItems.filter(
    (i) => i.status === 'in-kitchen' || i.status === 'in-preparation'
  ).length;
  const revenueToday = bills.reduce((sum, b) => sum + (b.total ?? 0), 0);

  // Kitchen summary — count items by status
  const kitchenStatuses = ['placed', 'in-kitchen', 'in-preparation', 'ready'];
  const kitchenCounts = kitchenStatuses.reduce((acc, s) => {
    acc[s] = orderItems.filter((i) => i.status === s).length;
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <PageHeader
          title="Dashboard"
          subtitle={FORMATTED_TODAY}
        />

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon="🪑"
            value={tablesOccupied}
            label="Tables Occupied"
            color="text-amber-500"
          />
          <StatCard
            icon="⏳"
            value={waitingQueue.length}
            label="Waiting Queue"
            color="text-blue-500"
          />
          <StatCard
            icon="🍳"
            value={activeOrders}
            label="Active Orders"
            color="text-orange-500"
          />
          <StatCard
            icon="💰"
            value={`$${revenueToday.toFixed(2)}`}
            label="Revenue Today"
            color="text-green-500"
          />
        </div>

        {/* Two-column section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Today's Queue */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Today's Queue</h2>

            {waitingQueue.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No guests waiting right now.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {waitingQueue.map((booking) => (
                  <div key={booking.id} className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-100 text-amber-700 text-xs font-bold">
                        {booking.token ?? '—'}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{booking.guestName ?? 'Guest'}</p>
                        <p className="text-xs text-gray-500">Party of {booking.partySize ?? 1}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500">EWT</p>
                      <p className="text-sm font-semibold text-gray-700">
                        {booking.ewt != null ? `${booking.ewt} min` : '—'}
                      </p>
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
                  <KitchenRow key={status} status={status} count={kitchenCounts[status]} />
                ))}
              </div>
            )}

            <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
              <span className="text-sm text-gray-500">Total items</span>
              <span className="text-sm font-semibold text-gray-900">{orderItems.length}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
