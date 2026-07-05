import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
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

const MANAGER_ROLES = ['admin', 'manager']

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

      <Route path="/"         element={<Protected><Dashboard /></Protected>} />
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
