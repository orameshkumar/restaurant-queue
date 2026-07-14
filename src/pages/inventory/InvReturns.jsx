import { useState, useEffect } from 'react'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import toast from 'react-hot-toast'
import {
  collection, addDoc, getDocs, writeBatch, query,
  orderBy, Timestamp, increment, doc
} from 'firebase/firestore'
import { format } from 'date-fns'

export default function InvReturns() {
  const { user, profile } = useAuth()
  const [materials, setMaterials] = useState([])
  const [returns, setReturns] = useState([])
  const [issuedRequests, setIssuedRequests] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [showCopyModal, setShowCopyModal] = useState(false)
  const [copyPickerPage, setCopyPickerPage] = useState(0)
  const [expandedRow, setExpandedRow] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [materialSearch, setMaterialSearch] = useState('')
  const [showMaterialDropdown, setShowMaterialDropdown] = useState(false)

  const [form, setForm] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    items: [],
    notes: ''
  })

  useEffect(() => {
    fetchMaterials()
    fetchReturns()
    fetchIssuedRequests()
  }, [])

  async function fetchMaterials() {
    const snap = await getDocs(query(collection(db, 'invMaterials'), orderBy('name')))
    setMaterials(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  async function fetchReturns() {
    const snap = await getDocs(query(collection(db, 'invReturns'), orderBy('date', 'desc')))
    setReturns(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  async function fetchIssuedRequests() {
    const snap = await getDocs(
      query(collection(db, 'invRequests'), orderBy('date', 'desc'))
    )
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    setIssuedRequests(all.filter(r => r.status === 'issued' || r.status === 'partial'))
  }

  function resetForm() {
    setForm({ date: format(new Date(), 'yyyy-MM-dd'), items: [], notes: '' })
    setMaterialSearch('')
  }

  function handleAddMaterial(material) {
    if (form.items.find(i => i.materialId === material.id)) {
      toast.error('Material already added')
      return
    }
    setForm(prev => ({
      ...prev,
      items: [...prev.items, { materialId: material.id, materialName: material.name, uom: material.uom, qty: '' }]
    }))
    setMaterialSearch('')
    setShowMaterialDropdown(false)
  }

  function handleItemQtyChange(index, value) {
    setForm(prev => {
      const items = [...prev.items]
      items[index] = { ...items[index], qty: value }
      return { ...prev, items }
    })
  }

  function handleRemoveItem(index) {
    setForm(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }))
  }

  function handleCopyFromRequest(request) {
    const items = request.items
      .filter(i => (i.issuedQty || 0) > 0)
      .map(i => ({
        materialId: i.materialId,
        materialName: i.materialName,
        uom: i.uom,
        qty: String(i.issuedQty || '')
      }))
    setForm(prev => ({ ...prev, items }))
    setShowCopyModal(false)
    toast.success('Items copied from request')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (form.items.length === 0) {
      toast.error('Add at least one item')
      return
    }
    for (const item of form.items) {
      if (!item.qty || isNaN(item.qty) || Number(item.qty) <= 0) {
        toast.error(`Enter valid quantity for ${item.materialName}`)
        return
      }
    }
    setSubmitting(true)
    try {
      const batch = writeBatch(db)
      const returnDate = Timestamp.fromDate(new Date(form.date))

      const returnRef = doc(collection(db, 'invReturns'))
      batch.set(returnRef, {
        date: returnDate,
        returnedBy: user?.uid || '',
        returnedByName: profile?.name || user?.email || '',
        items: form.items.map(i => ({ ...i, qty: Number(i.qty) })),
        notes: form.notes
      })

      for (const item of form.items) {
        const qty = Number(item.qty)
        const matRef = doc(db, 'invMaterials', item.materialId)
        batch.update(matRef, { currentStock: increment(qty) })

        const ledgerRef = doc(collection(db, 'invLedger'))
        batch.set(ledgerRef, {
          materialId: item.materialId,
          materialName: item.materialName,
          uom: item.uom,
          date: returnDate,
          txType: 'return',
          qty: qty,
          refId: returnRef.id,
          refType: 'invReturns',
          note: form.notes || '',
          recordedBy: user?.uid || '', recordedByName: profile?.name || user?.email || ''
        })
      }

      await batch.commit()
      toast.success('Return recorded successfully')
      resetForm()
      setShowForm(false)
      fetchReturns()
      fetchMaterials()
    } catch (err) {
      toast.error('Failed to record return')
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  const filteredMaterials = materials.filter(
    m =>
      materialSearch.length > 0 &&
      m.name.toLowerCase().includes(materialSearch.toLowerCase()) &&
      !form.items.find(i => i.materialId === m.id)
  )

  function formatReturnDate(ts) {
    if (!ts) return '-'
    const d = ts.toDate ? ts.toDate() : new Date(ts)
    return format(d, 'dd MMM yyyy')
  }

  function itemsSummary(items) {
    if (!items || items.length === 0) return '-'
    return items
      .slice(0, 2)
      .map(i => `${i.materialName} (${i.qty} ${i.uom})`)
      .join(', ') + (items.length > 2 ? ` +${items.length - 2} more` : '')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-800">Kitchen Returns</h2>
        {!showForm && (
          <button
            onClick={() => { resetForm(); setShowForm(true) }}
            className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            + New Return
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-700">New Return</h3>
            <button
              type="button"
              onClick={() => { setCopyPickerPage(0); setShowCopyModal(true) }}
              className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50"
            >
              Copy from Request
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Return Date</label>
              <input
                type="date"
                value={form.date}
                onChange={e => setForm(prev => ({ ...prev, date: e.target.value }))}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Add Materials</label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search material..."
                  value={materialSearch}
                  onChange={e => { setMaterialSearch(e.target.value); setShowMaterialDropdown(true) }}
                  onFocus={() => setShowMaterialDropdown(true)}
                  onBlur={() => setTimeout(() => setShowMaterialDropdown(false), 150)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
                {showMaterialDropdown && filteredMaterials.length > 0 && (
                  <div className="absolute z-20 bg-white border border-gray-200 rounded-lg shadow-lg mt-1 w-full max-h-48 overflow-y-auto">
                    {filteredMaterials.map(m => (
                      <button
                        key={m.id}
                        type="button"
                        onMouseDown={() => handleAddMaterial(m)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 flex justify-between items-center"
                      >
                        <span>{m.name}</span>
                        <span className="text-xs text-gray-400">{m.uom} · Stock: {m.currentStock}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {form.items.length > 0 && (
              <div className="border border-gray-200 rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium text-gray-600">Material</th>
                      <th className="text-left px-4 py-2 font-medium text-gray-600">UOM</th>
                      <th className="text-left px-4 py-2 font-medium text-gray-600">Qty to Return</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {form.items.map((item, idx) => (
                      <tr key={item.materialId}>
                        <td className="px-4 py-2 text-gray-800">{item.materialName}</td>
                        <td className="px-4 py-2 text-gray-500">{item.uom}</td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            min="0.01"
                            step="any"
                            value={item.qty}
                            onChange={e => handleItemQtyChange(idx, e.target.value)}
                            className="border border-gray-300 rounded px-2 py-1 w-24 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                            required
                          />
                        </td>
                        <td className="px-4 py-2">
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(idx)}
                            className="text-red-400 hover:text-red-600 text-xs"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
                rows={2}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                placeholder="Optional notes..."
              />
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={submitting}
                className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
              >
                {submitting ? 'Saving...' : 'Submit Return'}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); resetForm() }}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {showCopyModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-800">Copy from Issued Request</h3>
              <button onClick={() => setShowCopyModal(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            {issuedRequests.length === 0 ? (
              <p className="text-sm text-gray-500">No issued requests found.</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {issuedRequests.slice(copyPickerPage * 10, copyPickerPage * 10 + 10).map(req => (
                  <button
                    key={req.id}
                    onClick={() => handleCopyFromRequest(req)}
                    className="w-full text-left border border-gray-200 rounded-lg px-4 py-3 hover:bg-amber-50 space-y-1"
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-gray-800">{req.requestedByName}</span>
                      <span className="text-xs text-gray-400">{formatReturnDate(req.date)}</span>
                    </div>
                    <div className="text-xs text-gray-500">{itemsSummary(req.items)}</div>
                    <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 capitalize">{req.status}</span>
                  </button>
                ))}
              </div>
            )}
            {issuedRequests.length > 10 && (
              <div className="flex items-center justify-between pt-2">
                <button disabled={copyPickerPage === 0} onClick={() => setCopyPickerPage(p => p - 1)}
                  className="border border-gray-300 text-gray-600 px-3 py-1 rounded-lg text-xs disabled:opacity-40 hover:bg-gray-50">← Prev</button>
                <span className="text-xs text-gray-500">{copyPickerPage + 1} / {Math.ceil(issuedRequests.length / 10)}</span>
                <button disabled={(copyPickerPage + 1) * 10 >= issuedRequests.length} onClick={() => setCopyPickerPage(p => p + 1)}
                  className="border border-gray-300 text-gray-600 px-3 py-1 rounded-lg text-xs disabled:opacity-40 hover:bg-gray-50">Next →</button>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h3 className="font-semibold text-gray-700">Return History</h3>
        </div>
        {returns.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-gray-400">No returns recorded yet.</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Returned By</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Items</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Summary</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Notes</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {returns.map(ret => (
                <>
                  <tr key={ret.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-700">{formatReturnDate(ret.date)}</td>
                    <td className="px-4 py-3 text-gray-700">{ret.returnedByName}</td>
                    <td className="px-4 py-3 text-gray-500">{ret.items?.length || 0}</td>
                    <td className="px-4 py-3 text-gray-500 max-w-xs truncate">{itemsSummary(ret.items)}</td>
                    <td className="px-4 py-3 text-gray-400 max-w-xs truncate">{ret.notes || '-'}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setExpandedRow(expandedRow === ret.id ? null : ret.id)}
                        className="text-amber-500 hover:text-amber-700 text-xs font-medium"
                      >
                        {expandedRow === ret.id ? 'Hide' : 'Details'}
                      </button>
                    </td>
                  </tr>
                  {expandedRow === ret.id && (
                    <tr key={ret.id + '-exp'}>
                      <td colSpan={6} className="px-6 pb-4 bg-amber-50/40">
                        <div className="pt-2">
                          <div className="border border-gray-200 rounded-lg overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-white">
                              <tr>
                                <th className="text-left px-4 py-2 font-medium text-gray-600">#</th>
                                <th className="text-left px-4 py-2 font-medium text-gray-600">Material</th>
                                <th className="text-left px-4 py-2 font-medium text-gray-600">UOM</th>
                                <th className="text-left px-4 py-2 font-medium text-gray-600">Qty Returned</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {(ret.items || []).map((item, i) => (
                                <tr key={i} className="bg-white">
                                  <td className="px-4 py-2 text-gray-400">{i + 1}</td>
                                  <td className="px-4 py-2 text-gray-800">{item.materialName}</td>
                                  <td className="px-4 py-2 text-gray-500">{item.uom}</td>
                                  <td className="px-4 py-2 text-gray-700 font-medium">{item.qty}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          </div>
                        </div>
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
  )
}
