import { useState, useEffect } from 'react'
import { collection, query, where, onSnapshot, doc, getDoc } from 'firebase/firestore'
import QRCode from 'react-qr-code'
import { db } from '../../firebase/config'

const TODAY = new Date().toISOString().split('T')[0]
const EWT_PER_PARTY = 20

function maskName(name = '') {
  const parts = name.trim().split(' ')
  if (parts.length === 1) return parts[0]
  return parts[0] + ' ' + parts.slice(1).map(p => p[0] + '.').join(' ')
}

function Clock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <span>{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
  )
}

export default function QueueBoard() {
  const [waiting, setWaiting]   = useState([])
  const [seated, setSeated]     = useState([])   // recently seated (today)
  const [restaurantName, setRestaurantName] = useState('Restaurant')

  const joinUrl = `${window.location.origin}${import.meta.env.BASE_URL}queue/join`

  useEffect(() => {
    getDoc(doc(db, 'restaurantSettings', 'main')).then(snap => {
      if (snap.exists()) setRestaurantName(snap.data().restaurantName ?? 'Restaurant')
    }).catch(() => {})
  }, [])

  // Live waiting queue
  useEffect(() => {
    const q = query(
      collection(db, 'bookings'),
      where('date', '==', TODAY),
      where('status', '==', 'waiting')
    )
    return onSnapshot(q, snap => {
      setWaiting(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.queueSequence ?? 0) - (b.queueSequence ?? 0))
      )
    })
  }, [])

  // Recently seated (last ~5) for "Now Serving" strip
  useEffect(() => {
    const q = query(
      collection(db, 'bookings'),
      where('date', '==', TODAY),
      where('status', '==', 'seated')
    )
    return onSnapshot(q, snap => {
      const all = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.seatedAt?.seconds ?? 0) - (a.seatedAt?.seconds ?? 0))
      setSeated(all.slice(0, 5))
    })
  }, [])

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col select-none">

      {/* Header */}
      <header className="flex items-center justify-between px-8 py-4 border-b border-gray-700 bg-gray-900">
        <div>
          <h1 className="text-2xl font-bold text-amber-400">🍽️ {restaurantName}</h1>
          <p className="text-sm text-gray-400 mt-0.5">Live Waiting Queue</p>
        </div>
        <div className="flex items-center gap-8">
          <div className="text-center">
            <p className="text-3xl font-bold text-white">{waiting.length}</p>
            <p className="text-xs text-gray-400">waiting</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold text-gray-300"><Clock /></p>
            <p className="text-xs text-gray-500">{new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</p>
          </div>
        </div>
      </header>

      {/* Now Serving strip */}
      {seated.length > 0 && (
        <div className="bg-green-900/60 border-b border-green-700/50 px-8 py-3 flex items-center gap-4 flex-wrap">
          <span className="text-xs font-bold text-green-400 uppercase tracking-widest whitespace-nowrap">✅ Now Seated</span>
          {seated.map(b => (
            <span key={b.id} className="flex items-center gap-2 bg-green-800/60 border border-green-700/50 rounded-full px-3 py-1 text-sm">
              <span className="font-mono text-green-300 text-xs">#{b.token}</span>
              <span className="font-semibold text-white">{maskName(b.guestName)}</span>
              {b.tableNumber && <span className="text-green-400 font-bold">→ T{b.tableNumber}</span>}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-1 gap-0 overflow-hidden">

        {/* Queue list */}
        <div className="flex-1 overflow-y-auto p-6">
          {waiting.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
              <p className="text-6xl">🎉</p>
              <p className="text-xl font-semibold">No one waiting right now!</p>
              <p className="text-sm">Walk-ins welcome — scan the QR to join.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 max-w-4xl">
              {waiting.map((b, idx) => (
                <div
                  key={b.id}
                  className={`flex items-center gap-4 rounded-2xl px-5 py-4 border ${
                    idx === 0
                      ? 'bg-amber-500/20 border-amber-500/50 ring-1 ring-amber-500/30'
                      : 'bg-gray-800 border-gray-700'
                  }`}
                >
                  {/* Position bubble */}
                  <span className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center font-black text-xl ${
                    idx === 0 ? 'bg-amber-500 text-white' : 'bg-gray-700 text-gray-300'
                  }`}>
                    {idx + 1}
                  </span>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-mono bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded">
                        #{b.token ?? '—'}
                      </span>
                      {idx === 0 && (
                        <span className="text-xs font-bold text-amber-400 animate-pulse">● Next up</span>
                      )}
                    </div>
                    <p className="text-lg font-bold text-white truncate">{maskName(b.guestName)}</p>
                    <p className="text-xs text-gray-400">👥 Party of {b.partySize}{b.tablePreference && b.tablePreference !== 'Any' ? ` · ${b.tablePreference}` : ''}</p>
                  </div>

                  {/* EWT */}
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-gray-500">Est. wait</p>
                    <p className={`text-xl font-bold ${idx === 0 ? 'text-amber-400' : 'text-gray-300'}`}>
                      {idx === 0 ? 'Ready!' : `~${idx * EWT_PER_PARTY}m`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* QR sidebar */}
        <div className="w-64 flex-shrink-0 border-l border-gray-700 flex flex-col items-center justify-center p-6 gap-5 bg-gray-800">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest text-center">
            Join the queue
          </p>
          <div className="bg-white p-3 rounded-2xl shadow-xl">
            <QRCode value={joinUrl} size={160} />
          </div>
          <p className="text-xs text-gray-500 text-center break-all">{joinUrl}</p>
          <p className="text-xs text-gray-500 text-center">Scan to add your name &amp; track your position</p>
        </div>

      </div>
    </div>
  )
}
