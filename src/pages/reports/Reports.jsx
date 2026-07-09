import { useState, useMemo } from 'react';
import { format, subDays, startOfMonth, parseISO, startOfDay, endOfDay } from 'date-fns';
import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { db } from '../../firebase/config';
import { useCollection } from '../../hooks/useCollection';
import PageHeader from '../../components/PageHeader';

const RANGE_OPTIONS = [
  { label: 'Today',       value: 'today' },
  { label: 'Yesterday',   value: 'yesterday' },
  { label: 'Last 7 Days', value: 'last7' },
  { label: 'This Month',  value: 'thisMonth' },
  { label: 'Custom',      value: 'custom' },
];

function getRangeForPreset(preset) {
  const today = new Date();
  switch (preset) {
    case 'today':     return { from: startOfDay(today),          to: endOfDay(today) };
    case 'yesterday': { const y = subDays(today, 1); return { from: startOfDay(y), to: endOfDay(y) }; }
    case 'last7':     return { from: startOfDay(subDays(today, 6)), to: endOfDay(today) };
    case 'thisMonth': return { from: startOfMonth(today),        to: endOfDay(today) };
    default:          return null;
  }
}

const fmt = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n ?? 0);

export default function Reports() {
  const [preset, setPreset]       = useState('today');
  const [customFrom, setCustomFrom] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [customTo, setCustomTo]   = useState(format(new Date(), 'yyyy-MM-dd'));

  const [loading, setLoading]     = useState(false);
  const [generated, setGenerated] = useState(false);

  const [bills, setBills]           = useState([]);
  const [orderItems, setOrderItems] = useState([]);

  const { docs: staff = [] } = useCollection('staff', 'name');

  const staffMap = useMemo(() => {
    const m = {};
    staff.forEach(s => { m[s.id] = s.name || s.id; });
    return m;
  }, [staff]);

  const dateRange = useMemo(() => {
    if (preset === 'custom') {
      return { from: startOfDay(parseISO(customFrom)), to: endOfDay(parseISO(customTo)) };
    }
    return getRangeForPreset(preset);
  }, [preset, customFrom, customTo]);

  async function handleGenerate() {
    if (!dateRange) return;
    setLoading(true);
    setGenerated(false);
    try {
      const fromTs = Timestamp.fromDate(dateRange.from);
      const toTs   = Timestamp.fromDate(dateRange.to);

      const [billsSnap, itemsSnap] = await Promise.all([
        getDocs(query(
          collection(db, 'bills'),
          where('closedAt', '>=', fromTs),
          where('closedAt', '<=', toTs)
        )),
        getDocs(query(
          collection(db, 'orderItems'),
          where('firedAt', '>=', fromTs),
          where('firedAt', '<=', toTs)
        )),
      ]);

      setBills(billsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setOrderItems(itemsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setGenerated(true);
    } catch (err) {
      console.error(err);
      toast.error('Failed to generate report. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Metrics ────────────────────────────────────────────────────────────────
  const totalRevenue  = useMemo(() => bills.reduce((s, b) => s + (b.total || 0), 0), [bills]);
  const totalCovers   = bills.length;
  const avgBillValue  = totalCovers > 0 ? totalRevenue / totalCovers : 0;
  const totalVoids    = useMemo(
    () => bills.filter(b => b.status === 'voided').reduce((s, b) => s + (b.total || 0), 0),
    [bills]
  );

  const revenueByMode = useMemo(() => {
    const map = {};
    bills.forEach(b => {
      const mode = b.paymentMode || 'Unknown';
      map[mode] = (map[mode] || 0) + (b.total || 0);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [bills]);
  const maxModeRevenue = revenueByMode[0]?.[1] || 1;

  const topItems = useMemo(() => {
    const map = {};
    orderItems.forEach(item => {
      const name = item.name || 'Unknown';
      map[name] = (map[name] || 0) + (item.qty || 1);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [orderItems]);

  const serverBreakdown = useMemo(() => {
    const map = {};
    bills.forEach(b => {
      const sid = b.serverId || 'Unassigned';
      if (!map[sid]) map[sid] = { count: 0, total: 0 };
      map[sid].count += 1;
      map[sid].total += b.total || 0;
    });
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total);
  }, [bills]);

  // ── CSV export ─────────────────────────────────────────────────────────────
  function handleDownloadCSV() {
    if (bills.length === 0) { toast.error('Generate a report first.'); return; }
    const headers = ['Bill ID', 'Table', 'Closed At', 'Server', 'Payment Mode', 'Subtotal', 'Tax', 'Discount', 'Tip', 'Total', 'Voided'];
    const rows = bills.map(b => {
      const closed = b.closedAt?.toDate ? b.closedAt.toDate() : b.closedAt ? new Date(b.closedAt) : null;
      return [
        b.id,
        b.tableNumber ?? '',
        closed ? format(closed, 'yyyy-MM-dd HH:mm:ss') : '',
        staffMap[b.serverId] || b.serverId || '',
        b.paymentMode || '',
        (b.subtotal || 0).toFixed(2),
        (b.taxAmount || 0).toFixed(2),
        (b.discount?.amount || 0).toFixed(2),
        (b.tip || 0).toFixed(2),
        (b.total || 0).toFixed(2),
        b.status === 'voided' ? 'Yes' : 'No',
      ];
    });
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `report_${format(dateRange.from, 'yyyyMMdd')}_${format(dateRange.to, 'yyyyMMdd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV downloaded.');
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 space-y-6">
      <PageHeader title="Reports & Analytics" />

      {/* Date range + Generate button */}
      <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          {RANGE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => { setPreset(opt.value); setGenerated(false); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                preset === opt.value ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {preset === 'custom' && (
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={customFrom}
              onChange={e => { setCustomFrom(e.target.value); setGenerated(false); }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <span className="text-gray-400 text-sm">to</span>
            <input type="date" value={customTo}
              onChange={e => { setCustomTo(e.target.value); setGenerated(false); }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
        )}

        <div className="flex gap-3 pt-1">
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="px-6 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {loading ? <><span className="animate-spin">⏳</span> Generating…</> : '📊 Generate Report'}
          </button>
          {generated && (
            <button
              onClick={handleDownloadCSV}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
            >
              ⬇ Download CSV
            </button>
          )}
        </div>
      </div>

      {/* Empty state */}
      {!generated && !loading && (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-3">
          <p className="text-5xl">📊</p>
          <p className="text-base font-medium">Select a date range and click Generate Report</p>
        </div>
      )}

      {/* Results */}
      {generated && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Total Revenue',   value: fmt(totalRevenue),       color: 'text-green-600',  bg: 'bg-green-50'  },
              { label: 'Total Bills',     value: totalCovers,              color: 'text-blue-600',   bg: 'bg-blue-50'   },
              { label: 'Avg Bill Value',  value: fmt(avgBillValue),        color: 'text-purple-600', bg: 'bg-purple-50' },
              { label: 'Total Voids',     value: fmt(totalVoids),          color: 'text-red-600',    bg: 'bg-red-50'    },
            ].map(card => (
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
                        <span className="text-gray-600 font-medium capitalize">{mode}</span>
                        <span className="text-gray-800 font-semibold">{fmt(amount)}</span>
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
              <h2 className="text-base font-semibold text-gray-700 mb-4">Top 10 Items Ordered</h2>
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
                        <td className="py-2 px-3 text-right font-semibold text-gray-800">{fmt(data.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Bills detail table */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="text-base font-semibold text-gray-700 mb-4">All Bills ({bills.length})</h2>
            {bills.length === 0 ? (
              <p className="text-sm text-gray-400">No bills for this range.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Table</th>
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Time</th>
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Server</th>
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Payment</th>
                      <th className="text-right py-2 px-3 text-gray-500 font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bills.map(b => {
                      const closed = b.closedAt?.toDate ? b.closedAt.toDate() : b.closedAt ? new Date(b.closedAt) : null;
                      return (
                        <tr key={b.id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="py-2 px-3 text-gray-700">Table {b.tableNumber ?? '—'}</td>
                          <td className="py-2 px-3 text-gray-500">{closed ? format(closed, 'HH:mm') : '—'}</td>
                          <td className="py-2 px-3 text-gray-600">{staffMap[b.serverId] || '—'}</td>
                          <td className="py-2 px-3 text-gray-600 capitalize">{b.paymentMode || '—'}</td>
                          <td className="py-2 px-3 text-right font-semibold text-gray-800">{fmt(b.total)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
