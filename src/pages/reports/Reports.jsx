import { useState, useMemo } from 'react';
import { format, subDays, startOfMonth, parseISO, startOfDay, endOfDay } from 'date-fns';
import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { db } from '../../firebase/config';
import { useCollection } from '../../hooks/useCollection';
import { useAuth } from '../../context/AuthContext';
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
          <input type="date" id="report-date-from" name="dateFrom" value={customFrom}
            onChange={e => { setCustomFrom(e.target.value); onReset(); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <span className="text-gray-400 text-sm">to</span>
          <input type="date" id="report-date-to" name="dateTo" value={customTo}
            onChange={e => { setCustomTo(e.target.value); onReset(); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
      )}
    </div>
  );
}

const TYPE_FILTER_OPTIONS = [
  { value: 'all',      label: 'All',      icon: '📋' },
  { value: 'dine-in',  label: 'Dine-in',  icon: '🍽️' },
  { value: 'takeaway', label: 'Takeaway', icon: '🥡' },
  { value: 'delivery', label: 'Delivery', icon: '🛵' },
];

function TypeFilterPills({ value, onChange, counts }) {
  return (
    <div className="flex flex-wrap gap-2">
      {TYPE_FILTER_OPTIONS.map(opt => {
        const count = counts?.[opt.value] ?? 0;
        const active = value === opt.value;
        return (
          <button key={opt.value} onClick={() => onChange(opt.value)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              active ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            <span>{opt.icon}</span>{opt.label}
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${active ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-500'}`}>
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 1 — Analytics
// ══════════════════════════════════════════════════════════════════════════════
function AnalyticsTab({ staffMap, currentUserId }) {
  const [preset, setPreset]         = useState('today');
  const [customFrom, setCustomFrom] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [customTo, setCustomTo]     = useState(format(new Date(), 'yyyy-MM-dd'));
  const [typeFilter, setTypeFilter] = useState('all');
  const [loading, setLoading]       = useState(false);
  const [generated, setGenerated]   = useState(false);
  const [bills, setBills]           = useState([]);       // dine-in bills
  const [taOrders, setTaOrders]     = useState([]);       // takeaway + delivery orders
  const [orderItems, setOrderItems] = useState([]);
  const [refunds, setRefunds]       = useState([]);

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
      const [billsSnap, itemsSnap, ordersSnap, refundsSnap] = await Promise.all([
        getDocs(query(collection(db, 'bills'),      where('closedAt',  '>=', fromTs), where('closedAt',  '<=', toTs))),
        getDocs(query(collection(db, 'orderItems'), where('firedAt',   '>=', fromTs), where('firedAt',   '<=', toTs))),
        getDocs(query(collection(db, 'orders'),     where('createdAt', '>=', fromTs), where('createdAt', '<=', toTs))),
        getDocs(query(collection(db, 'refunds'),    where('createdAt', '>=', fromTs), where('createdAt', '<=', toTs))),
      ]);
      setBills(billsSnap.docs.map(d => ({ ...d.data(), id: d.id })));
      setOrderItems(itemsSnap.docs.map(d => ({ ...d.data(), id: d.id })));
      setTaOrders(ordersSnap.docs.map(d => ({ ...d.data(), id: d.id })).filter(o => o.type === 'takeaway' || o.type === 'delivery'));
      setRefunds(refundsSnap.docs.map(d => ({ ...d.data(), id: d.id })));
      setGenerated(true);
    } catch (err) {
      console.error(err);
      toast.error('Failed to generate report.');
    } finally {
      setLoading(false);
    }
  }

  // Apply type filter
  const filteredBills = useMemo(() => {
    if (typeFilter === 'all' || typeFilter === 'dine-in') return bills;
    return [];
  }, [bills, typeFilter]);

  const filteredOrders = useMemo(() => {
    if (typeFilter === 'all') return taOrders;
    if (typeFilter === 'takeaway') return taOrders.filter(o => o.type === 'takeaway');
    if (typeFilter === 'delivery')  return taOrders.filter(o => o.type === 'delivery');
    return []; // dine-in
  }, [taOrders, typeFilter]);

  const typeCounts = useMemo(() => ({
    all:      bills.length + taOrders.length,
    'dine-in': bills.length,
    takeaway: taOrders.filter(o => o.type === 'takeaway').length,
    delivery: taOrders.filter(o => o.type === 'delivery').length,
  }), [bills, taOrders]);

  const dineInRevenue    = useMemo(() => filteredBills.reduce((s, b) => s + (b.total || 0), 0), [filteredBills]);
  const taRevenue        = useMemo(() => filteredOrders.filter(o => o.status === 'completed').reduce((s, o) => s + (o.total || 0), 0), [filteredOrders]);
  const totalRevenue     = dineInRevenue + taRevenue;
  const totalCount       = filteredBills.length + filteredOrders.length;
  const avgBillValue     = totalCount > 0 ? totalRevenue / totalCount : 0;
  const totalVoids       = useMemo(() => filteredBills.filter(b => b.status === 'voided').reduce((s, b) => s + (b.total || 0), 0), [filteredBills]);
  const totalRefunds     = useMemo(() => refunds.reduce((s, r) => s + (r.amount || 0), 0), [refunds]);

  const revenueByMode = useMemo(() => {
    const map = {};
    filteredBills.forEach(b => { const m = b.paymentMode || 'Unknown'; map[m] = (map[m] || 0) + (b.total || 0); });
    filteredOrders.filter(o => o.status === 'completed').forEach(o => { const m = o.paymentMethod || 'Unknown'; map[m] = (map[m] || 0) + (o.total || 0); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [filteredBills, filteredOrders]);
  const maxModeRevenue = revenueByMode[0]?.[1] || 1;

  const topItems = useMemo(() => {
    const map = {};
    orderItems.forEach(i => {
      if (typeFilter === 'dine-in'  && (i.source === 'takeaway' || i.source === 'delivery')) return;
      if (typeFilter === 'takeaway' && i.source !== 'takeaway') return;
      if (typeFilter === 'delivery' && i.source !== 'delivery') return;
      const n = i.name || 'Unknown';
      map[n] = (map[n] || 0) + (i.qty || 1);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [orderItems, typeFilter]);

  const serverBreakdown = useMemo(() => {
    const map = {};
    filteredBills.forEach(b => {
      const sid = b.serverId || 'Unassigned';
      if (!map[sid]) map[sid] = { count: 0, total: 0 };
      map[sid].count++; map[sid].total += b.total || 0;
    });
    filteredOrders.filter(o => o.status === 'completed').forEach(o => {
      const sid = o.createdBy || 'Unassigned';
      if (!map[sid]) map[sid] = { count: 0, total: 0 };
      map[sid].count++; map[sid].total += o.total || 0;
    });
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total);
  }, [filteredBills, filteredOrders]);

  function handleDownloadCSV() {
    if (!generated) { toast.error('Generate a report first.'); return; }
    const headers = ['Type','Ref','Time','Customer / Table','Server','Payment','Total'];
    const rows = [
      ...filteredBills.map(b => {
        const t = b.closedAt?.toDate ? b.closedAt.toDate() : null;
        return ['Dine-in', b.id, t ? format(t, 'yyyy-MM-dd HH:mm') : '', `Table ${b.tableNumber ?? ''}`,
          b.serverName || staffMap[b.serverId] || '', b.paymentMode || '', (b.total||0).toFixed(2)];
      }),
      ...filteredOrders.map(o => {
        const t = o.createdAt?.toDate ? o.createdAt.toDate() : null;
        return [o.type, o.id, t ? format(t, 'yyyy-MM-dd HH:mm') : '',
          `${o.customerName || ''} ${o.pickupToken ? '(' + o.pickupToken + ')' : ''}`.trim(),
          staffMap[o.createdBy] || '', o.paymentMethod || '', (o.total||0).toFixed(2)];
      }),
    ];
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
          {/* Bill type filter */}
          <TypeFilterPills value={typeFilter} onChange={setTypeFilter} counts={typeCounts} />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Total Revenue',  value: fmt(totalRevenue),   color: 'text-green-600',  bg: 'bg-green-50'  },
              { label: 'Total Bills',    value: totalCount,           color: 'text-blue-600',   bg: 'bg-blue-50'   },
              { label: 'Avg Bill Value', value: fmt(avgBillValue),    color: 'text-purple-600', bg: 'bg-purple-50' },
              { label: 'Total Refunds',  value: fmt(totalRefunds),    color: 'text-red-600',    bg: 'bg-red-50'    },
            ].map(card => (
              <div key={card.label} className={`rounded-xl shadow-sm p-5 ${card.bg}`}>
                <p className="text-sm text-gray-500 mb-1">{card.label}</p>
                <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
              </div>
            ))}
          </div>

          {/* Revenue by type (only when "all" selected) */}
          {typeFilter === 'all' && (dineInRevenue > 0 || taRevenue > 0) && (
            <div className="bg-white rounded-xl shadow-sm p-5">
              <h2 className="text-base font-semibold text-gray-700 mb-4">Revenue by Order Type</h2>
              <div className="flex flex-wrap gap-4">
                {[
                  { label: '🍽️ Dine-in',  value: dineInRevenue,                                  cls: 'text-indigo-700' },
                  { label: '🥡 Takeaway', value: taOrders.filter(o => o.type === 'takeaway' && o.status === 'completed').reduce((s, o) => s + (o.total || 0), 0), cls: 'text-teal-700'   },
                  { label: '🛵 Delivery', value: taOrders.filter(o => o.type === 'delivery' && o.status === 'completed').reduce((s, o) => s + (o.total || 0), 0), cls: 'text-purple-700' },
                ].map(item => (
                  <div key={item.label} className="flex-1 min-w-[120px] bg-gray-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-500 mb-1">{item.label}</p>
                    <p className={`text-lg font-bold ${item.cls}`}>{fmt(item.value)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

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
            <h2 className="text-base font-semibold text-gray-700 mb-4">By-Staff Breakdown</h2>
            {serverBreakdown.length === 0 ? <p className="text-sm text-gray-400">No data.</p> : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Staff</th>
                      <th className="text-right py-2 px-3 text-gray-500 font-medium">Orders</th>
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
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 2 — Bills Register
// ══════════════════════════════════════════════════════════════════════════════
function BillsRegisterTab({ staffMap, currentUserId }) {
  const [preset, setPreset]             = useState('today');
  const [customFrom, setCustomFrom]     = useState(format(new Date(), 'yyyy-MM-dd'));
  const [customTo, setCustomTo]         = useState(format(new Date(), 'yyyy-MM-dd'));
  const [typeFilter, setTypeFilter]     = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading]           = useState(false);
  const [fetched, setFetched]           = useState(false);
  const [allRows, setAllRows]           = useState([]);  // normalized unified rows

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

      const [billsSnap, tablesSnap, ordersSnap] = await Promise.all([
        getDocs(query(collection(db, 'bills'), where('closedAt', '>=', fromTs), where('closedAt', '<=', toTs))),
        getDocs(query(collection(db, 'tables'), where('status', 'in', ['bill_requested', 'occupied', 'ordering', 'eating']))),
        getDocs(query(collection(db, 'orders'), where('createdAt', '>=', fromTs), where('createdAt', '<=', toTs))),
      ]);

      // Settled dine-in bills
      const settled = billsSnap.docs.map(d => ({
        ...d.data(), id: d.id,
        _type: 'dine-in', _source: 'bill',
      }));

      // Active dine-in tables (unsettled)
      const pending = tablesSnap.docs
        .map(d => ({ ...d.data(), id: d.id }))
        .filter(t => t.seatedAt)
        .map(t => ({
          id: `table-${t.id}`, _type: 'dine-in', _source: 'table',
          status: t.status === 'bill_requested' ? 'bill_requested' : 'open',
          tableNumber: t.tableNumber, createdAt: t.seatedAt, closedAt: null,
          serverId: t.assignedServerId ?? null, paymentMode: null, total: null,
        }));

      // Takeaway / delivery orders — normalize to same shape
      const taRows = ordersSnap.docs
        .map(d => ({ ...d.data(), id: d.id }))
        .filter(o => o.type === 'takeaway' || o.type === 'delivery')
        .map(o => ({
          id: o.id, _type: o.type, _source: 'order',
          status: o.status === 'completed' ? 'paid' : o.status === 'cancelled' ? 'voided' : 'open',
          tableNumber: null,
          customerName: o.customerName, customerPhone: o.customerPhone,
          pickupToken: o.pickupToken, deliveryPartner: o.deliveryPartner,
          createdAt: o.createdAt, closedAt: o.createdAt,
          serverId: o.createdBy ?? null, paymentMode: o.paymentMethod,
          total: o.total,
        }));

      const rows = [...settled, ...pending, ...taRows].sort(
        (a, b) => (b.closedAt?.seconds ?? b.createdAt?.seconds ?? 0) - (a.closedAt?.seconds ?? a.createdAt?.seconds ?? 0)
      );
      setAllRows(rows);
      setFetched(true);
    } catch (err) {
      console.error(err);
      toast.error('Failed to fetch bills.');
    } finally {
      setLoading(false);
    }
  }

  const typeCounts = useMemo(() => ({
    all:      allRows.length,
    'dine-in': allRows.filter(r => r._type === 'dine-in').length,
    takeaway: allRows.filter(r => r._type === 'takeaway').length,
    delivery: allRows.filter(r => r._type === 'delivery').length,
  }), [allRows]);

  const afterTypeFilter = useMemo(() => {
    if (typeFilter === 'all') return allRows;
    return allRows.filter(r => r._type === typeFilter);
  }, [allRows, typeFilter]);

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return afterTypeFilter;
    if (statusFilter === 'unsettled') return afterTypeFilter.filter(r => r._source === 'table');
    return afterTypeFilter.filter(r => r.status === statusFilter);
  }, [afterTypeFilter, statusFilter]);

  const statusCounts = useMemo(() => {
    const map = { all: afterTypeFilter.length, unsettled: 0 };
    afterTypeFilter.forEach(r => {
      map[r.status] = (map[r.status] || 0) + 1;
      if (r._source === 'table') map.unsettled++;
    });
    return map;
  }, [afterTypeFilter]);

  const unsettledTotal = useMemo(
    () => afterTypeFilter.filter(r => r._source === 'table' && r.total).reduce((s, r) => s + (r.total || 0), 0),
    [afterTypeFilter]
  );

  const STATUS_FILTERS = [
    { value: 'all',            label: 'All' },
    { value: 'unsettled',      label: 'Unsettled' },
    { value: 'bill_requested', label: 'Bill Requested' },
    { value: 'open',           label: 'Active' },
    { value: 'paid',           label: 'Paid' },
    { value: 'voided',         label: 'Voided / Cancelled' },
  ];

  const TYPE_BADGE = {
    'dine-in':  { icon: '🍽️', cls: 'bg-blue-50 text-blue-700'    },
    takeaway:   { icon: '🥡', cls: 'bg-teal-50 text-teal-700'    },
    delivery:   { icon: '🛵', cls: 'bg-purple-50 text-purple-700' },
  };

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
          {/* Unsettled alert */}
          {statusCounts.unsettled > 0 && (
            <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
              <span className="text-2xl">⚠️</span>
              <div>
                <p className="text-sm font-semibold text-amber-800">
                  {statusCounts.unsettled} table{statusCounts.unsettled > 1 ? 's' : ''} with unsettled bills
                  {unsettledTotal > 0 ? ` — ${fmt(unsettledTotal)} outstanding` : ''}
                </p>
                <p className="text-xs text-amber-600 mt-0.5">These tables are still occupied and have not been settled.</p>
              </div>
            </div>
          )}

          {/* Bill type filter */}
          <TypeFilterPills value={typeFilter} onChange={v => { setTypeFilter(v); setStatusFilter('all'); }} counts={typeCounts} />

          {/* Status filter chips */}
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map(f => {
              const count = statusCounts[f.value] ?? 0;
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
              {filtered.length} record{filtered.length !== 1 ? 's' : ''}
              {statusFilter !== 'all' ? ` · ${STATUS_FILTERS.find(f => f.value === statusFilter)?.label}` : ''}
            </h2>
            {filtered.length === 0 ? (
              <p className="text-sm text-gray-400">No records match this filter.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Type</th>
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Status</th>
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Reference</th>
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Time</th>
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Staff</th>
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Payment</th>
                      <th className="text-right py-2 px-3 text-gray-500 font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(r => {
                      const ts = r.closedAt?.toDate ? r.closedAt.toDate() : r.createdAt?.toDate ? r.createdAt.toDate() : null;
                      const isUnsettled = r._source === 'table';
                      const isMine = currentUserId && r.serverId === currentUserId;
                      const badge = TYPE_BADGE[r._type] ?? { icon: '?', cls: 'bg-gray-100 text-gray-600' };
                      return (
                        <tr key={r.id} className={`border-b border-gray-50 hover:bg-indigo-50 ${isMine ? 'bg-indigo-50 font-medium' : isUnsettled ? 'bg-amber-50/40' : ''}`}>
                          <td className="py-2 px-3">
                            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${badge.cls}`}>
                              {badge.icon} {r._type}
                            </span>
                          </td>
                          <td className="py-2 px-3"><StatusBadge status={r.status} /></td>
                          <td className="py-2 px-3 text-gray-700 font-medium">
                            {r._type === 'dine-in'
                              ? <>Table {r.tableNumber ?? '—'}{isMine && <span className="ml-2 text-xs text-indigo-500 font-normal">you</span>}</>
                              : <span className="flex flex-col leading-tight">
                                  <span>{r.customerName ?? '—'}</span>
                                  {r.pickupToken && <span className="text-xs text-teal-600 font-mono">{r.pickupToken}</span>}
                                  {r.deliveryPartner && <span className="text-xs text-purple-600">{r.deliveryPartner}</span>}
                                </span>
                            }
                          </td>
                          <td className="py-2 px-3 text-gray-500">
                            {ts ? format(ts, 'dd MMM HH:mm') : isUnsettled ? <span className="text-amber-500 font-medium">In progress</span> : '—'}
                          </td>
                          <td className={`py-2 px-3 ${isMine ? 'text-indigo-700' : 'text-gray-600'}`}>
                            {r.serverName || staffMap[r.serverId] || '—'}
                          </td>
                          <td className="py-2 px-3 text-gray-600 capitalize">{r.paymentMode || '—'}</td>
                          <td className={`py-2 px-3 text-right font-semibold ${isMine ? 'text-indigo-700' : 'text-gray-800'}`}>
                            {r.total != null ? fmt(r.total) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {filtered.length > 1 && (
                    <tfoot>
                      <tr className="border-t-2 border-gray-200">
                        <td colSpan={6} className="py-2 px-3 text-sm font-semibold text-gray-600">Total</td>
                        <td className="py-2 px-3 text-right font-bold text-gray-800">
                          {fmt(filtered.reduce((s, r) => s + (r.total || 0), 0))}
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
// TAB 3 — Refunds
// ══════════════════════════════════════════════════════════════════════════════
function RefundsTab({ staffMap }) {
  const [preset, setPreset]         = useState('today');
  const [customFrom, setCustomFrom] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [customTo, setCustomTo]     = useState(format(new Date(), 'yyyy-MM-dd'));
  const [typeFilter, setTypeFilter] = useState('all');
  const [loading, setLoading]       = useState(false);
  const [fetched, setFetched]       = useState(false);
  const [refunds, setRefunds]       = useState([]);

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
      const snap = await getDocs(query(
        collection(db, 'refunds'),
        where('createdAt', '>=', fromTs),
        where('createdAt', '<=', toTs)
      ));
      setRefunds(snap.docs.map(d => ({ ...d.data(), id: d.id })));
      setFetched(true);
    } catch (err) {
      console.error(err);
      toast.error('Failed to fetch refunds.');
    } finally {
      setLoading(false);
    }
  }

  const typeCounts = useMemo(() => ({
    all:      refunds.length,
    'dine-in': refunds.filter(r => !r.orderType || r.orderType === 'dine-in').length,
    takeaway: refunds.filter(r => r.orderType === 'takeaway').length,
    delivery: refunds.filter(r => r.orderType === 'delivery').length,
  }), [refunds]);

  const filtered = useMemo(() => {
    if (typeFilter === 'all') return refunds;
    if (typeFilter === 'dine-in') return refunds.filter(r => !r.orderType || r.orderType === 'dine-in');
    return refunds.filter(r => r.orderType === typeFilter);
  }, [refunds, typeFilter]);

  const totalRefunded = useMemo(() => filtered.reduce((s, r) => s + (r.amount || 0), 0), [filtered]);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
        <DateRangePicker preset={preset} setPreset={setPreset} customFrom={customFrom}
          setCustomFrom={setCustomFrom} customTo={customTo} setCustomTo={setCustomTo}
          onReset={() => setFetched(false)} />
        <div className="pt-1">
          <button onClick={handleFetch} disabled={loading}
            className="px-6 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center gap-2">
            {loading ? <><span className="animate-spin">⏳</span> Loading…</> : '↩ Load Refunds'}
          </button>
        </div>
      </div>

      {!fetched && !loading && (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-3">
          <p className="text-5xl">↩</p>
          <p className="text-base font-medium">Select a date range and click Load Refunds</p>
        </div>
      )}

      {fetched && (
        <>
          {/* Summary card */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl shadow-sm p-5 bg-red-50">
              <p className="text-sm text-gray-500 mb-1">Total Refunded</p>
              <p className="text-2xl font-bold text-red-600">{fmt(totalRefunded)}</p>
            </div>
            <div className="rounded-xl shadow-sm p-5 bg-orange-50">
              <p className="text-sm text-gray-500 mb-1">Refund Count</p>
              <p className="text-2xl font-bold text-orange-600">{filtered.length}</p>
            </div>
            <div className="rounded-xl shadow-sm p-5 bg-amber-50">
              <p className="text-sm text-gray-500 mb-1">Avg Refund</p>
              <p className="text-2xl font-bold text-amber-600">{filtered.length ? fmt(totalRefunded / filtered.length) : '—'}</p>
            </div>
          </div>

          {/* Type filter */}
          <TypeFilterPills value={typeFilter} onChange={setTypeFilter} counts={typeCounts} />

          {/* Refunds table */}
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="text-base font-semibold text-gray-700 mb-4">{filtered.length} refund{filtered.length !== 1 ? 's' : ''}</h2>
            {filtered.length === 0 ? (
              <p className="text-sm text-gray-400">No refunds for this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Type</th>
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Time</th>
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Customer</th>
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Reason</th>
                      <th className="text-left py-2 px-3 text-gray-500 font-medium">Payment</th>
                      <th className="text-right py-2 px-3 text-gray-500 font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(r => {
                      const ts = r.createdAt?.toDate ? r.createdAt.toDate() : null;
                      const typeIcon = r.orderType === 'takeaway' ? '🥡' : r.orderType === 'delivery' ? '🛵' : '🍽️';
                      return (
                        <tr key={r.id} className="border-b border-gray-50 hover:bg-red-50">
                          <td className="py-2 px-3 text-gray-600">{typeIcon} {r.orderType ?? 'dine-in'}</td>
                          <td className="py-2 px-3 text-gray-500">{ts ? format(ts, 'dd MMM HH:mm') : '—'}</td>
                          <td className="py-2 px-3 text-gray-700">
                            {r.customerName ?? (r.itemName ? `Item: ${r.itemName}` : '—')}
                            {r.customerPhone && <span className="block text-xs text-gray-400">{r.customerPhone}</span>}
                          </td>
                          <td className="py-2 px-3 text-gray-500 max-w-xs truncate">{r.reason ?? '—'}</td>
                          <td className="py-2 px-3 text-gray-600 capitalize">{r.paymentMethod ?? '—'}</td>
                          <td className="py-2 px-3 text-right font-bold text-red-600">{fmt(r.amount)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {filtered.length > 1 && (
                    <tfoot>
                      <tr className="border-t-2 border-gray-200">
                        <td colSpan={5} className="py-2 px-3 text-sm font-semibold text-gray-600">Total Refunded</td>
                        <td className="py-2 px-3 text-right font-bold text-red-600">{fmt(totalRefunded)}</td>
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
  { id: 'analytics', label: '📊 Analytics'     },
  { id: 'bills',     label: '🧾 Bills Register' },
  { id: 'refunds',   label: '↩ Refunds'        },
];

export default function Reports() {
  const [activeTab, setActiveTab] = useState('analytics');
  const { user } = useAuth();
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

      {activeTab === 'analytics' && <AnalyticsTab staffMap={staffMap} currentUserId={user?.uid} />}
      {activeTab === 'bills'     && <BillsRegisterTab staffMap={staffMap} currentUserId={user?.uid} />}
      {activeTab === 'refunds'   && <RefundsTab staffMap={staffMap} />}
    </div>
  );
}
