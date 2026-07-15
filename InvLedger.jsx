import { useState, useEffect, useCallback } from 'react'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import { collection, getDocs, query, where, orderBy, Timestamp } from 'firebase/firestore'
import { format, subDays, startOfDay, endOfDay } from 'date-fns'
import toast from 'react-hot-toast'

const TX_TYPE_META = {
  issue: { label: 'Issue', bg: 'bg-red-100', text: 'text-red-700' },
  return: { label: 'Return', bg: 'bg-green-100', text: 'text-green-700' },
  receive: { label: 'Receive', bg: 'bg-blue-100', text: 'text-blue-700' },
  wastage: { label: 'Wastage', bg: 'bg-orange-100', text: 'text-orange-700' },
  adjustment: { label: 'Adjustment', bg: 'bg-purple-100', text: 'text-purple-700' },
}

const PAGE_SIZE = 50

export default function InvLedger() {
  const { currentUser } = useAuth()

  const [ledgerRows, setLedgerRows] = useState([])
  const [materials, setMaterials] = useState([])
  const [loading, setLoading] = useState(false)

  const today = new Date()
  const [dateFrom, setDateFrom] = useState(format(subDays(today, 6), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(format(today, 'yyyy-MM-dd'))
  const [filterMaterial, setFilterMaterial] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [page, setPage] = useState(1)

  const fetchMaterials = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, 'invMaterials'))
      setMaterials(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch {
      toast.error('Failed to load materials')
    }
  }, [])

  const fetchLedger = useCallback(async () => {
    setLoading(true)
    try {
      const from = Timestamp.fromDate(startOfDay(new Date(dateFrom)))
      const to = Timestamp.fromDate(endOfDay(new Date(dateTo)))

      const constraints = [
        where('date', '>=', from),
        where('date', '<=', to),
        orderBy('date', 'desc'),
      ]

      const snap = await getDocs(query(collection(db, 'invLedger'), ...constraints))
      let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))

      if (filterMaterial) {
        rows = rows.filter(r => r.materialId === filterMaterial)
      }
      if (filterType !== 'all') {
        rows = rows.filter(r => r.txType === filterType)
      }

      setLedgerRows(rows)
      setPage(1)
    } catch (err) {
      toast.error('Failed to load ledger')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, filterMaterial, filterType])

  useEffect(() => {
    fetchMaterials()
  }, [fetchMaterials])

  useEffect(() => {
    fetchLedger()
  }, [fetchLedger])

  const totalIn = ledgerRows.reduce((s, r) => r.qty > 0 ? s + r.qty : s, 0)
  const totalOut = ledgerRows.reduce((s, r) => r.qty < 0 ? s + Math.abs(r.qty) : s, 0)
  const netMovement = totalIn - totalOut

  const totalPages = Math.max(1, Math.ceil(ledgerRows.length / PAGE_SIZE))
  const paginated = ledgerRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const exportCSV = () => {
    const headers = ['Date/Time', 'Material', 'UOM', 'Type', 'Qty', 'Reference', 'Recorded By', 'Note']
    const rows = ledgerRows.map(r => [
      r.date?.toDate ? format(r.date.toDate(), 'dd/MM/yyyy HH:mm') : '',
      r.materialName,
      r.uom,
      r.txType,
      r.qty,
      r.refType ? `${r.refType}:${r.refId}` : '',
      r.recordedBy || '',
      r.note || '',
    ])
    const csv = [headers, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ledger_${dateFrom}_to_${dateTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-800">Stock Ledger</h1>
        <button
          onClick={exportCSV}
          className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50"
        >
          Export CSV
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <p className="text-xs text-gray-500 mb-1">Total In</p>
          <p className="text-2xl font-bold text-green-600">{totalIn.toFixed(2)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <p className="text-xs text-gray-500 mb-1">Total Out</p>
          <p className="text-2xl font-bold text-red-500">{totalOut.toFixed(2)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <p className="text-xs text-gray-500 mb-1">Net Movement</p>
          <p className={`text-2xl font-bold ${netMovement >= 0 ? 'text-green-600' : 'text-red-500'}`}>
            {netMovement >= 0 ? '+' : ''}{netMovement.toFixed(2)}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Material</label>
            <select
              value={filterMaterial}
              onChange={e => setFilterMaterial(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              <option value="">All Materials</option>
              {materials.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Type</label>
            <select
              value={filterType}
              onChange={e => setFilterType(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              <option value="all">All Types</option>
              {Object.entries(TX_TYPE_META).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 text-sm">Loading...</div>
        ) : ledgerRows.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-gray-400 text-sm">No transactions found</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Date / Time</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Material</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">UOM</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Type</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Qty</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Reference</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Recorded By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {paginated.map(row => {
                    const meta = TX_TYPE_META[row.txType] || { label: row.txType, bg: 'bg-gray-100', text: 'text-gray-700' }
                    const dateStr = row.date?.toDate ? format(row.date.toDate(), 'dd/MM/yyyy HH:mm') : '—'
                    const ref = row.refType ? `${row.refType}: ${row.refId?.slice(0, 8) ?? ''}` : '—'
                    return (
                      <tr key={row.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{dateStr}</td>
                        <td className="px-4 py-3 font-medium text-gray-800">{row.materialName}</td>
                        <td className="px-4 py-3 text-gray-500">{row.uom}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${meta.bg} ${meta.text}`}>
                            {meta.label}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-right font-semibold tabular-nums ${row.qty >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                          {row.qty >= 0 ? '+' : ''}{row.qty}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{ref}</td>
                        <td className="px-4 py-3 text-gray-500">{row.recordedBy || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
                <p className="text-xs text-gray-500">
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, ledgerRows.length)} of {ledgerRows.length}
                </p>
                <div className="flex gap-2">
                  <button
                    disabled={page === 1}
                    onClick={() => setPage(p => p - 1)}
                    className="border border-gray-300 text-gray-700 px-3 py-1 rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-white"
                  >
                    Prev
                  </button>
                  <span className="px-3 py-1 text-sm text-gray-600">{page} / {totalPages}</span>
                  <button
                    disabled={page === totalPages}
                    onClick={() => setPage(p => p + 1)}
                    className="border border-gray-300 text-gray-700 px-3 py-1 rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-white"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
