import { useState, useEffect, useCallback } from 'react'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import { collection, getDocs, query, where, orderBy, Timestamp, addDoc } from 'firebase/firestore'
import { format, subDays, startOfDay, endOfDay } from 'date-fns'
import toast from 'react-hot-toast'

const TX_TYPE_META = {
  issue:      { label: 'Issue',      bg: 'bg-red-100',    text: 'text-red-700'    },
  return:     { label: 'Return',     bg: 'bg-green-100',  text: 'text-green-700'  },
  receive:    { label: 'Receive',    bg: 'bg-blue-100',   text: 'text-blue-700'   },
  wastage:    { label: 'Wastage',    bg: 'bg-orange-100', text: 'text-orange-700' },
  adjustment: { label: 'Adjustment', bg: 'bg-purple-100', text: 'text-purple-700' },
}

const PAGE_SIZE = 50

export default function InvLedger() {
  const { user, profile } = useAuth()
  const [activeTab, setActiveTab] = useState('ledger')
  const [ledgerRows, setLedgerRows] = useState([])
  const [materials, setMaterials] = useState([])
  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(false)

  const today = new Date()
  const [dateFrom, setDateFrom] = useState(format(subDays(today, 6), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(format(today, 'yyyy-MM-dd'))
  const [filterMaterial, setFilterMaterial] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [page, setPage] = useState(1)

  // Usage report state
  const [qtyMode, setQtyMode] = useState('effective') // 'effective' | 'withWastage'
  const [selectedRows, setSelectedRows] = useState(new Set())

  // Raise PO modal state
  const [showPOModal, setShowPOModal] = useState(false)
  const [poVendorId, setPOVendorId] = useState('')
  const [poItems, setPOItems] = useState([])
  const [poNotes, setPONotes] = useState('')
  const [savingPO, setSavingPO] = useState(false)

  const fetchMaterials = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, 'invMaterials'))
      setMaterials(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch {
      toast.error('Failed to load materials')
    }
  }, [])

  const fetchVendors = useCallback(async () => {
    try {
      const snap = await getDocs(query(collection(db, 'invVendors'), orderBy('name')))
      setVendors(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch {
      // non-critical
    }
  }, [])

  const fetchLedger = useCallback(async () => {
    setLoading(true)
    try {
      const from = Timestamp.fromDate(startOfDay(new Date(dateFrom)))
      const to = Timestamp.fromDate(endOfDay(new Date(dateTo)))
      const snap = await getDocs(query(
        collection(db, 'invLedger'),
        where('date', '>=', from),
        where('date', '<=', to),
        orderBy('date', 'desc')
      ))
      let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      if (filterMaterial) rows = rows.filter(r => r.materialId === filterMaterial)
      if (filterType !== 'all') rows = rows.filter(r => r.txType === filterType)
      setLedgerRows(rows)
      setPage(1)
      setSelectedRows(new Set())
    } catch {
      toast.error('Failed to load ledger')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, filterMaterial, filterType])

  useEffect(() => { fetchMaterials(); fetchVendors() }, [fetchMaterials, fetchVendors])
  useEffect(() => { fetchLedger() }, [fetchLedger])

  const totalIn  = ledgerRows.reduce((s, r) => r.qty > 0 ? s + r.qty : s, 0)
  const totalOut = ledgerRows.reduce((s, r) => r.qty < 0 ? s + Math.abs(r.qty) : s, 0)
  const netMovement = totalIn - totalOut
  const totalPages = Math.max(1, Math.ceil(ledgerRows.length / PAGE_SIZE))
  const paginated  = ledgerRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const buildUsageReport = useCallback(() => {
    const allRows = ledgerRows.filter(r => !filterMaterial || r.materialId === filterMaterial)
    const map = {}
    allRows.forEach(r => {
      if (!['issue', 'return', 'wastage'].includes(r.txType)) return
      if (!map[r.materialId]) {
        map[r.materialId] = { materialId: r.materialId, materialName: r.materialName, uom: r.uom, issued: 0, returned: 0, wasted: 0 }
      }
      const qty = Math.abs(r.qty)
      if (r.txType === 'issue')   map[r.materialId].issued   += qty
      if (r.txType === 'return')  map[r.materialId].returned += qty
      if (r.txType === 'wastage') map[r.materialId].wasted   += qty
    })
    return Object.values(map).sort((a, b) => a.materialName.localeCompare(b.materialName))
  }, [ledgerRows, filterMaterial])

  function getOrderQty(row) {
    const base = row.issued - row.returned - row.wasted
    return qtyMode === 'withWastage' ? base + row.wasted : base
  }

  function toggleRow(materialId) {
    setSelectedRows(prev => {
      const next = new Set(prev)
      next.has(materialId) ? next.delete(materialId) : next.add(materialId)
      return next
    })
  }

  function toggleAll(report) {
    if (selectedRows.size === report.length) {
      setSelectedRows(new Set())
    } else {
      setSelectedRows(new Set(report.map(r => r.materialId)))
    }
  }

  function openRaisePO() {
    const report = buildUsageReport()
    const selected = report.filter(r => selectedRows.has(r.materialId))
    const items = selected.map(r => ({
      materialId: r.materialId,
      materialName: r.materialName,
      uom: r.uom,
      orderedQty: Math.max(0, +getOrderQty(r).toFixed(3)),
    }))
    setPOItems(items)
    setPOVendorId('')
    setPONotes('')
    setShowPOModal(true)
  }

  function updatePOItemQty(idx, val) {
    setPOItems(prev => prev.map((it, i) => i === idx ? { ...it, orderedQty: parseFloat(val) || 0 } : it))
  }

  function removePOItem(idx) {
    setPOItems(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleSavePO(status) {
    if (!poVendorId) { toast.error('Select a vendor'); return }
    if (!poItems.length) { toast.error('No items selected'); return }
    const vendor = vendors.find(v => v.id === poVendorId)
    setSavingPO(true)
    try {
      await addDoc(collection(db, 'invPOs'), {
        date: Timestamp.now(),
        vendorId: vendor.id,
        vendorName: vendor.name,
        vendorPhone: vendor.phone || '',
        vendorWhatsapp: vendor.whatsapp || vendor.phone || '',
        status,
        items: poItems,
        notes: poNotes,
        createdBy: user?.uid || '',
        createdByName: profile?.name || user?.email || '',
      })
      toast.success(`PO ${status === 'draft' ? 'saved as draft' : 'created'}`)
      setShowPOModal(false)
      setSelectedRows(new Set())
    } catch {
      toast.error('Failed to create PO')
    } finally {
      setSavingPO(false)
    }
  }

  const exportCSV = () => {
    const headers = ['Date/Time', 'Material', 'UOM', 'Type', 'Qty', 'Reference', 'Recorded By', 'Note']
    const rows = ledgerRows.map(r => [
      r.date?.toDate ? format(r.date.toDate(), 'dd/MM/yyyy HH:mm') : '',
      r.materialName, r.uom, r.txType, r.qty,
      r.refType ? `${r.refType}:${r.refId}` : '',
      r.recordedByName || r.recordedBy || '',
      r.note || '',
    ])
    const csv = [headers, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `ledger_${dateFrom}_to_${dateTo}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const exportUsageCSV = (report) => {
    const headers = ['Material', 'UOM', 'Issued', 'Returned', 'Wasted', 'Effectively Used']
    const rows = report.map(r => [r.materialName, r.uom, r.issued, r.returned, r.wasted, +(r.issued - r.returned - r.wasted).toFixed(3)])
    const csv = [headers, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `kitchen_usage_${dateFrom}_to_${dateTo}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-800">Stock Ledger</h1>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-2">
        <button onClick={() => setActiveTab('ledger')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'ledger' ? 'bg-amber-500 text-white' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
          Ledger
        </button>
        <button onClick={() => setActiveTab('usage')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'usage' ? 'bg-amber-500 text-white' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
          Kitchen Usage Report
        </button>
      </div>

      {/* Date range + filters */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Material</label>
            <select value={filterMaterial} onChange={e => setFilterMaterial(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
              <option value="">All Materials</option>
              {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          {activeTab === 'ledger' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Type</label>
              <select value={filterType} onChange={e => setFilterType(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                <option value="all">All Types</option>
                {Object.entries(TX_TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* ── LEDGER TAB ── */}
      {activeTab === 'ledger' && (
        <>
          <div className="flex items-center justify-end">
            <button onClick={exportCSV} className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">
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
                            <td className="px-4 py-3 text-gray-500">{row.recordedByName || row.recordedBy || '—'}</td>
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
                      <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
                        className="border border-gray-300 text-gray-700 px-3 py-1 rounded-lg text-sm disabled:opacity-40 hover:bg-white">Prev</button>
                      <span className="px-3 py-1 text-sm text-gray-600">{page} / {totalPages}</span>
                      <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)}
                        className="border border-gray-300 text-gray-700 px-3 py-1 rounded-lg text-sm disabled:opacity-40 hover:bg-white">Next</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* ── KITCHEN USAGE REPORT TAB ── */}
      {activeTab === 'usage' && (() => {
        const report = buildUsageReport()
        const totIssued   = report.reduce((s, r) => s + r.issued, 0)
        const totReturned = report.reduce((s, r) => s + r.returned, 0)
        const totWasted   = report.reduce((s, r) => s + r.wasted, 0)
        const totUsed     = totIssued - totReturned - totWasted
        const allSelected = report.length > 0 && selectedRows.size === report.length
        const someSelected = selectedRows.size > 0

        return (
          <>
            {/* Controls row */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 font-medium">PO Qty based on:</span>
                <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
                  <button onClick={() => setQtyMode('effective')}
                    className={`px-3 py-1 rounded text-xs font-medium transition-colors ${qtyMode === 'effective' ? 'bg-white shadow text-amber-600' : 'text-gray-600'}`}>
                    Effectively Used
                  </button>
                  <button onClick={() => setQtyMode('withWastage')}
                    className={`px-3 py-1 rounded text-xs font-medium transition-colors ${qtyMode === 'withWastage' ? 'bg-white shadow text-amber-600' : 'text-gray-600'}`}>
                    Used + Wastage
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => exportUsageCSV(report)} className="border border-gray-300 text-gray-700 px-3 py-2 rounded-lg text-xs font-medium hover:bg-gray-50">
                  Export CSV
                </button>
                {someSelected && (
                  <button onClick={openRaisePO}
                    className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
                    Raise PO ({selectedRows.size} item{selectedRows.size !== 1 ? 's' : ''})
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-xl shadow-sm border p-4">
                <p className="text-xs text-gray-500 mb-1">Total Issued</p>
                <p className="text-2xl font-bold text-red-500">{totIssued.toFixed(2)}</p>
              </div>
              <div className="bg-white rounded-xl shadow-sm border p-4">
                <p className="text-xs text-gray-500 mb-1">Total Returned</p>
                <p className="text-2xl font-bold text-green-600">{totReturned.toFixed(2)}</p>
              </div>
              <div className="bg-white rounded-xl shadow-sm border p-4">
                <p className="text-xs text-gray-500 mb-1">Total Wasted</p>
                <p className="text-2xl font-bold text-orange-500">{totWasted.toFixed(2)}</p>
              </div>
              <div className="bg-white rounded-xl shadow-sm border p-4">
                <p className="text-xs text-gray-500 mb-1">Effectively Used</p>
                <p className="text-2xl font-bold text-amber-600">{totUsed.toFixed(2)}</p>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              {loading ? (
                <div className="flex items-center justify-center py-16 text-gray-400 text-sm">Loading...</div>
              ) : report.length === 0 ? (
                <div className="flex items-center justify-center py-16 text-gray-400 text-sm">No kitchen activity in this date range</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-4 py-3">
                          <input type="checkbox" checked={allSelected} onChange={() => toggleAll(report)}
                            className="w-4 h-4 rounded border-gray-300 accent-amber-500 cursor-pointer" />
                        </th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Material</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">UOM</th>
                        <th className="text-right px-4 py-3 text-xs font-medium text-red-500 uppercase tracking-wide">Issued</th>
                        <th className="text-right px-4 py-3 text-xs font-medium text-green-600 uppercase tracking-wide">Returned</th>
                        <th className="text-right px-4 py-3 text-xs font-medium text-orange-500 uppercase tracking-wide">Wasted</th>
                        <th className="text-right px-4 py-3 text-xs font-medium text-amber-600 uppercase tracking-wide">Effectively Used</th>
                        <th className="text-right px-4 py-3 text-xs font-medium text-blue-600 uppercase tracking-wide">PO Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {report.map(r => {
                        const effectivelyUsed = +(r.issued - r.returned - r.wasted).toFixed(3)
                        const poQty = +getOrderQty(r).toFixed(3)
                        const checked = selectedRows.has(r.materialId)
                        return (
                          <tr key={r.materialId} onClick={() => toggleRow(r.materialId)}
                            className={`cursor-pointer transition-colors ${checked ? 'bg-amber-50' : 'hover:bg-gray-50'}`}>
                            <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                              <input type="checkbox" checked={checked} onChange={() => toggleRow(r.materialId)}
                                className="w-4 h-4 rounded border-gray-300 accent-amber-500 cursor-pointer" />
                            </td>
                            <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{r.materialName}</td>
                            <td className="px-4 py-3 text-gray-500">{r.uom}</td>
                            <td className="px-4 py-3 text-right font-semibold tabular-nums text-red-500">{r.issued.toFixed(3)}</td>
                            <td className="px-4 py-3 text-right font-semibold tabular-nums text-green-600">{r.returned.toFixed(3)}</td>
                            <td className="px-4 py-3 text-right font-semibold tabular-nums text-orange-500">{r.wasted.toFixed(3)}</td>
                            <td className="px-4 py-3 text-right font-bold tabular-nums text-amber-600">{effectivelyUsed.toFixed(3)}</td>
                            <td className={`px-4 py-3 text-right font-bold tabular-nums ${checked ? 'text-blue-600' : 'text-gray-400'}`}>{poQty.toFixed(3)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                      <tr>
                        <td colSpan={3} className="px-4 py-3 font-semibold text-gray-700">Total</td>
                        <td className="px-4 py-3 text-right font-bold tabular-nums text-red-500">{totIssued.toFixed(3)}</td>
                        <td className="px-4 py-3 text-right font-bold tabular-nums text-green-600">{totReturned.toFixed(3)}</td>
                        <td className="px-4 py-3 text-right font-bold tabular-nums text-orange-500">{totWasted.toFixed(3)}</td>
                        <td className="px-4 py-3 text-right font-bold tabular-nums text-amber-600">{totUsed.toFixed(3)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

            {someSelected && (
              <div className="fixed bottom-4 left-0 right-0 flex justify-center z-40 px-4">
                <div className="bg-gray-900 text-white rounded-xl px-5 py-3 flex items-center gap-4 shadow-xl">
                  <span className="text-sm">{selectedRows.size} item{selectedRows.size !== 1 ? 's' : ''} selected</span>
                  <button onClick={() => setSelectedRows(new Set())} className="text-xs text-gray-400 hover:text-white">Clear</button>
                  <button onClick={openRaisePO} className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium">
                    Raise PO
                  </button>
                </div>
              </div>
            )}
          </>
        )
      })()}

      {/* ── RAISE PO MODAL ── */}
      {showPOModal && (
        <div className="fixed inset-0 bg-black/50 flex items-end md:items-center justify-center z-50 p-0 md:p-4">
          <div className="bg-white w-full md:rounded-xl shadow-xl md:max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 className="text-lg font-semibold text-gray-900">Raise Purchase Order</h2>
              <button onClick={() => setShowPOModal(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vendor</label>
                <select value={poVendorId} onChange={e => setPOVendorId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                  <option value="">Select vendor...</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">Items ({poItems.length})</label>
                  <span className="text-xs text-gray-400">Qty based on: <span className="text-amber-600 font-medium">{qtyMode === 'effective' ? 'Effectively Used' : 'Used + Wastage'}</span></span>
                </div>
                <div className="rounded-lg border overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-600 whitespace-nowrap">Material</th>
                        <th className="text-center px-3 py-2 text-xs font-medium text-gray-600">UOM</th>
                        <th className="text-center px-3 py-2 text-xs font-medium text-gray-600">Qty</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {poItems.map((it, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-3 py-2 whitespace-nowrap text-gray-800">{it.materialName}</td>
                          <td className="px-3 py-2 text-center text-gray-500">{it.uom}</td>
                          <td className="px-3 py-2 text-center">
                            <input type="number" min="0" step="0.001" value={it.orderedQty}
                              onChange={e => updatePOItemQty(idx, e.target.value)}
                              className="w-24 border border-gray-300 rounded px-2 py-1 text-center text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button onClick={() => removePOItem(idx)}
                              className="border border-red-300 text-red-500 hover:bg-red-50 px-2 py-1 rounded text-xs font-medium">🗑</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea value={poNotes} onChange={e => setPONotes(e.target.value)} rows={2} placeholder="Optional notes..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t">
              <button onClick={() => setShowPOModal(false)}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={() => handleSavePO('draft')} disabled={savingPO}
                className="border border-amber-400 text-amber-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-50 disabled:opacity-50">
                {savingPO ? 'Saving...' : 'Save as Draft'}
              </button>
              <button onClick={() => handleSavePO('sent')} disabled={savingPO}
                className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                {savingPO ? 'Saving...' : 'Create PO'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
