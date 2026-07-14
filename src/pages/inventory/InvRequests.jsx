import { useState, useEffect, useRef } from 'react'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import toast from 'react-hot-toast'
import {
  collection, addDoc, getDocs, doc, updateDoc, deleteDoc,
  writeBatch, query, where, orderBy, Timestamp, increment
} from 'firebase/firestore'
import { format } from 'date-fns'

const STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-800',
  issued:  'bg-green-100 text-green-800',
  partial: 'bg-blue-100 text-blue-800',
}

const ISSUE_ROLES = ['admin', 'manager', 'kitchen_manager']

export default function InvRequests() {
  const { user, profile } = useAuth()
  const canIssue = ISSUE_ROLES.includes(profile?.role)

  const [activeTab, setActiveTab] = useState('new')
  const [materials, setMaterials] = useState([])
  const [requests, setRequests] = useState([])
  const [templates, setTemplates] = useState([])

  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [showSearchDropdown, setShowSearchDropdown] = useState(false)
  const searchRef = useRef(null)

  const [formItems, setFormItems] = useState([])
  const [formNotes, setFormNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [templatePickerPage, setTemplatePickerPage] = useState(0)
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [savingTemplate, setSavingTemplate] = useState(false)

  const [filterStatus, setFilterStatus] = useState('all')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')

  const [issueRequest, setIssueRequest] = useState(null)
  const [issueQtys, setIssueQtys] = useState({})
  const [issuing, setIssuing] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    fetchMaterials()
    fetchRequests()
    fetchTemplates()
  }, [])

  useEffect(() => {
    const handleClick = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowSearchDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function fetchMaterials() {
    const snap = await getDocs(query(collection(db, 'invMaterials'), orderBy('name')))
    setMaterials(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  async function fetchRequests() {
    const snap = await getDocs(query(collection(db, 'invRequests'), orderBy('date', 'desc')))
    setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  async function fetchTemplates() {
    const snap = await getDocs(query(collection(db, 'invTemplates'), where('type', '==', 'kitchen')))
    setTemplates(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  }

  function handleSearchChange(val) {
    setSearchTerm(val)
    if (!val.trim()) { setSearchResults([]); setShowSearchDropdown(false); return }
    const lower = val.toLowerCase()
    const results = materials.filter(m =>
      m.name.toLowerCase().includes(lower) && !formItems.find(fi => fi.materialId === m.id)
    )
    setSearchResults(results)
    setShowSearchDropdown(true)
  }

  function addMaterialToForm(mat) {
    setFormItems(prev => [...prev, {
      materialId: mat.id,
      materialName: mat.name,
      uom: mat.uom,
      currentStock: mat.currentStock ?? 0,
      requestedQty: '',
    }])
    setSearchTerm('')
    setSearchResults([])
    setShowSearchDropdown(false)
  }

  function loadTemplate(tpl) {
    const newItems = tpl.items.map(ti => {
      const mat = materials.find(m => m.id === ti.materialId)
      return {
        materialId: ti.materialId,
        materialName: ti.materialName,
        uom: ti.uom,
        currentStock: mat?.currentStock ?? 0,
        requestedQty: String(ti.qty),
      }
    })
    setFormItems(newItems)
    setShowTemplateModal(false)
    toast.success(`Template "${tpl.name}" loaded`)
  }

  async function handleSaveTemplate() {
    if (!templateName.trim()) { toast.error('Enter a template name'); return }
    if (formItems.length === 0) { toast.error('Add items first'); return }
    setSavingTemplate(true)
    try {
      await addDoc(collection(db, 'invTemplates'), {
        type: 'kitchen',
        name: templateName.trim(),
        items: formItems.map(fi => ({
          materialId: fi.materialId,
          materialName: fi.materialName,
          uom: fi.uom,
          qty: parseFloat(fi.requestedQty) || 0,
        })),
        createdBy: profile?.id || '',
        createdByName: profile?.name || profile?.email || '',
      })
      toast.success('Template saved')
      setTemplateName('')
      setShowSaveTemplateModal(false)
      fetchTemplates()
    } catch {
      toast.error('Failed to save template')
    } finally {
      setSavingTemplate(false)
    }
  }

  async function handleSubmitRequest() {
    if (formItems.length === 0) { toast.error('Add at least one item'); return }
    const invalid = formItems.find(fi => !fi.requestedQty || parseFloat(fi.requestedQty) <= 0)
    if (invalid) { toast.error(`Enter quantity for ${invalid.materialName}`); return }
    setSubmitting(true)
    try {
      await addDoc(collection(db, 'invRequests'), {
        date: Timestamp.now(),
        requestedBy: profile?.id || '',
        requestedByName: profile?.name || profile?.email || '',
        status: 'pending',
        items: formItems.map(fi => ({
          materialId: fi.materialId,
          materialName: fi.materialName,
          uom: fi.uom,
          requestedQty: parseFloat(fi.requestedQty),
          issuedQty: 0,
        })),
        notes: formNotes.trim(),
      })
      toast.success('Request submitted')
      setFormItems([])
      setFormNotes('')
      fetchRequests()
      setActiveTab('history')
    } catch {
      toast.error('Failed to submit request')
    } finally {
      setSubmitting(false)
    }
  }

  function openIssueModal(req) {
    const qtys = {}
    req.items.forEach((item, idx) => {
      qtys[idx] = String(item.requestedQty - (item.issuedQty || 0))
    })
    setIssueQtys(qtys)
    setIssueRequest(req)
  }

  async function handleIssue() {
    if (!issueRequest) return
    setIssuing(true)
    try {
      const batch = writeBatch(db)
      const updatedItems = issueRequest.items.map((item, idx) => {
        const qty = parseFloat(issueQtys[idx]) || 0
        return { ...item, issuedQty: (item.issuedQty || 0) + qty }
      })
      const allFulfilled = updatedItems.every(i => i.issuedQty >= i.requestedQty)
      const anyIssued = updatedItems.some(i => i.issuedQty > 0)
      const newStatus = allFulfilled ? 'issued' : anyIssued ? 'partial' : 'pending'
      batch.update(doc(db, 'invRequests', issueRequest.id), { items: updatedItems, status: newStatus })
      for (let idx = 0; idx < issueRequest.items.length; idx++) {
        const item = issueRequest.items[idx]
        const qty = parseFloat(issueQtys[idx]) || 0
        if (qty <= 0) continue
        batch.update(doc(db, 'invMaterials', item.materialId), { currentStock: increment(-qty) })
        batch.set(doc(collection(db, 'invLedger')), {
          materialId: item.materialId,
          materialName: item.materialName,
          uom: item.uom,
          date: Timestamp.now(),
          txType: 'issue',
          qty: -qty,
          refId: issueRequest.id,
          refType: 'invRequests',
          note: `Issued to ${issueRequest.requestedByName}`,
          recordedBy: user?.uid || '', recordedByName: profile?.name || user?.email || '',
        })
      }
      await batch.commit()
      toast.success('Items issued successfully')
      setIssueRequest(null)
      fetchRequests()
      fetchMaterials()
    } catch {
      toast.error('Failed to issue items')
    } finally {
      setIssuing(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteDoc(doc(db, 'invRequests', deleteTarget.id))
      toast.success('Request deleted')
      setDeleteTarget(null)
      fetchRequests()
    } catch {
      toast.error('Failed to delete request')
    } finally {
      setDeleting(false)
    }
  }

  const pendingRequests = requests.filter(r => r.status === 'pending' || r.status === 'partial')

  const filteredHistory = requests.filter(r => {
    if (filterStatus !== 'all' && r.status !== filterStatus) return false
    if (filterFrom && r.date.toDate() < new Date(filterFrom)) return false
    if (filterTo) {
      const to = new Date(filterTo); to.setHours(23, 59, 59)
      if (r.date.toDate() > to) return false
    }
    return true
  })

  return (
    <div className="w-full p-4 space-y-4">
      <h1 className="text-2xl font-bold text-gray-800">Material Requests</h1>

      <div className="flex gap-2 border-b border-gray-200">
        {['new', canIssue && 'issue', 'history'].filter(Boolean).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
              activeTab === tab ? 'border-amber-500 text-amber-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {tab === 'new' ? 'New Request' : tab === 'issue'
              ? `Issue Items${pendingRequests.length ? ` (${pendingRequests.length})` : ''}` : 'History'}
          </button>
        ))}
      </div>

      {activeTab === 'new' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-800">New Material Request</h2>
            <button onClick={() => { setTemplatePickerPage(0); setShowTemplateModal(true) }}
              className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">
              Use Template
            </button>
          </div>

          <div ref={searchRef} className="relative">
            <input type="text" placeholder="Search and add material..."
              value={searchTerm}
              onChange={e => handleSearchChange(e.target.value)}
              onFocus={() => searchTerm && setShowSearchDropdown(true)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            {showSearchDropdown && searchResults.length > 0 && (
              <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-56 overflow-y-auto">
                {searchResults.map(mat => (
                  <button key={mat.id} onMouseDown={() => addMaterialToForm(mat)}
                    className="w-full text-left px-4 py-2 hover:bg-amber-50 text-sm flex justify-between items-center">
                    <span className="font-medium text-gray-800">{mat.name}</span>
                    <span className="text-gray-500 text-xs">{mat.uom} · Stock: {mat.currentStock ?? 0}</span>
                  </button>
                ))}
              </div>
            )}
            {showSearchDropdown && searchResults.length === 0 && searchTerm && (
              <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 px-4 py-3 text-sm text-gray-500">No materials found</div>
            )}
          </div>

          {formItems.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase border-b">
                    <th className="pb-2 pr-4">Material</th>
                    <th className="pb-2 pr-4">UOM</th>
                    <th className="pb-2 pr-4">In Stock</th>
                    <th className="pb-2 pr-4">Requested Qty</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {formItems.map((item, idx) => (
                    <tr key={idx}>
                      <td className="py-2 pr-4 font-medium text-gray-800">{item.materialName}</td>
                      <td className="py-2 pr-4 text-gray-500">{item.uom}</td>
                      <td className="py-2 pr-4">
                        <span className={`font-medium ${item.currentStock <= 0 ? 'text-red-600' : 'text-gray-700'}`}>{item.currentStock}</span>
                      </td>
                      <td className="py-2 pr-4">
                        <input type="number" min="0" step="0.01" value={item.requestedQty}
                          onChange={e => setFormItems(prev => prev.map((it, i) => i === idx ? { ...it, requestedQty: e.target.value } : it))}
                          className="w-24 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                      </td>
                      <td className="py-2">
                        <button onClick={() => setFormItems(prev => prev.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
            <textarea rows={2} value={formNotes} onChange={e => setFormNotes(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              placeholder="Any special instructions..." />
          </div>

          <div className="flex gap-3 justify-end">
            {formItems.length > 0 && (
              <button onClick={() => setShowSaveTemplateModal(true)}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">
                Save as Template
              </button>
            )}
            <button onClick={handleSubmitRequest} disabled={submitting || formItems.length === 0}
              className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              {submitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </div>
        </div>
      )}

      {activeTab === 'issue' && canIssue && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-800">Pending Requests</h2>
          {pendingRequests.length === 0 ? (
            <p className="text-gray-500 text-sm py-4 text-center">No pending requests</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {pendingRequests.map(req => (
                <div key={req.id} className="py-4 flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-800">{req.requestedByName}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[req.status]}`}>{req.status}</span>
                    </div>
                    <div className="text-xs text-gray-500">
                      {format(req.date.toDate(), 'dd MMM yyyy, hh:mm a')} · {req.items.length} item{req.items.length !== 1 ? 's' : ''}
                    </div>
                    {req.notes && <div className="text-xs text-gray-400">{req.notes}</div>}
                  </div>
                  <button onClick={() => openIssueModal(req)}
                    className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
                    Issue
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Status</label>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                <option value="all">All</option>
                <option value="pending">Pending</option>
                <option value="partial">Partial</option>
                <option value="issued">Issued</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">From</label>
              <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">To</label>
              <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <button onClick={() => { setFilterStatus('all'); setFilterFrom(''); setFilterTo('') }}
              className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">
              Clear
            </button>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            {filteredHistory.length === 0 ? (
              <p className="text-gray-500 text-sm py-8 text-center">No requests found</p>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-500 text-xs uppercase">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Requested By</th>
                    <th className="px-4 py-3">Items</th>
                    <th className="px-4 py-3">Notes</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredHistory.map(req => (
                    <tr key={req.id} className="hover:bg-amber-50">
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{format(req.date.toDate(), 'dd MMM yyyy')}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">{req.requestedByName}</td>
                      <td className="px-4 py-3 text-gray-600">
                        <div className="space-y-0.5">
                          {req.items.map((it, i) => (
                            <div key={i} className="text-xs">
                              {it.materialName} — {it.requestedQty} {it.uom}
                              {it.issuedQty > 0 && ` (issued: ${it.issuedQty})`}
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate">{req.notes || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLORS[req.status]}`}>{req.status}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          {canIssue && (req.status === 'pending' || req.status === 'partial') && (
                            <button onClick={() => openIssueModal(req)}
                              className="text-xs border border-amber-400 text-amber-600 hover:bg-amber-50 px-2 py-1 rounded">
                              Issue
                            </button>
                          )}
                          <button onClick={() => setDeleteTarget(req)}
                            className="text-xs border border-red-300 text-red-500 hover:bg-red-50 px-2 py-1 rounded">
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        </div>
      )}

      {showTemplateModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-800">Select Template</h3>
              <button onClick={() => setShowTemplateModal(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            {templates.length === 0 ? (
              <p className="text-gray-500 text-sm py-4 text-center">No kitchen templates saved yet</p>
            ) : (
              <>
                <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
                  {templates.slice(templatePickerPage * 10, templatePickerPage * 10 + 10).map(tpl => (
                    <button key={tpl.id} onClick={() => loadTemplate(tpl)}
                      className="w-full text-left px-3 py-3 hover:bg-amber-50 rounded space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="font-medium text-gray-800">{tpl.name}</div>
                        <span className="text-xs text-amber-600 font-medium bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">{tpl.items.length} item{tpl.items.length !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="space-y-0.5">
                        {tpl.items.map((item, i) => (
                          <div key={i} className="flex items-center justify-between text-xs text-gray-600">
                            <span>{item.materialName}</span>
                            <span className="text-gray-400">{item.qty} {item.uom}</span>
                          </div>
                        ))}
                      </div>
                      <div className="text-xs text-gray-400">by {tpl.createdByName}</div>
                    </button>
                  ))}
                </div>
                {templates.length > 10 && (
                  <div className="flex items-center justify-between pt-2">
                    <button disabled={templatePickerPage === 0} onClick={() => setTemplatePickerPage(p => p - 1)}
                      className="border border-gray-300 text-gray-600 px-3 py-1 rounded-lg text-xs disabled:opacity-40 hover:bg-gray-50">← Prev</button>
                    <span className="text-xs text-gray-500">{templatePickerPage + 1} / {Math.ceil(templates.length / 10)}</span>
                    <button disabled={(templatePickerPage + 1) * 10 >= templates.length} onClick={() => setTemplatePickerPage(p => p + 1)}
                      className="border border-gray-300 text-gray-600 px-3 py-1 rounded-lg text-xs disabled:opacity-40 hover:bg-gray-50">Next →</button>
                  </div>
                )}
              </>
            )}
            <div className="flex justify-end">
              <button onClick={() => setShowTemplateModal(false)}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showSaveTemplateModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-800">Save as Template</h3>
              <button onClick={() => setShowSaveTemplateModal(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Template Name</label>
              <input type="text" value={templateName} onChange={e => setTemplateName(e.target.value)}
                placeholder="e.g. Morning Prep"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowSaveTemplateModal(false)}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
              <button onClick={handleSaveTemplate} disabled={savingTemplate}
                className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                {savingTemplate ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {issueRequest && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-800">Issue Items</h3>
                <p className="text-sm text-gray-500">Request by {issueRequest.requestedByName} · {format(issueRequest.date.toDate(), 'dd MMM yyyy, hh:mm a')}</p>
              </div>
              <button onClick={() => setIssueRequest(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase border-b">
                    <th className="pb-2 pr-4">Material</th>
                    <th className="pb-2 pr-4">UOM</th>
                    <th className="pb-2 pr-4">Requested</th>
                    <th className="pb-2 pr-4">Already Issued</th>
                    <th className="pb-2 pr-4">Issue Now</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {issueRequest.items.map((item, idx) => {
                    const remaining = item.requestedQty - (item.issuedQty || 0)
                    return (
                      <tr key={idx}>
                        <td className="py-2 pr-4 font-medium text-gray-800">{item.materialName}</td>
                        <td className="py-2 pr-4 text-gray-500">{item.uom}</td>
                        <td className="py-2 pr-4 text-gray-700">{item.requestedQty}</td>
                        <td className="py-2 pr-4 text-gray-500">{item.issuedQty || 0}</td>
                        <td className="py-2 pr-4">
                          {remaining <= 0 ? (
                            <span className="text-green-600 text-xs font-medium">Fulfilled</span>
                          ) : (
                            <input type="number" min="0" max={remaining} step="0.01"
                              value={issueQtys[idx] ?? ''}
                              onChange={e => setIssueQtys(prev => ({ ...prev, [idx]: e.target.value }))}
                              className="w-24 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {issueRequest.notes && <p className="text-sm text-gray-500 border-t pt-2">Notes: {issueRequest.notes}</p>}
            <div className="flex gap-3 justify-end">
              <button onClick={() => setIssueRequest(null)}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
              <button onClick={handleIssue} disabled={issuing}
                className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                {issuing ? 'Issuing...' : 'Confirm Issue'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <h3 className="text-lg font-semibold text-gray-800">Delete Request</h3>
            <p className="text-sm text-gray-600">
              Delete request by <span className="font-semibold">{deleteTarget.requestedByName}</span> on {format(deleteTarget.date.toDate(), 'dd MMM yyyy')}? This cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteTarget(null)}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
              <button onClick={handleDelete} disabled={deleting}
                className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60">
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
