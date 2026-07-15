import { useState, useEffect } from 'react'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import toast from 'react-hot-toast'
import {
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  Timestamp
} from 'firebase/firestore'

export default function InvTemplates() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState('kitchen')
  const [templates, setTemplates] = useState([])
  const [materials, setMaterials] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [formName, setFormName] = useState('')
  const [formItems, setFormItems] = useState([])
  const [materialSearch, setMaterialSearch] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchMaterials()
  }, [])

  useEffect(() => {
    fetchTemplates()
  }, [activeTab])

  useEffect(() => {
    if (materialSearch.trim() === '') {
      setSearchResults([])
      return
    }
    const lower = materialSearch.toLowerCase()
    const filtered = materials.filter(
      m =>
        m.name.toLowerCase().includes(lower) &&
        !formItems.find(fi => fi.materialId === m.id)
    )
    setSearchResults(filtered.slice(0, 8))
  }, [materialSearch, materials, formItems])

  async function fetchMaterials() {
    try {
      const snap = await getDocs(query(collection(db, 'invMaterials'), orderBy('name')))
      setMaterials(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch {
      toast.error('Failed to load materials')
    }
  }

  async function fetchTemplates() {
    setLoading(true)
    try {
      const snap = await getDocs(
        query(collection(db, 'invTemplates'), orderBy('name'))
      )
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      setTemplates(all.filter(t => t.type === activeTab))
    } catch {
      toast.error('Failed to load templates')
    } finally {
      setLoading(false)
    }
  }

  function openCreate() {
    setEditingTemplate(null)
    setFormName('')
    setFormItems([])
    setMaterialSearch('')
    setSearchResults([])
    setShowForm(true)
  }

  function openEdit(tmpl) {
    setEditingTemplate(tmpl)
    setFormName(tmpl.name)
    setFormItems(tmpl.items.map(i => ({ ...i })))
    setMaterialSearch('')
    setSearchResults([])
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingTemplate(null)
    setFormName('')
    setFormItems([])
    setMaterialSearch('')
    setSearchResults([])
  }

  function addItemFromSearch(mat) {
    setFormItems(prev => [
      ...prev,
      { materialId: mat.id, materialName: mat.name, uom: mat.uom, qty: 1 }
    ])
    setMaterialSearch('')
    setSearchResults([])
  }

  function updateItemQty(index, qty) {
    setFormItems(prev =>
      prev.map((item, i) => (i === index ? { ...item, qty: parseFloat(qty) || 0 } : item))
    )
  }

  function removeItem(index) {
    setFormItems(prev => prev.filter((_, i) => i !== index))
  }

  async function handleSave() {
    if (!formName.trim()) {
      toast.error('Template name is required')
      return
    }
    if (formItems.length === 0) {
      toast.error('Add at least one item')
      return
    }
    const invalidQty = formItems.find(i => !i.qty || i.qty <= 0)
    if (invalidQty) {
      toast.error(`Enter a valid quantity for ${invalidQty.materialName}`)
      return
    }
    setSaving(true)
    try {
      const payload = {
        type: activeTab,
        name: formName.trim(),
        items: formItems,
        createdBy: user.uid,
        createdByName: user.displayName || user.email
      }
      if (editingTemplate) {
        await updateDoc(doc(db, 'invTemplates', editingTemplate.id), payload)
        toast.success('Template updated')
      } else {
        await addDoc(collection(db, 'invTemplates'), {
          ...payload,
          createdAt: Timestamp.now()
        })
        toast.success('Template created')
      }
      closeForm()
      fetchTemplates()
    } catch {
      toast.error('Failed to save template')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteDoc(doc(db, 'invTemplates', deleteTarget.id))
      toast.success('Template deleted')
      setDeleteTarget(null)
      fetchTemplates()
    } catch {
      toast.error('Failed to delete template')
    }
  }

  async function handleDuplicate(tmpl) {
    try {
      await addDoc(collection(db, 'invTemplates'), {
        type: tmpl.type,
        name: `(Copy) ${tmpl.name}`,
        items: tmpl.items.map(i => ({ ...i })),
        createdBy: user.uid,
        createdByName: user.displayName || user.email,
        createdAt: Timestamp.now()
      })
      toast.success('Template duplicated')
      fetchTemplates()
    } catch {
      toast.error('Failed to duplicate template')
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Templates</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage reusable item templates</p>
        </div>
        <button
          onClick={openCreate}
          className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          + New Template
        </button>
      </div>

      <div className="flex gap-2 mb-6">
        {['kitchen', 'po'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'bg-amber-500 text-white'
                : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {tab === 'kitchen' ? 'Kitchen Templates' : 'PO Templates'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" />
        </div>
      ) : templates.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border text-center py-16">
          <p className="text-gray-400 text-sm">No templates yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {templates.map(tmpl => (
            <div key={tmpl.id} className="bg-white rounded-xl shadow-sm border p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-gray-900 truncate">{tmpl.name}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {tmpl.items.length} item{tmpl.items.length !== 1 ? 's' : ''} · by {tmpl.createdByName}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => openEdit(tmpl)}
                    className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                    title="Edit"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleDuplicate(tmpl)}
                    className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title="Duplicate"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setDeleteTarget(tmpl)}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="mt-3 space-y-1">
                {tmpl.items.slice(0, 3).map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">{item.materialName}</span>
                    <span className="text-gray-500 text-xs">
                      {item.qty} {item.uom}
                    </span>
                  </div>
                ))}
                {tmpl.items.length > 3 && (
                  <p className="text-xs text-gray-400 pt-1">
                    and {tmpl.items.length - 3} more...
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingTemplate ? 'Edit Template' : 'New Template'}
              </h2>
              <button
                onClick={closeForm}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Template Name
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="e.g. Daily Breakfast Prep"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Add Items
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={materialSearch}
                    onChange={e => setMaterialSearch(e.target.value)}
                    placeholder="Search material..."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                  {searchResults.length > 0 && (
                    <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {searchResults.map(mat => (
                        <button
                          key={mat.id}
                          onClick={() => addItemFromSearch(mat)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 flex items-center justify-between"
                        >
                          <span className="text-gray-800">{mat.name}</span>
                          <span className="text-gray-400 text-xs">{mat.uom}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {formItems.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    Items ({formItems.length})
                  </p>
                  <div className="border rounded-lg divide-y">
                    {formItems.map((item, index) => (
                      <div key={index} className="flex items-center gap-2 px-3 py-2">
                        <span className="flex-1 text-sm text-gray-800 truncate">
                          {item.materialName}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={item.qty}
                            onChange={e => updateItemQty(index, e.target.value)}
                            className="w-20 border border-gray-300 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-amber-400"
                          />
                          <span className="text-xs text-gray-500 w-8">{item.uom}</span>
                          <button
                            onClick={() => removeItem(index)}
                            className="text-gray-300 hover:text-red-500 ml-1"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t">
              <button
                onClick={closeForm}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {saving ? 'Saving...' : editingTemplate ? 'Update Template' : 'Create Template'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Template</h3>
            <p className="text-sm text-gray-600 mb-6">
              Are you sure you want to delete <span className="font-medium">"{deleteTarget.name}"</span>? This action cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
