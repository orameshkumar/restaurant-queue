import { useState, useEffect } from 'react'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import toast from 'react-hot-toast'
import {
  collection, addDoc, getDocs, doc, updateDoc, deleteDoc,
  writeBatch, query, where, orderBy, Timestamp,
} from 'firebase/firestore'
import { format } from 'date-fns'
import { DEFAULT_MATERIALS } from './defaultMaterials'

const UOM_OPTIONS = ['Kg', 'Ltr', 'Nos', 'Pcs', 'Box', 'Bag']

const EMPTY_FORM = { name: '', category: '', uom: 'Kg', reorderLevel: '', reorderQty: '' }

export default function InvMaterials() {
  const { user, profile } = useAuth()
  const [materials, setMaterials] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [adjTarget, setAdjTarget] = useState(null)
  const [adjForm, setAdjForm] = useState({ qty: '', reason: '' })
  const [adjErrors, setAdjErrors] = useState({})
  const [adjSaving, setAdjSaving] = useState(false)
  const [showLoadDefaults, setShowLoadDefaults] = useState(false)
  const [loadingDefaults, setLoadingDefaults] = useState(false)
  const [defaultsPreview, setDefaultsPreview] = useState([])

  const loadMaterials = async () => {
    try {
      const snap = await getDocs(query(collection(db, 'invMaterials'), orderBy('name')))
      setMaterials(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    } catch {
      toast.error('Failed to load materials')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadMaterials() }, [])

  const filtered = materials.filter((m) => {
    const q = search.toLowerCase()
    return m.name?.toLowerCase().includes(q) || m.category?.toLowerCase().includes(q)
  })

  const lowStockCount = materials.filter((m) => m.currentStock <= m.reorderLevel).length

  const openAdd = () => { setEditTarget(null); setForm(EMPTY_FORM); setFormErrors({}); setShowModal(true) }

  const openEdit = (m) => {
    setEditTarget(m)
    setForm({ name: m.name, category: m.category, uom: m.uom, reorderLevel: m.reorderLevel, reorderQty: m.reorderQty })
    setFormErrors({})
    setShowModal(true)
  }

  const validateForm = () => {
    const errors = {}
    if (!form.name.trim()) errors.name = 'Name is required'
    if (!form.category.trim()) errors.category = 'Category is required'
    if (form.reorderLevel === '' || isNaN(Number(form.reorderLevel))) errors.reorderLevel = 'Valid number required'
    if (form.reorderQty === '' || isNaN(Number(form.reorderQty))) errors.reorderQty = 'Valid number required'
    return errors
  }

  const handleSave = async () => {
    const errors = validateForm()
    if (Object.keys(errors).length) { setFormErrors(errors); return }
    setSaving(true)
    try {
      const data = {
        name: form.name.trim(), category: form.category.trim(), uom: form.uom,
        reorderLevel: Number(form.reorderLevel), reorderQty: Number(form.reorderQty),
      }
      if (editTarget) {
        await updateDoc(doc(db, 'invMaterials', editTarget.id), data)
        toast.success('Material updated')
      } else {
        await addDoc(collection(db, 'invMaterials'), { ...data, currentStock: 0, createdAt: Timestamp.now() })
        toast.success('Material added')
      }
      setShowModal(false)
      loadMaterials()
    } catch {
      toast.error('Failed to save material')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const ledgerSnap = await getDocs(query(collection(db, 'invLedger'), where('materialId', '==', deleteTarget.id)))
      if (!ledgerSnap.empty) { toast.error('Cannot delete: stock transactions exist'); setDeleteTarget(null); return }
      await deleteDoc(doc(db, 'invMaterials', deleteTarget.id))
      toast.success('Material deleted')
      setDeleteTarget(null)
      loadMaterials()
    } catch {
      toast.error('Failed to delete material')
    } finally {
      setDeleting(false)
    }
  }

  const openAdj = (m) => { setAdjTarget(m); setAdjForm({ qty: '', reason: '' }); setAdjErrors({}) }

  const handleAdj = async () => {
    const errors = {}
    if (adjForm.qty === '' || isNaN(Number(adjForm.qty)) || Number(adjForm.qty) === 0) errors.qty = 'Enter a non-zero number'
    if (!adjForm.reason.trim()) errors.reason = 'Reason is required'
    if (Object.keys(errors).length) { setAdjErrors(errors); return }
    setAdjSaving(true)
    try {
      const qty = Number(adjForm.qty)
      const batch = writeBatch(db)
      batch.update(doc(db, 'invMaterials', adjTarget.id), { currentStock: adjTarget.currentStock + qty })
      batch.set(doc(collection(db, 'invLedger')), {
        materialId: adjTarget.id, materialName: adjTarget.name, uom: adjTarget.uom,
        date: Timestamp.now(), txType: 'adjustment', qty,
        refId: '', refType: 'adjustment', note: adjForm.reason.trim(), recordedBy: user?.uid || '',
      })
      await batch.commit()
      toast.success('Stock adjusted')
      setAdjTarget(null)
      loadMaterials()
    } catch {
      toast.error('Failed to adjust stock')
    } finally {
      setAdjSaving(false)
    }
  }

  // ── Load Defaults ──────────────────────────────────────────────────────────

  const openLoadDefaults = async () => {
    const existingNames = new Set(materials.map((m) => m.name.toLowerCase()))
    const toAdd = DEFAULT_MATERIALS.filter((d) => !existingNames.has(d.name.toLowerCase()))
    setDefaultsPreview(toAdd)
    setShowLoadDefaults(true)
  }

  const handleLoadDefaults = async () => {
    if (defaultsPreview.length === 0) { toast('All default materials already exist'); setShowLoadDefaults(false); return }
    setLoadingDefaults(true)
    try {
      const BATCH_SIZE = 400
      for (let i = 0; i < defaultsPreview.length; i += BATCH_SIZE) {
        const batch = writeBatch(db)
        defaultsPreview.slice(i, i + BATCH_SIZE).forEach((item) => {
          batch.set(doc(collection(db, 'invMaterials')), { ...item, createdAt: Timestamp.now() })
        })
        await batch.commit()
      }
      toast.success(`${defaultsPreview.length} materials loaded successfully`)
      setShowLoadDefaults(false)
      loadMaterials()
    } catch {
      toast.error('Failed to load default materials')
    } finally {
      setLoadingDefaults(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-800">Raw Materials</h1>
          {lowStockCount > 0 && (
            <span className="bg-red-100 text-red-700 text-xs font-semibold px-2.5 py-1 rounded-full">
              {lowStockCount} low stock
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={openLoadDefaults}
            className="border border-amber-400 text-amber-600 hover:bg-amber-50 px-4 py-2 rounded-lg text-sm font-medium">
            Load Defaults
          </button>
          <button onClick={openAdd}
            className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
            + Add Material
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <input type="text" placeholder="Search by name or category..."
          value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500 text-sm">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            No materials found.{materials.length === 0 && (
              <span className="block mt-2">
                <button onClick={openLoadDefaults} className="text-amber-600 hover:underline font-medium">Load default restaurant materials</button> to get started.
              </span>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Name</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Category</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">UOM</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-600">Stock</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-600">Reorder At</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-600">Reorder Qty</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((m) => {
                  const isLow = m.currentStock <= m.reorderLevel
                  return (
                    <tr key={m.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-800">{m.name}</td>
                      <td className="px-4 py-3 text-gray-600">{m.category}</td>
                      <td className="px-4 py-3 text-gray-600">{m.uom}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${isLow ? 'text-red-600' : 'text-gray-800'}`}>
                        {m.currentStock}{isLow && <span className="ml-1 text-xs text-red-500">▼</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">{m.reorderLevel}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{m.reorderQty}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => openAdj(m)}
                            className="border border-amber-400 text-amber-600 hover:bg-amber-50 px-3 py-1 rounded-lg text-xs font-medium">
                            Adjust
                          </button>
                          <button onClick={() => openEdit(m)}
                            className="border border-gray-300 text-gray-700 hover:bg-gray-50 px-3 py-1 rounded-lg text-xs font-medium">
                            Edit
                          </button>
                          <button onClick={() => setDeleteTarget(m)}
                            className="border border-red-300 text-red-600 hover:bg-red-50 px-3 py-1 rounded-lg text-xs font-medium">
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800">{editTarget ? 'Edit Material' : 'Add Material'}</h2>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                {formErrors.name && <p className="text-red-500 text-xs mt-1">{formErrors.name}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                {formErrors.category && <p className="text-red-500 text-xs mt-1">{formErrors.category}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unit of Measure</label>
                <select value={form.uom} onChange={(e) => setForm({ ...form, uom: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                  {UOM_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reorder Level</label>
                  <input type="number" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                  {formErrors.reorderLevel && <p className="text-red-500 text-xs mt-1">{formErrors.reorderLevel}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reorder Qty</label>
                  <input type="number" value={form.reorderQty} onChange={(e) => setForm({ ...form, reorderQty: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                  {formErrors.reorderQty && <p className="text-red-500 text-xs mt-1">{formErrors.reorderQty}</p>}
                </div>
              </div>
              {editTarget && (
                <p className="text-xs text-gray-400">
                  Current stock: <span className="font-medium text-gray-600">{editTarget.currentStock} {editTarget.uom}</span> — use Stock Adjustment to change.
                </p>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button onClick={() => setShowModal(false)}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60">
                {saving ? 'Saving...' : editTarget ? 'Update' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
            <div className="px-6 py-5">
              <h2 className="text-lg font-semibold text-gray-800 mb-2">Delete Material</h2>
              <p className="text-sm text-gray-600">
                Are you sure you want to delete <span className="font-semibold">{deleteTarget.name}</span>? This cannot be undone.
              </p>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
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

      {/* Stock Adjustment Modal */}
      {adjTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-800">Stock Adjustment</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {adjTarget.name} — Current: <span className="font-medium text-gray-700">{adjTarget.currentStock} {adjTarget.uom}</span>
              </p>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Adjustment Qty <span className="text-gray-400 font-normal">(use negative to reduce)</span>
                </label>
                <input type="number" value={adjForm.qty} onChange={(e) => setAdjForm({ ...adjForm, qty: e.target.value })}
                  placeholder="e.g. 10 or -5"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                {adjErrors.qty && <p className="text-red-500 text-xs mt-1">{adjErrors.qty}</p>}
                {adjForm.qty !== '' && !isNaN(Number(adjForm.qty)) && Number(adjForm.qty) !== 0 && (
                  <p className="text-xs text-gray-500 mt-1">
                    New stock will be: <span className="font-medium text-gray-700">{adjTarget.currentStock + Number(adjForm.qty)} {adjTarget.uom}</span>
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                <input type="text" value={adjForm.reason} onChange={(e) => setAdjForm({ ...adjForm, reason: e.target.value })}
                  placeholder="e.g. Physical count correction"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                {adjErrors.reason && <p className="text-red-500 text-xs mt-1">{adjErrors.reason}</p>}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button onClick={() => setAdjTarget(null)}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
              <button onClick={handleAdj} disabled={adjSaving}
                className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60">
                {adjSaving ? 'Saving...' : 'Apply Adjustment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Load Defaults Modal */}
      {showLoadDefaults && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl flex flex-col max-h-[85vh]">
            <div className="px-6 py-4 border-b border-gray-200 flex-shrink-0">
              <h2 className="text-lg font-semibold text-gray-800">Load Default Materials</h2>
              {defaultsPreview.length > 0 ? (
                <p className="text-sm text-gray-500 mt-0.5">
                  <span className="font-medium text-amber-600">{defaultsPreview.length}</span> new items will be added
                  {materials.length > 0 && ` (${DEFAULT_MATERIALS.length - defaultsPreview.length} already exist, skipped)`}.
                </p>
              ) : (
                <p className="text-sm text-green-600 mt-0.5 font-medium">All default materials already exist in your inventory.</p>
              )}
            </div>

            {defaultsPreview.length > 0 && (
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">UOM</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Opening Stock</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Reorder At</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Reorder Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {defaultsPreview.map((item, i) => (
                      <tr key={i} className="hover:bg-amber-50">
                        <td className="px-4 py-2 font-medium text-gray-800">{item.name}</td>
                        <td className="px-4 py-2 text-gray-500 text-xs">{item.category}</td>
                        <td className="px-4 py-2 text-gray-500">{item.uom}</td>
                        <td className="px-4 py-2 text-right text-gray-700">{item.currentStock}</td>
                        <td className="px-4 py-2 text-right text-gray-500">{item.reorderLevel}</td>
                        <td className="px-4 py-2 text-right text-gray-500">{item.reorderQty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="px-6 py-4 border-t border-gray-200 flex justify-between items-center flex-shrink-0">
              <p className="text-xs text-gray-400">Items are skipped if they already exist (matched by name).</p>
              <div className="flex gap-3">
                <button onClick={() => setShowLoadDefaults(false)}
                  className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">
                  Cancel
                </button>
                <button onClick={handleLoadDefaults} disabled={loadingDefaults || defaultsPreview.length === 0}
                  className="bg-amber-500 hover:bg-amber-600 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-60">
                  {loadingDefaults ? 'Loading...' : `Load ${defaultsPreview.length} Materials`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
