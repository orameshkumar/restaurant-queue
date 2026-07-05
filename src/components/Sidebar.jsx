import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const NAV = [
  { to: '/',          label: 'Dashboard',  icon: '📊', roles: ['admin','manager','host','server','cashier','chef','kitchen_manager'] },
  { to: '/host',      label: 'Host / Queue', icon: '🪑', roles: ['admin','manager','host'] },
  { to: '/server',    label: 'My Tables',  icon: '🍽️',  roles: ['admin','manager','server'] },
  { to: '/kds',       label: 'Kitchen',    icon: '👨‍🍳', roles: ['admin','manager','chef','kitchen_manager'] },
  { to: '/cashier',   label: 'Billing',    icon: '💳', roles: ['admin','manager','cashier','server'] },
  { to: '/menu',      label: 'Menu',       icon: '📋', roles: ['admin','manager','kitchen_manager'] },
  { to: '/tables',    label: 'Tables',     icon: '🗂️',  roles: ['admin','manager'] },
  { to: '/staff',     label: 'Staff',      icon: '👥', roles: ['admin','manager'] },
  { to: '/reports',   label: 'Reports',    icon: '📈', roles: ['admin','manager'] },
  { to: '/settings',  label: 'Settings',   icon: '⚙️',  roles: ['admin','manager'] },
]

export default function Sidebar({ onClose }) {
  const { profile, logout } = useAuth()
  const role = profile?.role ?? ''

  const visible = NAV.filter((n) => n.roles.includes(role))

  return (
    <aside className="w-56 bg-gray-900 h-full flex flex-col">
      <div className="px-4 py-5 border-b border-gray-700 flex items-start justify-between gap-2">
        <div>
          <div className="text-amber-400 font-bold text-lg leading-tight">🍽️ RestQueue</div>
          <div className="text-gray-400 text-xs mt-1 truncate">{profile?.name ?? profile?.email}</div>
          <span className="inline-block mt-1 text-xs bg-amber-500 text-white px-2 py-0.5 rounded-full capitalize">{role}</span>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-white mt-1 p-1 rounded" aria-label="Close menu">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <nav className="flex-1 py-3 space-y-0.5 overflow-y-auto">
        {visible.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                isActive
                  ? 'bg-amber-500 text-white font-medium'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`
            }
          >
            <span>{n.icon}</span>
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="px-4 py-4 border-t border-gray-700">
        <button
          onClick={logout}
          className="w-full text-left text-sm text-gray-400 hover:text-white flex items-center gap-2 py-1"
        >
          <span>🚪</span> Sign out
        </button>
      </div>
    </aside>
  )
}
