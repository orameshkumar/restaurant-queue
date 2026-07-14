import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { MANAGER_ROLES } from './utils/roles'
import Layout from './components/Layout'
import Login    from './pages/login/Login'
import Dashboard from './pages/dashboard/Dashboard'
import Host     from './pages/host/Host'
import Server   from './pages/server/Server'
import KDS      from './pages/kds/KDS'
import Cashier  from './pages/cashier/Cashier'
import Menu     from './pages/menu/Menu'
import Tables   from './pages/tables/Tables'
import Staff    from './pages/staff/Staff'
import Reports  from './pages/reports/Reports'
import Settings from './pages/settings/Settings'
import Board    from './pages/board/Board'
import GuestOrder from './pages/guest/GuestOrder'
import Orders  from './pages/orders/Orders'
import Takeaway from './pages/takeaway/Takeaway'
import Inventory from './pages/inventory/Inventory'
import TakeawayQueue from './pages/takeaway/TakeawayQueue'
import QueueBoard  from './pages/queue/QueueBoard'
import QueueJoin   from './pages/queue/QueueJoin'
import QueueStatus from './pages/queue/QueueStatus'

// AuthProvider already blocks rendering until user + profile are resolved,
// so Protected never sees a loading state.
function Protected({ children, roles }) {
  const { user, profile } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(profile?.role)) return <Navigate to="/" replace />
  return <Layout>{children}</Layout>
}

export default function App() {
  const { user } = useAuth()
  return (
    <Routes>
      <Route path="/login"    element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/board"    element={<Board />} />
      <Route path="/guest/:tableId/:bookingId" element={<GuestOrder />} />
      <Route path="/queue"              element={<QueueBoard />} />
      <Route path="/queue/join"         element={<QueueJoin />} />
      <Route path="/queue/status/:bookingId" element={<QueueStatus />} />

      <Route path="/"         element={<Protected><Dashboard /></Protected>} />
      <Route path="/orders"   element={<Protected><Orders /></Protected>} />
      <Route path="/takeaway" element={<Protected roles={[...MANAGER_ROLES,'server','cashier']}><Takeaway /></Protected>} />
      <Route path="/takeaway/queue/:orderId" element={<TakeawayQueue />} />
      <Route path="/inventory" element={<Protected roles={['admin','manager','kitchen_manager','chef']}><Inventory /></Protected>} />
      <Route path="/host"     element={<Protected roles={[...MANAGER_ROLES,'host']}><Host /></Protected>} />
      <Route path="/server"   element={<Protected roles={[...MANAGER_ROLES,'server']}><Server /></Protected>} />
      <Route path="/kds"      element={<Protected roles={[...MANAGER_ROLES,'chef','kitchen_manager']}><KDS /></Protected>} />
      <Route path="/cashier"  element={<Protected roles={[...MANAGER_ROLES,'cashier','server']}><Cashier /></Protected>} />
      <Route path="/menu"     element={<Protected roles={[...MANAGER_ROLES,'kitchen_manager']}><Menu /></Protected>} />
      <Route path="/tables"   element={<Protected roles={MANAGER_ROLES}><Tables /></Protected>} />
      <Route path="/staff"    element={<Protected roles={MANAGER_ROLES}><Staff /></Protected>} />
      <Route path="/reports"  element={<Protected roles={MANAGER_ROLES}><Reports /></Protected>} />
      <Route path="/settings" element={<Protected roles={MANAGER_ROLES}><Settings /></Protected>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
