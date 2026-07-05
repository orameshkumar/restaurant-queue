import { useState } from 'react'
import Sidebar from './Sidebar'

export default function Layout({ children }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar — hidden on mobile */}
      <div className="hidden lg:flex flex-shrink-0">
        <Sidebar />
      </div>

      {/* Mobile drawer overlay */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="relative z-50 flex-shrink-0">
            <Sidebar onClose={() => setOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 bg-gray-900 border-b border-gray-700 flex-shrink-0">
          <button
            onClick={() => setOpen(true)}
            className="text-gray-300 hover:text-white p-1 rounded"
            aria-label="Open menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-amber-400 font-bold text-lg">🍽️ RestQueue</span>
        </header>

        <main className="flex-1 p-4 lg:p-6 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
