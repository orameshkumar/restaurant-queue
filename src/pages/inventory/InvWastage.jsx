import { useState, useEffect } from 'react'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import toast from 'react-hot-toast'
import {
  collection,
  addDoc,
  getDocs,
  writeBatch,
  query,
  orderBy,
  where,
  Timestamp,
  increment,
  doc,
} from 'firebase/firestore'
import { format, startOfMonth, endOfMonth, parseISO, startOfDay, endOfDay } from 'date-fns'

export default function InvWastage() {
  const { user, profile } = useAuth()

  const [materials, setMaterials] = useState([])
  const [wastageHistory, setWastageHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [activeTab, setActiveTab] = useState('form')

  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const [formDate, setFormDate] = useState(todayStr)
  const [reason, setReason] = useState('')
  const [items, setItems] = useState([{ materialId: '', materialName: '', uom: '', qty: '', currentStock: 0, search: '', results: [], showDropdown: false }])

  const [issuedRequests, setIssuedRequests] = useState([])
  const [showRequestPicker, setShowRequestPicker] = useState(false)

  const [filterFrom, setFilterFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'))
  const [filterTo, setFilterTo] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'))
  const [expandedRow, setExpandedRow] = useState(null)

  useEffect(() => {
    fetchMaterials()
    fetchHistory()
    fetchIssuedRequests()
  }, [])

  async function fetchMaterials() {
    const snap = await getDocs(collection(db, 'invMaterials'))
    setMaterials(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  async function fetchIssuedRequests() {
    try {
      const snap = await getDocs(query(
        collection(db, 'invRequests'),
        where('status', '==', 'issued'),
        orderBy('date', 'desc')
      ))
      setIssuedRequests(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch {
      // non-critical
    }
  }

  function loadFromRequest(req) {
    const loaded = (req.items || []).map(it => {
      const mat = materials.find(m => m.id === it.materialId)
      return {
        materialId: it.materialId,
        materialName: it.materialName,
        uom: it.uom,
        qty: it.qty ?? '',
        currentStock: mat?.currentStock ?? 0,
        search: it.materialName,
        results: [],
        showDropdown: false,
      }
    })
    if (loaded.length > 0) {
      setItems(loaded)
      if (!reason) setReason('From request: ' + (req.requestedByName || req.notes || ''))
    }
    setShowRequestPicker(false)
    toast.success(`Loaded ${loaded.length} item${loaded.length !== 1 ? 's' : ''} from request`)
  }

  async function fetchHistory() {
    setLoadingHistory(true)
    const q = query(collection(db, 'invWastage'), orderBy('date', 'desc'))
    const snap = await getDocs(q)
    setWastageHistory(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    setLoadingHistory(false)
  }

  function searchMaterials(idx, value) {
    const updated = [...items]
    updated[idx].search = value
    updated[idx].materialId = ''
    updated[idx].materialName = ''
    updated[idx].uom = ''
    updated[idx].currentStock = 0
    if (value.trim().length > 0) {
      const lower = value.toLowerCase()
      updated[idx].results = materials.filter(m => m.name.toLowerCase().includes(lower)).slice(0, 8)
      updated[idx].showDropdown = true
    } else {
      updated[idx].results = []
      updated[idx].showDropdown = false
    }
    setItems(updated)
  }

  function selectMaterial(idx, material) {
    const updated = [...items]
    updated[idx].materialId = material.id
    updated[idx].materialName = material.name
    updated[idx].uom = material.uom
    updated[idx].currentStock = material.currentStock ?? 0
    updated[idx].search = material.name
    updated[idx].results = []
    updated[idx].showDropdown = false
    setItems(updated)
  }

  function updateQty(idx, value) {
    const updated = [...items]
    updated[idx].qty = value
    setItems(updated)
  }

  function addItem() {
    setItems([...items, { materialId: '', materialName: '', uom: '', qty: '', currentStock: 0, search: '', results: [], showDropdown: false }])
  }

  function removeItem(idx) {
    if (items.length === 1) return
    setItems(items.filter((_, i) => i !== idx))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!reason.trim()) { toast.error('Reason is required'); return }
    const validItems = items.filter(it => it.materialId && parseFloat(it.qty) > 0)
    if (validItems.length === 0) { toast.error('Add at least one item with quantity'); return }

    setSubmitting(true)
    try {
      const batch = writeBatch(db)
      const dateTs = Timestamp.fromDate(new Date(formDate + 'T00:00:00'))

      const wastageRef = doc(collection(db, 'invWastage'))
      batch.set(wastageRef, {
        date: dateTs,
        recordedBy: user?.uid || '',
        recordedByName: profile?.name || user?.email || '',
        reason: reason.trim(),
        items: validItems.map(it => ({
          materialId: it.materialId,
          materialName: it.materialName,
          uom: it.uom,
          qty: parseFloat(it.qty),
        })),
      })

      for (const it of validItems) {
        const qty = parseFloat(it.qty)
        const matRef = doc(db, 'invMaterials', it.materialId)
        batch.update(matRef, { currentStock: increment(-qty) })

        const ledgerRef = doc(collection(db, 'invLedger'))
        batch.set(ledgerRef, {
          materialId: it.materialId,
          materialName: it.materialName,
          uom: it.uom,
          date: dateTs,
          txType: 'wastage',
          qty: -qty,
          refId: wastageRef.id,
          refType: 'invWastage',
          note: reason.trim(),
          recordedBy: user?.uid || '', recordedByName: profile?.name || user?.email || '',
        })
      }

      await batch.commit()
      toast.success('Wastage recorded successfully')
      setFormDate(todayStr)
      setReason('')
      setItems([{ materialId: '', materialName: '', uom: '', qty: '', currentStock: 0, search: '', results: [], showDropdown: false }])
      fetchMaterials()
      fetchHistory()
    } catch (err) {
      toast.error('Failed to record wastage')
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  const filteredHistory = wastageHistory.filter(w => {
    if (!w.date) return true
    const d = w.date.toDate()
    const from = filterFrom ? startOfDay(parseISO(filterFrom)) : null
    const to = filterTo ? endOfDay(parseISO(filterTo)) : null
    if (from && d < from) return false
    if (to && d > to) return false
    return true
  })

  const topWasted = (() => {
    const monthStart = startOfMonth(new Date())
    const monthEnd = endOfMonth(new Date())
    const agg = {}
    wastageHistory.forEach(w => {
      if (!w.date) return
      const d = w.date.toDate()
      if (d < monthStart || d > monthEnd) return
      ;(w.items || []).forEach(it => {
        if (!agg[it.materialId]) agg[it.materialId] = { name: it.materialName, uom: it.uom, total: 0 }
        agg[it.materialId].total += it.qty
      })
    })
    return Object.values(agg).sort((a, b) => b.total - a.total).slice(0, 5)
  })()

  function itemsSummary(items) {
    if (!items || items.length === 0) return '—'
    return items.slice(0, 3).map(it => `${it.materialName} (${it.qty} ${it.uom})`).join(', ') + (items.length > 3 ? ` +${items.length - 3} more` : '')
  }

  return (
    <div className="p-6 w-full">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">Wastage Recording</h1>

      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab('form')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'form' ? 'bg-amber-500 text-white' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'}`}
        >
          Record Wastage
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'history' ? 'bg-amber-500 text-white' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'}`}
        >
          Wastage History
        </button>
      </div>

      {activeTab === 'form' && (
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <h2 className="text-lg font-semibold text-gray-700 mb-5">New Wastage Entry</h2>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                <input
                  type="date"
                  value={formDate}
                  onChange={e => setFormDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reason <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="e.g. Spoilage, Expired, Cooking error"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  required
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">Items</label>
                {issuedRequests.length > 0 && (
                  <button type="button" onClick={() => setShowRequestPicker(true)}
                    className="border border-amber-400 text-amber-700 px-3 py-1 rounded-lg text-xs font-medium hover:bg-amber-50">
                    Load from Request
                  </button>
                )}
              </div>
              <div className="space-y-3">
                {items.map((item, idx) => (
                  <div key={idx} className="flex flex-wrap gap-2 items-start bg-gray-50 rounded-lg p-3 border border-gray-200">
                    <div className="relative flex-1 min-w-[200px]">
                      <input
                        type="text"
                        value={item.search}
                        onChange={e => searchMaterials(idx, e.target.value)}
                        placeholder="Search material..."
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                      {item.showDropdown && item.results.length > 0 && (
                        <div className="absolute z-10 top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                          {item.results.map(m => (
                            <div
                              key={m.id}
                              onClick={() => selectMaterial(idx, m)}
                              className="px-3 py-2 text-sm hover:bg-amber-50 cursor-pointer flex justify-between"
                            >
                              <span>{m.name}</span>
                              <span className="text-gray-400 text-xs">{m.uom} · stock: {m.currentStock ?? 0}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={item.qty}
                        onChange={e => updateQty(idx, e.target.value)}
                        placeholder="Qty"
                        className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                      {item.uom && <span className="text-sm text-gray-500 w-10">{item.uom}</span>}
                    </div>

                    {item.materialId && (
                      <div className="flex items-center">
                        {parseFloat(item.qty) > item.currentStock ? (
                          <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                            Stock: {item.currentStock} {item.uom} — exceeds stock
                          </span>
                        ) : (
                          <span className="text-xs text-gray-500">Stock: {item.currentStock} {item.uom}</span>
                        )}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      className="text-red-400 hover:text-red-600 px-2 py-2 text-sm"
                      disabled={items.length === 1}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addItem}
                className="mt-3 text-sm text-amber-600 hover:text-amber-700 font-medium"
              >
                + Add Item
              </button>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={submitting}
                className="bg-amber-500 hover:bg-amber-600 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {submitting ? 'Saving...' : 'Record Wastage'}
              </button>
            </div>
          </form>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-6">
          {topWasted.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border p-5">
              <h2 className="text-base font-semibold text-gray-700 mb-3">Top 5 Wasted Items This Month</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                {topWasted.map((item, i) => (
                  <div key={i} className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-center">
                    <div className="text-xs text-amber-600 font-semibold mb-1">#{i + 1}</div>
                    <div className="text-sm font-medium text-gray-800 truncate" title={item.name}>{item.name}</div>
                    <div className="text-sm text-amber-700 font-bold mt-1">{item.total} <span className="text-xs font-normal">{item.uom}</span></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm border p-5">
            <div className="flex flex-wrap gap-3 items-end mb-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">From</label>
                <input
                  type="date"
                  value={filterFrom}
                  onChange={e => setFilterFrom(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">To</label>
                <input
                  type="date"
                  value={filterTo}
                  onChange={e => setFilterTo(e.target.value)}
                  className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
              <button
                onClick={() => { setFilterFrom(''); setFilterTo('') }}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Clear
              </button>
            </div>

            {loadingHistory ? (
              <div className="text-center py-10 text-gray-400 text-sm">Loading...</div>
            ) : filteredHistory.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-sm">No wastage records found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 uppercase border-b">
                      <th className="pb-2 pr-4">Date</th>
                      <th className="pb-2 pr-4">Recorded By</th>
                      <th className="pb-2 pr-4">Reason</th>
                      <th className="pb-2 pr-4">Items</th>
                      <th className="pb-2 pr-4">Summary</th>
                      <th className="pb-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredHistory.map(w => (
                      <>
                        <tr key={w.id} className="hover:bg-gray-50">
                          <td className="py-3 pr-4 whitespace-nowrap">{w.date ? format(w.date.toDate(), 'dd MMM yyyy') : '—'}</td>
                          <td className="py-3 pr-4">{w.recordedByName}</td>
                          <td className="py-3 pr-4 max-w-[180px] truncate" title={w.reason}>{w.reason}</td>
                          <td className="py-3 pr-4 text-center">{(w.items || []).length}</td>
                          <td className="py-3 pr-4 text-gray-500 max-w-[260px] truncate" title={itemsSummary(w.items)}>{itemsSummary(w.items)}</td>
                          <td className="py-3">
                            <button
                              onClick={() => setExpandedRow(expandedRow === w.id ? null : w.id)}
                              className="text-amber-500 hover:text-amber-700 text-xs font-medium"
                            >
                              {expandedRow === w.id ? 'Hide' : 'View'}
                            </button>
                          </td>
                        </tr>
                        {expandedRow === w.id && (
                          <tr key={w.id + '-detail'}>
                            <td colSpan={6} className="bg-amber-50 px-4 py-3">
                              <div className="text-xs font-semibold text-gray-600 mb-2">Items Detail</div>
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-gray-400">
                                    <th className="text-left pb-1 pr-4">Material</th>
                                    <th className="text-left pb-1 pr-4">UOM</th>
                                    <th className="text-left pb-1">Qty Wasted</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-amber-100">
                                  {(w.items || []).map((it, i) => (
                                    <tr key={i}>
                                      <td className="py-1 pr-4">{it.materialName}</td>
                                      <td className="py-1 pr-4">{it.uom}</td>
                                      <td className="py-1 font-medium text-red-600">{it.qty}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {showRequestPicker && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h3 className="text-base font-semibold text-gray-800">Select Issued Request</h3>
              <button onClick={() => setShowRequestPicker(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y">
              {issuedRequests.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-gray-400">No issued requests found</p>
              ) : (
                issuedRequests.map(req => (
                  <button key={req.id} onClick={() => loadFromRequest(req)}
                    className="w-full text-left px-5 py-3 hover:bg-amber-50 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-800 text-sm">{req.requestedByName || '—'}</span>
                      <span className="text-xs text-gray-400">
                        {req.date?.toDate ? format(req.date.toDate(), 'dd MMM yyyy') : '—'}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500">
                      {(req.items || []).slice(0, 3).map(it => `${it.materialName} (${it.qty} ${it.uom})`).join(', ')}
                      {(req.items || []).length > 3 ? ` +${req.items.length - 3} more` : ''}
                    </div>
                    {req.notes && <div className="text-xs text-gray-400 italic">{req.notes}</div>}
                  </button>
                ))
              )}
            </div>
            <div className="px-5 py-3 border-t flex justify-end">
              <button onClick={() => setShowRequestPicker(false)}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
