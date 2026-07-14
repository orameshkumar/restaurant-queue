import { useState, useEffect } from 'react'
import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import { format } from 'date-fns'
import InvMaterials from './InvMaterials'
import InvVendors from './InvVendors'
import InvRequests from './InvRequests'
import InvReturns from './InvReturns'
import InvPO from './InvPO'
import InvWastage from './InvWastage'
import InvTemplates from './InvTemplates'
import InvLedger from './InvLedger'

const TABS = [
  { key: 'overview', label: 'Overview', icon: '📊', roles: ['admin', 'manager', 'kitchen_manager', 'chef'] },
  { key: 'materials', label: 'Materials', icon: '📦', roles: ['admin', 'manager'] },
  { key: 'vendors', label: 'Vendors', icon: '🏪', roles: ['admin', 'manager'] },
  { key: 'requests', label: 'Requests', icon: '🍳', roles: ['admin', 'manager', 'kitchen_manager', 'chef'] },
  { key: 'returns', label: 'Returns', icon: '↩️', roles: ['admin', 'manager', 'kitchen_manager', 'chef'] },
  { key: 'purchase-orders', label: 'Purchase Orders', icon: '📋', roles: ['admin', 'manager'] },
  { key: 'wastage', label: 'Wastage', icon: '🗑️', roles: ['admin', 'manager', 'kitchen_manager', 'chef'] },
  { key: 'templates', label: 'Templates', icon: '📑', roles: ['admin', 'manager', 'kitchen_manager', 'chef'] },
  { key: 'ledger', label: 'Ledger', icon: '📒', roles: ['admin', 'manager', 'kitchen_manager'] },
]

function SummaryCard({ label, value, valueClass = 'text-gray-900' }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border p-5 flex flex-col gap-1">
      <span className="text-sm text-gray-500">{label}</span>
      <span className={`text-3xl font-bold ${valueClass}`}>{value}</span>
    </div>
  )
}

function Overview({ onGeneratePO }) {
  const [materials, setMaterials] = useState([])
  const [pendingRequests, setPendingRequests] = useState(0)
  const [draftPOs, setDraftPOs] = useState(0)
  const [recentLedger, setRecentLedger] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      try {
        const [matsSnap, reqSnap, poSnap, ledgerSnap] = await Promise.all([
          getDocs(collection(db, 'invMaterials')),
          getDocs(query(collection(db, 'invRequests'), where('status', '==', 'pending'))),
          getDocs(query(collection(db, 'invPOs'), where('status', '==', 'draft'))),
          getDocs(query(collection(db, 'invLedger'), orderBy('date', 'desc'), limit(10))),
        ])
        setMaterials(matsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
        setPendingRequests(reqSnap.size)
        setDraftPOs(poSnap.size)
        setRecentLedger(ledgerSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const lowStock = materials.filter(m => m.currentStock <= m.reorderLevel)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Loading overview...</div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="Total Materials" value={materials.length} />
        <SummaryCard label="Low Stock" value={lowStock.length} valueClass={lowStock.length > 0 ? 'text-red-600' : 'text-gray-900'} />
        <SummaryCard label="Pending Requests" value={pendingRequests} valueClass={pendingRequests > 0 ? 'text-amber-600' : 'text-gray-900'} />
        <SummaryCard label="Draft POs" value={draftPOs} valueClass={draftPOs > 0 ? 'text-blue-600' : 'text-gray-900'} />
      </div>

      <div className="bg-white rounded-xl shadow-sm border">
        <div className="px-5 py-4 border-b">
          <h2 className="text-base font-semibold text-gray-800">Low Stock Alerts</h2>
        </div>
        {lowStock.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">All materials are adequately stocked.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Category</th>
                  <th className="px-5 py-3">UOM</th>
                  <th className="px-5 py-3">Current Stock</th>
                  <th className="px-5 py-3">Reorder Level</th>
                  <th className="px-5 py-3">Reorder Qty</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lowStock.map(m => (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-900">{m.name}</td>
                    <td className="px-5 py-3 text-gray-600">{m.category}</td>
                    <td className="px-5 py-3 text-gray-600">{m.uom}</td>
                    <td className="px-5 py-3 font-semibold text-red-600">{m.currentStock}</td>
                    <td className="px-5 py-3 text-gray-600">{m.reorderLevel}</td>
                    <td className="px-5 py-3 text-gray-600">{m.reorderQty}</td>
                    <td className="px-5 py-3">
                      <button
                        onClick={() => onGeneratePO(m)}
                        className="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium"
                      >
                        Generate PO
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border">
        <div className="px-5 py-4 border-b">
          <h2 className="text-base font-semibold text-gray-800">Recent Activity</h2>
        </div>
        {recentLedger.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-400">No ledger entries found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Material</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Qty</th>
                  <th className="px-5 py-3">UOM</th>
                  <th className="px-5 py-3">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {recentLedger.map(entry => (
                  <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 text-gray-600 whitespace-nowrap">
                      {entry.date?.toDate ? format(entry.date.toDate(), 'dd MMM yyyy HH:mm') : '—'}
                    </td>
                    <td className="px-5 py-3 font-medium text-gray-900">{entry.materialName}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        entry.txType === 'receive' ? 'bg-green-100 text-green-700' :
                        entry.txType === 'issue' ? 'bg-blue-100 text-blue-700' :
                        entry.txType === 'return' ? 'bg-purple-100 text-purple-700' :
                        entry.txType === 'wastage' ? 'bg-red-100 text-red-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {entry.txType}
                      </span>
                    </td>
                    <td className={`px-5 py-3 font-semibold ${entry.qty >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {entry.qty >= 0 ? `+${entry.qty}` : entry.qty}
                    </td>
                    <td className="px-5 py-3 text-gray-600">{entry.uom}</td>
                    <td className="px-5 py-3 text-gray-500 max-w-xs truncate">{entry.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Inventory() {
  const { profile } = useAuth()
  const role = profile?.role || ''
  const [activeTab, setActiveTab] = useState('overview')
  const [poInitMaterial, setPoInitMaterial] = useState(null)

  const visibleTabs = TABS.filter(t => t.roles.includes(role))

  function handleGeneratePO(material) {
    setPoInitMaterial(material)
    setActiveTab('purchase-orders')
  }

  function renderContent() {
    switch (activeTab) {
      case 'overview':
        return <Overview onGeneratePO={handleGeneratePO} />
      case 'materials':
        return <InvMaterials />
      case 'vendors':
        return <InvVendors />
      case 'requests':
        return <InvRequests />
      case 'returns':
        return <InvReturns />
      case 'purchase-orders':
        return <InvPO activeTab={activeTab} initMaterial={poInitMaterial} onInitMaterialConsumed={() => setPoInitMaterial(null)} />
      case 'wastage':
        return <InvWastage />
      case 'templates':
        return <InvTemplates />
      case 'ledger':
        return <InvLedger />
      default:
        return null
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
          <p className="text-sm text-gray-500 mt-1">Manage materials, stock, vendors, and purchasing</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border mb-6 overflow-x-auto">
          <div className="flex min-w-max">
            {visibleTabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.key
                    ? 'border-amber-500 text-amber-600 bg-amber-50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div>{renderContent()}</div>
      </div>
    </div>
  )
}
