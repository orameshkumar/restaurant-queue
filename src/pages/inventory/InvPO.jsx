import { useState, useEffect } from 'react'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import toast from 'react-hot-toast'
import {
  collection, addDoc, getDocs, getDoc, doc, updateDoc,
  writeBatch, query, where, orderBy, Timestamp, increment
} from 'firebase/firestore'
import { format } from 'date-fns'

const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  received: 'bg-green-100 text-green-700',
  partial: 'bg-amber-100 text-amber-700',
}

export default function InvPO() {
  const { user, profile } = useAuth()
  const [activeTab, setActiveTab] = useState('generate')
  const [materials, setMaterials] = useState([])
  const [vendors, setVendors] = useState([])
  const [templates, setTemplates] = useState([])
  const [pos, setPOs] = useState([])
  const [loading, setLoading] = useState(false)

  const [poItems, setPOItems] = useState([])
  const [selectedVendorId, setSelectedVendorId] = useState('')
  const [poNotes, setPONotes] = useState('')
  const [matSearch, setMatSearch] = useState('')
  const [matSearchResults, setMatSearchResults] = useState([])
  const [autoSuggestCount, setAutoSuggestCount] = useState(0)
  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [savingTemplate, setSavingTemplate] = useState(false)

  const [statusFilter, setStatusFilter] = useState('all')
  const [viewPO, setViewPO] = useState(null)

  const [receiptPOId, setReceiptPOId] = useState('')
  const [receiptPO, setReceiptPO] = useState(null)
  const [receiptItems, setReceiptItems] = useState([])
  const [receiptNotes, setReceiptNotes] = useState('')
  const [adhocItems, setAdhocItems] = useState([])
  const [adhocSearch, setAdhocSearch] = useState('')
  const [adhocResults, setAdhocResults] = useState([])
  const [isAdhoc, setIsAdhoc] = useState(false)
  const [savingReceipt, setSavingReceipt] = useState(false)

  const sentPartialPOs = pos.filter(p => p.status === 'sent' || p.status === 'partial')

  useEffect(() => {
    fetchAll()
  }, [])

  async function fetchAll() {
    setLoading(true)
    try {
      const [mSnap, vSnap, tSnap, pSnap] = await Promise.all([
        getDocs(query(collection(db, 'invMaterials'), orderBy('name'))),
        getDocs(query(collection(db, 'invVendors'), orderBy('name'))),
        getDocs(query(collection(db, 'invTemplates'), where('type', '==', 'po'))),
        getDocs(query(collection(db, 'invPOs'), orderBy('date', 'desc'))),
      ])
      const mats = mSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      setMaterials(mats)
      setAutoSuggestCount(mats.filter(m => m.currentStock <= m.reorderLevel).length)
      setVendors(vSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setTemplates(tSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setPOs(pSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch {
      toast.error('Failed to load data')
    }
    setLoading(false)
  }

  function handleAutoSuggest() {
    const suggested = materials
      .filter(m => m.currentStock <= m.reorderLevel)
      .map(m => ({
        materialId: m.id,
        materialName: m.name,
        uom: m.uom,
        orderedQty: m.reorderQty || 0,
        receivedQty: 0,
      }))
    if (!suggested.length) { toast('No materials below reorder level'); return }
    setPOItems(prev => {
      const existing = new Set(prev.map(i => i.materialId))
      return [...prev, ...suggested.filter(s => !existing.has(s.materialId))]
    })
    toast.success(`Added ${suggested.length} suggested items`)
  }

  useEffect(() => {
    if (!matSearch.trim()) { setMatSearchResults([]); return }
    const q = matSearch.toLowerCase()
    setMatSearchResults(materials.filter(m => m.name.toLowerCase().includes(q)).slice(0, 8))
  }, [matSearch, materials])

  function addMaterialToItems(mat) {
    if (poItems.find(i => i.materialId === mat.id)) { toast('Already in list'); return }
    setPOItems(prev => [...prev, { materialId: mat.id, materialName: mat.name, uom: mat.uom, orderedQty: 1, receivedQty: 0 }])
    setMatSearch('')
    setMatSearchResults([])
  }

  function updateItemQty(idx, val) {
    setPOItems(prev => prev.map((it, i) => i === idx ? { ...it, orderedQty: Number(val) } : it))
  }

  function removeItem(idx) {
    setPOItems(prev => prev.filter((_, i) => i !== idx))
  }

  function loadTemplate(tpl) {
    setPOItems(tpl.items.map(it => ({ ...it, receivedQty: 0 })))
    toast.success(`Loaded template: ${tpl.name}`)
  }

  async function handleSaveTemplate() {
    if (!templateName.trim()) { toast.error('Enter a template name'); return }
    if (!poItems.length) { toast.error('No items to save'); return }
    setSavingTemplate(true)
    try {
      await addDoc(collection(db, 'invTemplates'), {
        type: 'po',
        name: templateName.trim(),
        items: poItems.map(({ materialId, materialName, uom, orderedQty }) => ({ materialId, materialName, uom, qty: orderedQty })),
        createdBy: user.uid,
        createdByName: profile?.name || user?.email || '',
      })
      toast.success('Template saved')
      setTemplateName('')
      setShowTemplateModal(false)
      fetchAll()
    } catch {
      toast.error('Failed to save template')
    }
    setSavingTemplate(false)
  }

  async function createPO(status) {
    if (!selectedVendorId) { toast.error('Select a vendor'); return }
    if (!poItems.length) { toast.error('Add at least one item'); return }
    const vendor = vendors.find(v => v.id === selectedVendorId)
    try {
      const ref = await addDoc(collection(db, 'invPOs'), {
        date: Timestamp.now(),
        vendorId: vendor.id,
        vendorName: vendor.name,
        vendorPhone: vendor.phone || '',
        vendorWhatsapp: vendor.whatsapp || vendor.phone || '',
        status,
        items: poItems,
        notes: poNotes,
      })
      toast.success(`PO ${status === 'draft' ? 'saved as draft' : 'created'}`)
      setPOItems([])
      setSelectedVendorId('')
      setPONotes('')
      fetchAll()
      if (status === 'sent') {
        const newPO = { id: ref.id, date: Timestamp.now(), vendorName: vendor.name, vendorWhatsapp: vendor.whatsapp || vendor.phone || '', items: poItems, notes: poNotes, status: 'sent' }
        return newPO
      }
    } catch {
      toast.error('Failed to create PO')
    }
    return null
  }

  async function handleSaveDraft() {
    await createPO('draft')
  }

  async function handleSendPO(action) {
    const newPO = await createPO('sent')
    if (!newPO) return
    if (action === 'whatsapp') sendWhatsapp(newPO)
    else if (action === 'print' || action === 'pdf') printPO(newPO)
  }

  function sendWhatsapp(po) {
    const vendor = vendors.find(v => v.id === selectedVendorId) || { whatsapp: po.vendorWhatsapp }
    const phone = (vendor.whatsapp || vendor.phone || '').replace(/\D/g, '')
    const shortId = po.id.slice(-6).toUpperCase()
    const dateStr = format(po.date instanceof Timestamp ? po.date.toDate() : new Date(), 'dd MMM yyyy')
    const itemLines = po.items.map(it => `• ${it.materialName}: ${it.orderedQty} ${it.uom}`).join('\n')
    const msg = `*Purchase Order - RestQueue*\nDate: ${dateStr}\nPO#: ${shortId}\n\nItems:\n${itemLines}\n\nTotal Items: ${po.items.length}\nPlease confirm receipt.`
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
    window.open(url, '_blank')
  }

  function printPO(po) {
    const shortId = po.id.slice(-6).toUpperCase()
    const dateStr = format(po.date instanceof Timestamp ? po.date.toDate() : new Date(), 'dd MMM yyyy')
    const rows = po.items.map(it => `<tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb">${it.materialName}</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:center">${it.uom}</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;text-align:right">${it.orderedQty}</td></tr>`).join('')
    const div = document.createElement('div')
    div.id = 'po-print-area'
    div.style.display = 'none'
    div.innerHTML = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px"><h2 style="font-size:20px;font-weight:700;margin-bottom:4px">Purchase Order</h2><p style="color:#6b7280;margin-bottom:16px">RestQueue</p><div style="display:flex;justify-content:space-between;margin-bottom:16px"><div><strong>Vendor:</strong> ${po.vendorName}</div><div><strong>Date:</strong> ${dateStr}</div><div><strong>PO#:</strong> ${shortId}</div></div><table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb"><thead><tr style="background:#f9fafb"><th style="padding:8px 12px;text-align:left;border-bottom:1px solid #e5e7eb">Material</th><th style="padding:8px 12px;text-align:center;border-bottom:1px solid #e5e7eb">UOM</th><th style="padding:8px 12px;text-align:right;border-bottom:1px solid #e5e7eb">Qty</th></tr></thead><tbody>${rows}</tbody></table>${po.notes ? `<p style="margin-top:16px"><strong>Notes:</strong> ${po.notes}</p>` : ''}<p style="margin-top:24px;font-size:12px;color:#6b7280">Generated by RestQueue Inventory</p></div>`
    document.body.appendChild(div)
    const style = document.createElement('style')
    style.textContent = '@media print { body > * { display: none !important; } #po-print-area { display: block !important; } }'
    document.head.appendChild(style)
    window.print()
    setTimeout(() => {
      document.head.removeChild(style)
      document.body.removeChild(div)
    }, 1000)
  }

  async function handleSelectReceiptPO(poId) {
    setReceiptPOId(poId)
    if (!poId) { setReceiptPO(null); setReceiptItems([]); return }
    const snap = await getDoc(doc(db, 'invPOs', poId))
    if (!snap.exists()) return
    const data = { id: snap.id, ...snap.data() }
    setReceiptPO(data)
    setReceiptItems(data.items.map(it => ({ ...it, newQty: '' })))
  }

  useEffect(() => {
    if (!adhocSearch.trim()) { setAdhocResults([]); return }
    const q = adhocSearch.toLowerCase()
    setAdhocResults(materials.filter(m => m.name.toLowerCase().includes(q)).slice(0, 8))
  }, [adhocSearch, materials])

  function addAdhocItem(mat) {
    if (adhocItems.find(i => i.materialId === mat.id)) { toast('Already added'); return }
    setAdhocItems(prev => [...prev, { materialId: mat.id, materialName: mat.name, uom: mat.uom, qty: 1 }])
    setAdhocSearch('')
    setAdhocResults([])
  }

  function updateAdhocQty(idx, val) {
    setAdhocItems(prev => prev.map((it, i) => i === idx ? { ...it, qty: Number(val) } : it))
  }

  function removeAdhocItem(idx) {
    setAdhocItems(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleSaveReceipt() {
    if (isAdhoc) {
      if (!adhocItems.length) { toast.error('Add items'); return }
      setSavingReceipt(true)
      try {
        const batch = writeBatch(db)
        const receiptItems2 = adhocItems.map(it => ({ materialId: it.materialId, materialName: it.materialName, uom: it.uom, qty: it.qty }))
        const receiptRef = doc(collection(db, 'invReceipts'))
        batch.set(receiptRef, {
          date: Timestamp.now(),
          poId: null,
          receivedBy: user.uid,
          receivedByName: profile?.name || user?.email || '',
          items: receiptItems2,
          notes: receiptNotes,
        })
        receiptItems2.forEach(it => {
          batch.update(doc(db, 'invMaterials', it.materialId), { currentStock: increment(it.qty) })
          const ledgerRef = doc(collection(db, 'invLedger'))
          batch.set(ledgerRef, {
            materialId: it.materialId, materialName: it.materialName, uom: it.uom,
            date: Timestamp.now(), txType: 'receive', qty: it.qty,
            refId: receiptRef.id, refType: 'receipt', note: receiptNotes || '',
            recordedBy: user.uid, recordedByName: profile?.name || user?.email || '',
          })
        })
        await batch.commit()
        toast.success('Stock received')
        setAdhocItems([])
        setReceiptNotes('')
        fetchAll()
      } catch {
        toast.error('Failed to save receipt')
      }
      setSavingReceipt(false)
      return
    }

    if (!receiptPO) { toast.error('Select a PO'); return }
    const toReceive = receiptItems.filter(it => it.newQty !== '' && Number(it.newQty) > 0)
    if (!toReceive.length) { toast.error('Enter quantities to receive'); return }
    setSavingReceipt(true)
    try {
      const batch = writeBatch(db)
      const receiptRef = doc(collection(db, 'invReceipts'))
      const receiptItemsData = toReceive.map(it => ({
        materialId: it.materialId, materialName: it.materialName, uom: it.uom, qty: Number(it.newQty),
      }))
      batch.set(receiptRef, {
        date: Timestamp.now(),
        poId: receiptPO.id,
        receivedBy: user.uid,
        receivedByName: profile?.name || user?.email || '',
        items: receiptItemsData,
        notes: receiptNotes,
      })
      const updatedItems = receiptPO.items.map(it => {
        const match = toReceive.find(r => r.materialId === it.materialId)
        return match ? { ...it, receivedQty: (it.receivedQty || 0) + Number(match.newQty) } : it
      })
      const allReceived = updatedItems.every(it => (it.receivedQty || 0) >= it.orderedQty)
      const anyReceived = updatedItems.some(it => (it.receivedQty || 0) > 0)
      const newStatus = allReceived ? 'received' : anyReceived ? 'partial' : receiptPO.status
      batch.update(doc(db, 'invPOs', receiptPO.id), { items: updatedItems, status: newStatus })
      receiptItemsData.forEach(it => {
        batch.update(doc(db, 'invMaterials', it.materialId), { currentStock: increment(it.qty) })
        const ledgerRef = doc(collection(db, 'invLedger'))
        batch.set(ledgerRef, {
          materialId: it.materialId, materialName: it.materialName, uom: it.uom,
          date: Timestamp.now(), txType: 'receive', qty: it.qty,
          refId: receiptRef.id, refType: 'receipt', note: receiptNotes || '',
          recordedBy: user.uid, recordedByName: profile?.name || user?.email || '',
        })
      })
      await batch.commit()
      toast.success('Stock received successfully')
      setReceiptPOId('')
      setReceiptPO(null)
      setReceiptItems([])
      setReceiptNotes('')
      fetchAll()
    } catch {
      toast.error('Failed to save receipt')
    }
    setSavingReceipt(false)
  }

  const filteredPOs = statusFilter === 'all' ? pos : pos.filter(p => p.status === statusFilter)

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>

  return (
    <div className="w-full space-y-4">
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {[['generate', 'Generate PO'], ['list', 'PO List'], ['receive', 'Receive Stock']].map(([key, label]) => (
          <button key={key} onClick={() => setActiveTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === key ? 'bg-white shadow text-amber-600' : 'text-gray-600 hover:text-gray-900'}`}>
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'generate' && (
        <div className="bg-white rounded-xl shadow-sm border p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-800">New Purchase Order</h2>
            <button onClick={handleAutoSuggest}
              className="relative bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
              Auto-suggest
              {autoSuggestCount > 0 && (
                <span className="bg-white text-amber-600 rounded-full text-xs font-bold w-5 h-5 flex items-center justify-center">{autoSuggestCount}</span>
              )}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vendor</label>
              <select value={selectedVendorId} onChange={e => setSelectedVendorId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                <option value="">Select vendor...</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Load Template</label>
              <select onChange={e => { const t = templates.find(t => t.id === e.target.value); if (t) loadTemplate(t); e.target.value = '' }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                <option value="">Pick a template...</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Search & Add Material</label>
            <div className="relative">
              <input value={matSearch} onChange={e => setMatSearch(e.target.value)} placeholder="Type material name..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              {matSearchResults.length > 0 && (
                <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                  {matSearchResults.map(m => (
                    <button key={m.id} onClick={() => addMaterialToItems(m)}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-amber-50 flex justify-between">
                      <span>{m.name}</span>
                      <span className="text-gray-400">{m.uom}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {poItems.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">Items ({poItems.length})</span>
                <button onClick={() => setShowTemplateModal(true)}
                  className="border border-gray-300 text-gray-700 px-3 py-1 rounded-lg text-xs font-medium hover:bg-gray-50">
                  Save as Template
                </button>
              </div>
              <div className="rounded-lg border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium text-gray-600 whitespace-nowrap">Material</th>
                      <th className="text-center px-4 py-2 font-medium text-gray-600 whitespace-nowrap">UOM</th>
                      <th className="text-center px-4 py-2 font-medium text-gray-600 whitespace-nowrap">Qty</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {poItems.map((it, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-4 py-2 whitespace-nowrap">{it.materialName}</td>
                        <td className="px-4 py-2 text-center text-gray-500 whitespace-nowrap">{it.uom}</td>
                        <td className="px-4 py-2 text-center">
                          <input type="number" min="0" value={it.orderedQty} onChange={e => updateItemQty(idx, e.target.value)}
                            className="w-20 border border-gray-300 rounded px-2 py-1 text-center text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button onClick={() => removeItem(idx)} className="border border-red-300 text-red-500 hover:bg-red-50 px-2 py-1 rounded text-xs font-medium">🗑 Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea value={poNotes} onChange={e => setPONotes(e.target.value)} rows={2} placeholder="Optional notes..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>

          <div className="flex flex-wrap gap-3">
            <button onClick={handleSaveDraft}
              className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">
              Save as Draft
            </button>
            <button onClick={() => handleSendPO('whatsapp')}
              className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
              Send via WhatsApp
            </button>
            <button onClick={() => handleSendPO('print')}
              className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
              Send & Print / PDF
            </button>
          </div>
        </div>
      )}

      {showTemplateModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm space-y-4">
            <h3 className="text-lg font-semibold text-gray-800">Save as Template</h3>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Template Name</label>
              <input value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="e.g. Weekly Dry Goods"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setShowTemplateModal(false); setTemplateName('') }}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleSaveTemplate} disabled={savingTemplate}
                className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                {savingTemplate ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'list' && (
        <div className="bg-white rounded-xl shadow-sm border p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-800">Purchase Orders</h2>
            <span className="text-sm text-gray-500">{filteredPOs.length} POs</span>
          </div>

          <div className="flex flex-wrap gap-2">
            {['all', 'draft', 'sent', 'partial', 'received'].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-3 py-1 rounded-full text-xs font-medium capitalize transition-colors ${statusFilter === s ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {s}
              </button>
            ))}
          </div>

          {filteredPOs.length === 0 ? (
            <div className="text-center py-12 text-gray-400">No purchase orders found</div>
          ) : (
            <div className="rounded-lg border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Vendor</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">Items</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">Status</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredPOs.map(po => (
                    <tr key={po.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-600">
                        {po.date instanceof Timestamp ? format(po.date.toDate(), 'dd MMM yyyy') : '—'}
                      </td>
                      <td className="px-4 py-3 font-medium">{po.vendorName}</td>
                      <td className="px-4 py-3 text-center text-gray-500">{po.items?.length || 0}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[po.status] || 'bg-gray-100 text-gray-700'}`}>
                          {po.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => setViewPO(po)}
                          className="text-amber-600 hover:text-amber-700 text-xs font-medium">View</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {viewPO && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-800">PO Details</h3>
              <button onClick={() => setViewPO(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <div><span className="text-gray-500">Date:</span> <span className="font-medium">{viewPO.date instanceof Timestamp ? format(viewPO.date.toDate(), 'dd MMM yyyy') : '—'}</span></div>
              <div><span className="text-gray-500">Vendor:</span> <span className="font-medium">{viewPO.vendorName}</span></div>
              <div><span className="text-gray-500">Status:</span> <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[viewPO.status]}`}>{viewPO.status}</span></div>
              <div><span className="text-gray-500">PO#:</span> <span className="font-medium">{viewPO.id.slice(-6).toUpperCase()}</span></div>
              {viewPO.vendorPhone && <div><span className="text-gray-500">Phone:</span> <span className="font-medium">{viewPO.vendorPhone}</span></div>}
            </div>
            <div className="rounded-lg border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-gray-600">Material</th>
                    <th className="text-center px-4 py-2 font-medium text-gray-600">UOM</th>
                    <th className="text-center px-4 py-2 font-medium text-gray-600">Ordered</th>
                    <th className="text-center px-4 py-2 font-medium text-gray-600">Received</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(viewPO.items || []).map((it, idx) => (
                    <tr key={idx}>
                      <td className="px-4 py-2">{it.materialName}</td>
                      <td className="px-4 py-2 text-center text-gray-500">{it.uom}</td>
                      <td className="px-4 py-2 text-center">{it.orderedQty}</td>
                      <td className="px-4 py-2 text-center">{it.receivedQty || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {viewPO.notes && <p className="text-sm text-gray-600"><span className="font-medium">Notes:</span> {viewPO.notes}</p>}
            <div className="flex gap-3 justify-end pt-2">
              {(viewPO.status === 'sent' || viewPO.status === 'partial') && (
                <button onClick={() => { setViewPO(null); setActiveTab('receive'); handleSelectReceiptPO(viewPO.id) }}
                  className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
                  Receive Stock
                </button>
              )}
              <button onClick={() => setViewPO(null)}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'receive' && (
        <div className="bg-white rounded-xl shadow-sm border p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-800">Receive Stock</h2>
            <div className="flex gap-2">
              <button onClick={() => { setIsAdhoc(false) }}
                className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${!isAdhoc ? 'bg-amber-500 text-white' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
                Against PO
              </button>
              <button onClick={() => { setIsAdhoc(true) }}
                className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${isAdhoc ? 'bg-amber-500 text-white' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
                Ad-hoc Receipt
              </button>
            </div>
          </div>

          {!isAdhoc && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Select PO</label>
                <select value={receiptPOId} onChange={e => handleSelectReceiptPO(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                  <option value="">Select a PO...</option>
                  {sentPartialPOs.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.date instanceof Timestamp ? format(p.date.toDate(), 'dd MMM yyyy') : '—'} — {p.vendorName} ({p.status})
                    </option>
                  ))}
                </select>
              </div>

              {receiptPO && (
                <div className="rounded-lg border overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium text-gray-600">Material</th>
                        <th className="text-center px-4 py-2 font-medium text-gray-600">UOM</th>
                        <th className="text-center px-4 py-2 font-medium text-gray-600">Ordered</th>
                        <th className="text-center px-4 py-2 font-medium text-gray-600">Received</th>
                        <th className="text-center px-4 py-2 font-medium text-gray-600">Receiving Now</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {receiptItems.map((it, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-4 py-2">{it.materialName}</td>
                          <td className="px-4 py-2 text-center text-gray-500">{it.uom}</td>
                          <td className="px-4 py-2 text-center">{it.orderedQty}</td>
                          <td className="px-4 py-2 text-center text-gray-500">{it.receivedQty || 0}</td>
                          <td className="px-4 py-2 text-center">
                            <input type="number" min="0" value={it.newQty}
                              onChange={e => setReceiptItems(prev => prev.map((r, i) => i === idx ? { ...r, newQty: e.target.value } : r))}
                              placeholder="0"
                              className="w-20 border border-gray-300 rounded px-2 py-1 text-center text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {isAdhoc && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Search & Add Material</label>
                <div className="relative">
                  <input value={adhocSearch} onChange={e => setAdhocSearch(e.target.value)} placeholder="Type material name..."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                  {adhocResults.length > 0 && (
                    <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                      {adhocResults.map(m => (
                        <button key={m.id} onClick={() => addAdhocItem(m)}
                          className="w-full text-left px-4 py-2 text-sm hover:bg-amber-50 flex justify-between">
                          <span>{m.name}</span>
                          <span className="text-gray-400">{m.uom}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {adhocItems.length > 0 && (
                <div className="rounded-lg border overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium text-gray-600 whitespace-nowrap">Material</th>
                        <th className="text-center px-4 py-2 font-medium text-gray-600 whitespace-nowrap">UOM</th>
                        <th className="text-center px-4 py-2 font-medium text-gray-600 whitespace-nowrap">Qty</th>
                        <th className="px-4 py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {adhocItems.map((it, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className="px-4 py-2 whitespace-nowrap">{it.materialName}</td>
                          <td className="px-4 py-2 text-center text-gray-500 whitespace-nowrap">{it.uom}</td>
                          <td className="px-4 py-2 text-center">
                            <input type="number" min="0" value={it.qty} onChange={e => updateAdhocQty(idx, e.target.value)}
                              className="w-20 border border-gray-300 rounded px-2 py-1 text-center text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                          </td>
                          <td className="px-4 py-2 text-right">
                            <button onClick={() => removeAdhocItem(idx)} className="border border-red-300 text-red-500 hover:bg-red-50 px-2 py-1 rounded text-xs font-medium">🗑 Remove</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea value={receiptNotes} onChange={e => setReceiptNotes(e.target.value)} rows={2} placeholder="Optional notes..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>

          <button onClick={handleSaveReceipt} disabled={savingReceipt}
            className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {savingReceipt ? 'Saving...' : 'Save Receipt & Update Stock'}
          </button>
        </div>
      )}
    </div>
  )
}
