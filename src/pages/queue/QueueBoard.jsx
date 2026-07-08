import { useState, useEffect, useMemo } from 'react'
import { collection, query, where, onSnapshot, doc, getDoc } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import QRCode from 'react-qr-code'
import { db } from '../../firebase/config'

const TODAY = new Date().toISOString().split('T')[0]
const EWT_PER_PARTY = 20 // minutes per party ahead

function maskName(name = '') {
  const parts = name.trim().split(' ')
  if (parts.length === 1) return parts[0]
  return parts[0] + ' ' + parts.slice(1).map(p => p[0] + '.').join(' ')
}

export default function QueueBoard() {
  const navigate = useNavigate()
  const [queue, setQueue] = useState([])
  const [restaurantName, setRestaurantName] = useState('Restaurant')
  const [tick, setTick] = useState(0)

  const joinUrl = `${window.location.origin}/queue/join`

  useEffect(() => {
    getDoc(doc(db, 'restaurantSettings', 'main')).then(snap => {
      if (snap.exists()) setRestaurantName(snap.data().restaurantName ?? 'Restaurant')
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const q = query(
      collection(db, 'bookings'),
      where('date', '==', TODAY),
      where('status', '==', 'waiting')
    )
    return onSnapshot(q, snap => {
      const docs = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.queueSequence ?? 0) - (b.queueSequence ?? 0))
      setQueue(docs)
    })
  }, [])

  // Refresh clock every minute for EWT display
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 60000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-5 border-b border-gray-700">
        <div>
          <h1 className="text-2xl font-bold text-amber-400">🍽️ {restaurantName}</h1>
          <p className="text-sm text-gray-400 mt-0.5">Live Waiting Queue</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold text-white">{queue.length}</p>
          <p className="text-xs text-gray-400">parties waiting</p>
        </div>
      </header>

      <div className="flex flex-1 gap-0 overflow-hidden">
        {/* Queue list */}
        <div className="flex-1 overflow-y-auto p-6">
          {queue.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
              <p className="text-5xl">🎉</p>
              <p className="text-lg font-medium">No one waiting right now!</p>
              <p className="text-sm">Walk-ins welcome.</p>
            </div>
          ) : (
            <div className="space-y-3 max-w-2xl">
              {queue.map((b, idx) => (
                <div
                  key={b.id}
                  className={`flex items-center gap-4 rounded-xl px-5 py-4 border ${
                    idx === 0
                      ? 'bg-amber-500/20 border-amber-500/60'
                      : 'bg-gray-800 border-gray-700'
                  }`}
                >
                  {/* Position */}
                  <span className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg ${
                    idx === 0 ? 'bg-amber-500 text-white' : 'bg-gray-700 text-gray-300'
                  }`}>
                    {idx + 1}
                  </span>

                  {/* Token + name */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 font-mono bg-gray-700 px-1.5 py-0.5 rounded">
                        #{b.token ?? '—'}
                      </span>
                      {idx === 0 && (
                        <span className="text-xs font-semibold text-amber-400 animate-pulse">● Next up</span>
                      )}
                    </div>
                    <p className="text-base font-semibold text-white mt-0.5 truncate">
                      {maskName(b.guestName)}
                    </p>
                    <p className="text-xs text-gray-400">Party of {b.partySize}</p>
                  </div>

                  {/* EWT */}
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-gray-500">Est. wait</p>
                    <p className={`text-lg font-bold ${idx === 0 ? 'text-amber-400' : 'text-gray-300'}`}>
                      ~{idx * EWT_PER_PARTY} min
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* QR panel */}
        <div className="w-72 flex-shrink-0 border-l border-gray-700 flex flex-col items-center justify-center p-8 gap-5 bg-gray-800">
          <p className="text-sm font-semibold text-gray-400 uppercase tracking-wide text-center">
            Scan to join the queue
          </p>
          <div className="bg-white p-4 rounded-2xl shadow-xl">
            <QRCode value={joinUrl} size={180} />
          </div>
          <p className="text-xs text-gray-500 text-center break-all">{joinUrl}</p>
          <button
            onClick={() => navigate('/queue/join')}
            className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-semibold transition"
          >
            Join Queue
          </button>
        </div>
      </div>
    </div>
  )
}
