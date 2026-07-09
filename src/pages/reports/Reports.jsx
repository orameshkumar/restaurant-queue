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
    case 'today':     return { from: startOfDay(today),             to: endOfDay(today) };
    case 'yesterday': { const y = subDays(today, 1); return { from: startOfDay(y), to: endOfDay(y) }; }
    case 'last7':     return { from: startOfDay(subDays(today, 6)), to: endOfDay(today) };
    case 'thisMonth': return { from: startOfMonth(today),           to: endOfDay(today) };
    default:          return null;
  }
}

const fmt = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n ?? 0);

const STATUS_META = {
  open:            { label: 'Open',    bg: 'bg-blue-100',   text: 'text-blue-700'  },
  bill_requested:  { label: 'Pending', bg: 'bg-amber-100',  text: 'text-amber-700' },
  paid:            { label: 'Paid',    bg: 'bg-green-100',  text: 'text-green-700' },
  voided:          { label: 'Voided',  bg: 'bg-red-100',    text: 'text-red-700'   },
};

function StatusBadge({ status }) {
  const meta = STATUS_META[status] ?? { label: status ?? 'Unknown', bg: 'bg-gray-100', text: 'text-gray-600' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${meta.bg} ${meta.text}`}>
      {meta.label}
    </span>
  );
}

// ── Shared date-range picker ───────────────────────────────────────────────
function DateRangePicker({ preset, setPreset, customFrom, setCustomFrom, customTo, setCustomTo, onReset }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        {RANGE_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => { setPreset(opt.value); onReset(); }}
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
            onChange={e => { setCustomFrom(e.target.value); onReset(); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <span className="text-gray-400 text-sm">to</span>
          <input type="date" value={customTo}
            onChange={e => { setCustomTo(e.target.value); onReset(); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 1 — Analytics
// ══════════════════════════════════════════════════════════════════════════════
function AnalyticsTab({ staffMap }) {
  const [preset, setPreset]         = useState('today');
  const [customFrom, setCustomFrom] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [customTo, setCustomTo]     = useState(format(new Date(), 'yyyy-MM-dd'));
  const [loading, setLoading]       = useState(false);
  const [generated, setGenerated]   = useState(false);
  const [bills, setBills]           = useState([]);
  const [orderItems, setOrderItems] = useState([]);

  const dateRange = useMemo(() => {
    if (preset === 'custom') return { from: startOfDay(parseISO(customFrom)), to: endOfDay(parseISO(customTo)) };
    return getRangeForPreset(preset);
  }, [preset, customFrom, customTo]);

  async function handleGenerate() {
    if (!dateRange) return;
    setLoading(true); setGenerated(false);
    try {
      const fromTs = Timestamp.fromDate(dateRange.from);
      const toTs   = Timestamp.fromDate(dateRange.to);
      const [billsSnap, itemsSnap] = await Promise.all([
        getDocs(query(collection(db, 'bills'), where('closedAt', '>=', fromTs), where('closedAt', '<=', toTs))),
        getDocs(query(collection(db, 'orderItems'), where('firedAt', '>=', fromTs), where('firedAt', '<=', toTs))),
      ]);
      setBills(billsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setOrderItems(itemsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setGenerated(true);
    } catch (err) {
      console.error(err);
      toast.error('Failed to generate report.');
    } finally {
      setLoading(false);
    }
  }

  const totalRevenue  = useMemo(() => bills.reduce((s, b) => s + (b.total || 0), 0), [bills]);
  const avgBillValue  = bills.length > 0 ? totalRevenue / bills.length : 0;
  const totalVoids    = useMemo(() => bills.filter(b => b.status === 'voided').reduce((s, b) => s + (b.total || 0), 0), [bills]);

  const revenueByMode = useMemo(() => {
    const map = {};
    bills.forEach(b => { const m = b.paymentMode || 'Unknown'; map[m] = (map[m] || 0) + (b.total || 0); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [bills]);
  const maxModeRevenue = revenueByMode[0]?.[1] || 1;

  const topItems = useMemo(() => {
    const map = {};
    orderItems.forEach(i => { const n = i.name || 'Unknown'; map[n] = (map[n] || 0) + (i.qty || 1); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [orderItems]);

  const serverBreakdown = useMemo(() => {
    const map = {};
    bills.forEach(b => {
      const sid = b.serverId || 'Unassigned';
      if (!map[sid]) map[sid] = { count: 0, total: 0 };
      map[sid].count++; map[sid].total += b.total || 0;
    });
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total);
  }, [bills]);

  function handleDownloadCSV() {
    if (!bills.length) { toast.error('Generate a report first.'); return; }
    const headers = ['Bill ID','Table','Closed At','Server','Payment Mode','Subtotal','Tax','Discount','Tip','Total','Voided'];
    const rows = bills.map(b => {
      const closed = b.closedAt?.toDate ? b.closedAt.toDate() : b.closedAt ? new Date(b.closedAt) : null;
      return [b.id, b.tableNumber ?? '', closed ? format(closed, 'yyyy-MM-dd HH:mm:ss') : '',
        staffMap[b.serverId] || b.serverId || '', b.paymentMode || '',
        (b.subtotal||0).toFixed(2),(b.taxAmount||0).toFixed(2),(b.discount?.amount||0).toFixed(2),
        (b.tip||0).toFixed(2),(b.total||0).toFixed(2), b.status==='voided'?'Yes':'No'];
    });
    const csv = [headers,...rows].map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `report_${format(dateRange.from,'yyyyMMdd')}_${format(dateRange.to,'yyyyMMdd')}.csv`;
    a.click();
    toast.success('CSV downloaded.');
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
        <DateRangePicker preset={preset} setPreset={setPreset} customFrom={customFrom}
          setCustomFrom={setCustomFrom} customTo={customTo} setCustomTo={setCustomTo}
          onReset={() => setGenerated(false)} />
        <div className="flex gap-3 pt-1">
          <button onClick={handleGenerate} disabled={loading}
            className="px-6 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center gap-2">
            {loading ? <><span className="animate-spin">⏳</span> Generating…</> : '📊 Generate Report'}
          </button>
          {generated && (
            <button onClick={handleDownloadCSV}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors">
              ⬇ Download CSV
            </button>
          )}
        </div>
      </div>

      {!generated && !loading && (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-3">
          <p className="text-5xl">📊</p>
          <p className="text-base font-medium">Select a date range and click Generate Report</p>
        </div>
      )}

      {generated && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Total Revenue',  value: fmt(totalRevenue),  color: 'text-green-600',  bg: 'bg-green-50'  },
              { label: 'Total Bills',    value: bills.length,        color: 'text-blue-600',   bg: 'bg-blue-50'   },
              { label: 'Avg Bill Value', value: fmt(avgBillValue),   color: 'text-purple-600', bg: 'bg-purple-50' },
              { label: 'Total Voids',    value: fmt(totalVoids),     color: 'text-red-600',    bg: 'bg-red-50'    },
            ].map(card => (
              <div key={card.label} className={`rounded-xl shadow-sm p-5 ${card.bg}`}>
                <p className="text-sm text-gray-500 mb-1">{card.label}</p>
                <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl shadow-sm p-5">
              <h2 className="text-base font-semibold text-gray-700 mb-4">Revenue by Payment Mode</h2>
              {revenueByMode.length === 0 ? <p className="text-sm text-gray-400">No data.</p> : (
                <div className="space-y-3">
                  {revenueByMode.map(([mode, amount]) => (
                    <div key={mode}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-600 font-medium capitalize">{mode}</span>
                        <span className="text-gray-800 font-semibold">{fmt(amount)}</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-3">
                        <div className="bg-indigo-500 h-3 rounded-full"
                          style={{ width: `${Math.round((amount/maxModeRevenue)*100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm p-5">
              <h2 className="text-base font-semibold text-gray-700 mb-4">Top 10 Items Ordered</h2>
              {topItems.length === 0 ? <p className="text-sm text-gray-400">No order items.</p> : (
                <ol className="space-y-2">
                  {topItems.map(([name, qty], idx) => (
                    <li key={name} className="flex items-center gap-3 text-sm">
                      <span className="w-6 h-6 flex items-center justify-center rounded-full bg-indigo-100 text-indigo-700 font-bold text-xs shrink-0">{idx+1}</span>
                      <span className="flex-1 text-gray-700 truncate">{name}</span>
                      <span className="font-semibold text-gray-800">{qty}×</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="text-base font-semibold text-gray-700 mb-4">By-Server Breakdown</h2>
            {serverBreakdown.length === 0 ? <p className="text-sm text-gray-400">No data.</p> : (
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

          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="text-base font-semibold text-gray-700 mb-4">All Bills ({bills.length})</h2>
            {bills.length === 0 ? <p className="text-sm text-gray-400">No bills for this range.</p> : (
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

// ══════════════════════════════════════════════════════════════════════════════
// TAB 2 — Bills Register
// ══════════════════════════════════════════════════════════════════════════════
function BillsRegisterTab({ staffMap }) {
  const [preset, setPreset]         = useState('today');
  const [customFrom, setCustomFrom] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [customTo, setCustomTo]     = useState(format(new Date(), 'yyyy-MM-dd'));
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading]       = useState(false);
  const [fetched, setFetched]       = useState(false);
  const [allBills, setAllBills]     = useState([]);

  const dateRange = useMemo(() => {
    if (preset === 'custom') return { from: startOfDay(parseISO(customFrom)), to: endOfDay(parseISO(customTo)) };
    return getRangeForPreset(preset);
  }, [preset, customFrom, customTo]);

  async function handleFetch() {
    if (!dateRange) return;
    setLoading(true); setFetched(false);
    try {
      const fromTs = Timestamp.fromDate(dateRange.from);
      const toTs   = Timestamp.fromDate(dateRange.to);
      // Query by createdAt so we catch open/pending bills that have no closedAt yet
      const snap = await getDocs(query(
        collection(db, 'bills'),
        where('createdAt', '>=', fromTs),
        where('createdAt', '<=', toTs)
      ));
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const ta = a.createdAt?.seconds ?? 0;
          const tb = b.createdAt?.seconds ?? 0;
          return tb - ta;
        });
      setAllBills(rows);
      setFetched(true);
    } catch (err) {
      console.error(err);
      toast.error('Failed to fetch bills.');
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return allBills;
    if (statusFilter === 'unpaid') return allBills.filter(b => b.status !== 'paid' && b.status !== 'voided');
    return allBills.filter(b => b.status === statusFilter);
  }, [allBills, statusFilter]);

  const counts = useMemo(() => {
    const map = { all: allBills.length, unpaid: 0 };
    allBills.forEach(b => {
      map[b.status] = (map[b.status] || 0) + 1;
      if (b.status !== 'paid' && b.status !== 'voided') map.unpaid++;
    });
    return map;
  }, [allBills]);

  const unpaidTotal = useMemo(
    () => allBills.filter(b => b.status !== 'paid' && b.status !== 'voided').reduce((s, b) => s + (b.total || 0), 0),
    [allBills]
  );

  const STATUS_FILTERS = [
    { value: 'all',             label: 'All' },
    { value: 'unpaid',          label: 'Unpaid' },
    { value: 'open',            label: 'Open' },
    { value: 'bill_requested',  label: 'Pending' },
    { value: 'paid',            label: 'Paid' },
    { value: 'voided',          label: 'Voided' },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
        <DateRangePicker preset={preset} setPreset={setPreset} customFrom={customFrom}
          setCustomFrom={setCustomFrom} customTo={customTo} setCustomTo={setCustomTo}
          onReset={() => setFetched(false)} />
        <div className="pt-1">
          <button onClick={handleFetch} disabled={loading}
            className="px-6 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center gap-2">
            {loading ? <><span className="animate-spin">⏳</span> Loading…</> : '🧾 Load Bills'}
          </button>
        </div>
      </div>

      {!fetched && !loading && (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-3">
          <p className="text-5xl">🧾</p>
          <p className="text-base font-medium">Select a date range and click Load Bills</p>
        </div>
      )}

      {fetched && (
        <>
          {/* Unpaid alert */}
          {counts.unpaid > 0 && (
            <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
              <span className="text-2xl">⚠️</span>
              <div>
                <p className="text-sm font-semibold text-amber-800">
                  {counts.unpaid} unpaid bill{counts.unpaid > 1 ? 's' : ''} — {fmt(unpaidTotal)} outstanding
                </p>
                <p className="text-xs text-amber-600 mt-0.5">These bills have been generated but not yet settled.</p>
              </div>
            </div>
          )}

          {/* Status filter chips */}
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map(f => {
              const count = counts[f.value] ?? 0;
              const active = statusFilter === f.value;
              return (
                <button key={f.value} onClick={() => setStatusFilter(f.value)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors flex items-center gap-1.5 ${
                    active ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}>
                  {f.label}
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${active ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-500'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Bills table */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="text-base font-semibold text-gray-700 mb-4">
              {filtered.length} bill{filtered.length !== 1 ? 's' : ''}
              {statusFilter !== 'all' ? ` · ${STATUS_FILTERS.find(f => f.value === statusFilter)?.label}` : ''}
            </h2>
            {filtered.length === 0 ? (
              <p className="text-sm text-gray-400">No bills match this filter.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Status</th>
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Table</th>
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Opened</th>
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Closed</th>
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Server</th>
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Payment</th>
                      <th className="text-right py-2 px-3 text-gray-500 font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(b => {
                      const opened = b.createdAt?.toDate ? b.createdAt.toDate() : b.createdAt ? new Date(b.createdAt) : null;
                      const closed = b.closedAt?.toDate  ? b.closedAt.toDate()  : b.closedAt  ? new Date(b.closedAt)  : null;
                      const isPending = b.status !== 'paid' && b.status !== 'voided';
                      return (
                        <tr key={b.id} className={`border-b border-gray-50 hover:bg-gray-50 ${isPending ? 'bg-amber-50/40' : ''}`}>
                          <td className="py-2 px-3"><StatusBadge status={b.status} /></td>
                          <td className="py-2 px-3 text-gray-700 font-medium">Table {b.tableNumber ?? '—'}</td>
                          <td className="py-2 px-3 text-gray-500">{opened ? format(opened, 'dd MMM HH:mm') : '—'}</td>
                          <td className="py-2 px-3 text-gray-500">{closed  ? format(closed,  'dd MMM HH:mm') : '—'}</td>
                          <td className="py-2 px-3 text-gray-600">{staffMap[b.serverId] || '—'}</td>
                          <td className="py-2 px-3 text-gray-600 capitalize">{b.paymentMode || '—'}</td>
                          <td className="py-2 px-3 text-right font-semibold text-gray-800">{fmt(b.total)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {filtered.length > 1 && (
                    <tfoot>
                      <tr className="border-t-2 border-gray-200">
                        <td colSpan={6} className="py-2 px-3 text-sm font-semibold text-gray-600">Total</td>
                        <td className="py-2 px-3 text-right font-bold text-gray-800">
                          {fmt(filtered.reduce((s, b) => s + (b.total || 0), 0))}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Root
// ══════════════════════════════════════════════════════════════════════════════
const TABS = [
  { id: 'analytics', label: '📊 Analytics' },
  { id: 'bills',     label: '🧾 Bills Register' },
];

export default function Reports() {
  const [activeTab, setActiveTab] = useState('analytics');
  const { docs: staff = [] } = useCollection('staff', 'name');
  const staffMap = useMemo(() => {
    const m = {};
    staff.forEach(s => { m[s.id] = s.name || s.id; });
    return m;
  }, [staff]);

  return (
    <div className="p-4 space-y-4">
      <PageHeader title="Reports & Analytics" />

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'analytics' && <AnalyticsTab staffMap={staffMap} />}
      {activeTab === 'bills'     && <BillsRegisterTab staffMap={staffMap} />}
    </div>
  );
}
