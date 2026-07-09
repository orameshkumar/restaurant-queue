import { useState, useMemo } from 'react';
import { format, subDays, startOfMonth, parseISO, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import PageHeader from '../../components/PageHeader';

const RANGE_OPTIONS = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'Last 7 Days', value: 'last7' },
  { label: 'This Month', value: 'thisMonth' },
  { label: 'Custom', value: 'custom' },
];

function getRangeForPreset(preset) {
  const today = new Date();
  switch (preset) {
    case 'today':
      return { from: startOfDay(today), to: endOfDay(today) };
    case 'yesterday': {
      const y = subDays(today, 1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }
    case 'last7':
      return { from: startOfDay(subDays(today, 6)), to: endOfDay(today) };
    case 'thisMonth':
      return { from: startOfMonth(today), to: endOfDay(today) };
    default:
      return null;
  }
}

export default function Reports() {
  const { user } = useAuth();

  const [preset, setPreset] = useState('today');
  const [customFrom, setCustomFrom] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [customTo, setCustomTo] = useState(format(new Date(), 'yyyy-MM-dd'));

  const { docs: bills = [] } = useCollection('bills', 'closedAt', 'desc');
  const { docs: orderItems = [] } = useCollection('orderItems', 'name');
  const { docs: staff = [] } = useCollection('staff', 'name');

  const dateRange = useMemo(() => {
    if (preset === 'custom') {
      return {
        from: startOfDay(parseISO(customFrom)),
        to: endOfDay(parseISO(customTo)),
      };
    }
    return getRangeForPreset(preset);
  }, [preset, customFrom, customTo]);

  const filteredBills = useMemo(() => {
    if (!dateRange) return [];
    return bills.filter((b) => {
      const closed = b.closedAt?.toDate ? b.closedAt.toDate() : b.closedAt ? new Date(b.closedAt) : null;
      if (!closed) return false;
      return isWithinInterval(closed, { start: dateRange.from, end: dateRange.to });
    });
  }, [bills, dateRange]);

  // Summary metrics
  const totalRevenue = useMemo(
    () => filteredBills.reduce((sum, b) => sum + (b.total || 0), 0),
    [filteredBills]
  );
  const totalCovers = filteredBills.length;
  const avgBillValue = totalCovers > 0 ? totalRevenue / totalCovers : 0;
  const totalVoids = useMemo(
    () => filteredBills.filter((b) => b.status === 'voided').reduce((sum, b) => sum + (b.total || 0), 0),
    [filteredBills]
  );

  // Revenue by payment mode
  const revenueByMode = useMemo(() => {
    const map = {};
    filteredBills.forEach((b) => {
      const mode = b.paymentMode || 'Unknown';
      map[mode] = (map[mode] || 0) + (b.total || 0);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [filteredBills]);
  const maxModeRevenue = revenueByMode.length > 0 ? revenueByMode[0][1] : 1;

  // Top items by date range
  const filteredOrderItems = useMemo(() => {
    if (!dateRange) return [];
    return orderItems.filter((item) => {
      // orderItems uses firedAt, not createdAt
      const ts = item.firedAt?.toDate ? item.firedAt.toDate() : item.firedAt ? new Date(item.firedAt) : null;
      if (!ts) return false;
      return isWithinInterval(ts, { start: dateRange.from, end: dateRange.to });
    });
  }, [orderItems, dateRange]);

  const topItems = useMemo(() => {
    const map = {};
    filteredOrderItems.forEach((item) => {
      const name = item.name || 'Unknown';
      map[name] = (map[name] || 0) + (item.qty || 1); // field is qty not quantity
    });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
  }, [filteredOrderItems]);

  // By-server breakdown
  const staffMap = useMemo(() => {
    const m = {};
    staff.forEach((s) => { m[s.id] = s.name || s.id; });
    return m;
  }, [staff]);

  const serverBreakdown = useMemo(() => {
    const map = {};
    filteredBills.forEach((b) => {
      const sid = b.serverId || 'Unassigned';
      if (!map[sid]) map[sid] = { count: 0, total: 0 };
      map[sid].count += 1;
      map[sid].total += b.total || 0;
    });
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total);
  }, [filteredBills]);

  // CSV export
  function handleDownloadCSV() {
    if (filteredBills.length === 0) {
      toast.error('No data to export for the selected range.');
      return;
    }
    const headers = ['Bill ID', 'Closed At', 'Server', 'Payment Mode', 'Total Amount', 'Voided'];
    const rows = filteredBills.map((b) => {
      const closed = b.closedAt?.toDate ? b.closedAt.toDate() : b.closedAt ? new Date(b.closedAt) : null;
      return [
        b.id,
        closed ? format(closed, 'yyyy-MM-dd HH:mm:ss') : '',
        staffMap[b.serverId] || b.serverId || '',
        b.paymentMode || '',
        (b.total || 0).toFixed(2),
        b.status === 'voided' ? 'Yes' : 'No',
      ];
    });
    const csvContent = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bills_${format(dateRange.from, 'yyyyMMdd')}_${format(dateRange.to, 'yyyyMMdd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV downloaded successfully.');
  }

  return (
    <div className="p-4 space-y-6">
      <PageHeader title="Reports & Analytics" />

      {/* Date Range Picker */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex flex-wrap gap-2 items-center">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setPreset(opt.value)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                preset === opt.value
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
          {preset === 'custom' && (
            <div className="flex flex-wrap items-center gap-2 w-full mt-1">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <span className="text-gray-400 text-sm">to</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          )}
          <button
            onClick={handleDownloadCSV}
            className="ml-auto px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
          >
            ⬇ Download CSV
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Revenue', value: `₹${totalRevenue.toFixed(2)}`, color: 'text-green-600', bg: 'bg-green-50' },
          { label: 'Total Covers', value: totalCovers, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Avg Bill Value', value: `₹${avgBillValue.toFixed(2)}`, color: 'text-purple-600', bg: 'bg-purple-50' },
          { label: 'Total Voids', value: `₹${totalVoids.toFixed(2)}`, color: 'text-red-600', bg: 'bg-red-50' },
        ].map((card) => (
          <div key={card.label} className={`rounded-xl shadow-sm p-5 ${card.bg}`}>
            <p className="text-sm text-gray-500 mb-1">{card.label}</p>
            <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue by Payment Mode */}
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="text-base font-semibold text-gray-700 mb-4">Revenue by Payment Mode</h2>
          {revenueByMode.length === 0 ? (
            <p className="text-sm text-gray-400">No data for this range.</p>
          ) : (
            <div className="space-y-3">
              {revenueByMode.map(([mode, amount]) => (
                <div key={mode}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600 font-medium">{mode}</span>
                    <span className="text-gray-800 font-semibold">₹{amount.toFixed(2)}</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-3">
                    <div
                      className="bg-indigo-500 h-3 rounded-full transition-all"
                      style={{ width: `${Math.round((amount / maxModeRevenue) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top Items */}
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="text-base font-semibold text-gray-700 mb-4">Top 10 Items</h2>
          {topItems.length === 0 ? (
            <p className="text-sm text-gray-400">No order items for this range.</p>
          ) : (
            <ol className="space-y-2">
              {topItems.map(([name, qty], idx) => (
                <li key={name} className="flex items-center gap-3 text-sm">
                  <span className="w-6 h-6 flex items-center justify-center rounded-full bg-indigo-100 text-indigo-700 font-bold text-xs shrink-0">
                    {idx + 1}
                  </span>
                  <span className="flex-1 text-gray-700 truncate">{name}</span>
                  <span className="font-semibold text-gray-800">{qty}×</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {/* By-Server Breakdown */}
      <div className="bg-white rounded-xl shadow-sm p-5">
        <h2 className="text-base font-semibold text-gray-700 mb-4">By-Server Breakdown</h2>
        {serverBreakdown.length === 0 ? (
          <p className="text-sm text-gray-400">No data for this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 px-3 text-gray-500 font-medium">Server</th>
                  <th className="text-right py-2 px-3 text-gray-500 font-medium">Bills</th>
                  <th className="text-right py-2 px-3 text-gray-500 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {serverBreakdown.map(([sid, data]) => (
                  <tr key={sid} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 px-3 text-gray-700">{staffMap[sid] || sid}</td>
                    <td className="py-2 px-3 text-right text-gray-600">{data.count}</td>
                    <td className="py-2 px-3 text-right font-semibold text-gray-800">₹{data.total.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
