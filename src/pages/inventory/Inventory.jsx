import { useState, useEffect, useRef } from 'react'
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

const NAV_GROUPS = [
  {
    key: 'overview', label: 'Overview', icon: '📊',
    roles: ['admin', 'manager', 'kitchen_manager', 'chef'],
    children: [],
  },
  {
    key: 'stock', label: 'Stock', icon: '📦',
    roles: ['admin', 'manager'],
    children: [
      { key: 'materials', label: 'Materials', icon: '📦' },
      { key: 'vendors', label: 'Vendors', icon: '🏪' },
    ],
  },
  {
    key: 'kitchen', label: 'Kitchen', icon: '🍳',
    roles: ['admin', 'manager', 'kitchen_manager', 'chef'],
    children: [
      { key: 'requests', label: 'Requests', icon: '🍳' },
      { key: 'returns', label: 'Returns', icon: '↩️' },
      { key: 'wastage', label: 'Wastage', icon: '🗑️' },
      { key: 'templates', label: 'Templates', icon: '📑' },
    ],
  },
  {
    key: 'purchasing', label: 'Purchasing', icon: '📋',
    roles: ['admin', 'manager'],
    children: [
      { key: 'purchase-orders', label: 'Purchase Orders', icon: '📋' },
    ],
  },
  {
    key: 'reports', label: 'Reports', icon: '📒',
    roles: ['admin', 'manager', 'kitchen_manager'],
    children: [
      { key: 'ledger', label: 'Ledger', icon: '📒' },
    ],
  },
]

function NavBar({ activeTab, onNavigate, role }) {
  const [openGroup, setOpenGroup] = useState(null)
  const navRef = useRef(null)

  const visibleGroups = NAV_GROUPS.filter(g => g.roles.includes(role))

  function getActiveGroup() {
    return visibleGroups.find(g =>
      g.children.length === 0 ? g.key === activeTab : g.children.some(c => c.key === activeTab)
    )
  }

  function getActiveChild(group) {
    return group.children.find(c => c.key === activeTab)
  }

  useEffect(() => {
    function handleClickOutside(e) {
      if (navRef.current && !navRef.current.contains(e.target)) setOpenGroup(null)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function handleGroupClick(group) {
    if (group.children.length === 0) {
      onNavigate(group.key)
      setOpenGroup(null)
    } else {
      setOpenGroup(prev => prev === group.key ? null : group.key)
    }
  }

  function handleChildClick(key) {
    onNavigate(key)
    setOpenGroup(null)
  }

  const activeGroup = getActiveGroup()

  return (
    <div ref={navRef} className="bg-white rounded-xl shadow-sm border mb-6">
      <div className="flex flex-wrap gap-1 p-2">
        {visibleGroups.map(group => {
          const isActive = activeGroup?.key === group.key
          const activeChild = isActive ? getActiveChild(group) : null
          const isOpen = openGroup === group.key

          return (
            <div key={group.key} className="relative">
              <button
                onClick={() => handleGroupClick(group)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-amber-500 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <span>{group.icon}</span>
                <span>{group.label}</span>
                {activeChild && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ml-0.5 ${isActive ? 'bg-amber-400 text-white' : 'bg-gray-100 text-gray-500'}`}>
                    {activeChild.label}
                  </span>
                )}
                {group.children.length > 0 && (
                  <svg className={`w-3.5 h-3.5 ml-0.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                )}
              </button>

              {isOpen && group.children.length > 0 && (
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-50 min-w-max py-1">
                  {group.children.map(child => (
                    <button
                      key={child.key}
                      onClick={() => handleChildClick(child.key)}
                      className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-amber-50 transition-colors ${
                        activeTab === child.key ? 'text-amber-600 font-semibold bg-amber-50' : 'text-gray-700'
                      }`}
                    >
                      <span>{child.icon}</span>
                      <span>{child.label}</span>
                      {activeTab === child.key && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-500" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SummaryCard({ label, value, valueClass = 'text-gray-900', onClick }) {
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl shadow-sm border p-5 flex flex-col gap-1 ${onClick ? 'cursor-pointer hover:border-amber-400 hover:shadow-md transition-all' : ''}`}
    >
      <span className="text-sm text-gray-500">{label}</span>
      <span className={`text-3xl font-bold ${valueClass}`}>{value}</span>
      {onClick && <span className="text-xs text-amber-500 mt-1">Tap to view →</span>}
    </div>
  )
}

function Overview({ onGeneratePO, onNavigate }) {
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
        <SummaryCard label="Pending Requests" value={pendingRequests} valueClass={pendingRequests > 0 ? 'text-amber-600' : 'text-gray-900'} onClick={() => onNavigate('requests')} />
        <SummaryCard label="Draft POs" value={draftPOs} valueClass={draftPOs > 0 ? 'text-blue-600' : 'text-gray-900'} onClick={() => onNavigate('purchase-orders')} />
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

  function handleGeneratePO(material) {
    setPoInitMaterial(material)
    setActiveTab('purchase-orders')
  }

  function renderContent() {
    switch (activeTab) {
      case 'overview':
        return <Overview onGeneratePO={handleGeneratePO} onNavigate={setActiveTab} />
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
      <div className="w-full px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
          <p className="text-sm text-gray-500 mt-1">Manage materials, stock, vendors, and purchasing</p>
        </div>

        <NavBar activeTab={activeTab} onNavigate={setActiveTab} role={role} />

        <div>{renderContent()}</div>
      </div>
    </div>
  )
}
