import { useState, useEffect, useRef } from 'react'
import { collection, query, where, onSnapshot, doc, getDoc } from 'firebase/firestore'
import QRCode from 'react-qr-code'
import { db } from '../../firebase/config'
import { useEwt } from '../../hooks/useEwt'

function getGreeting() {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return 'Good morning'
  if (h >= 12 && h < 17) return 'Good afternoon'
  return 'Good evening'
}

function buildCallText(template, token, name, persons) {
  return (template || '{greeting}. Token {token}, {name}, party of {persons}, please proceed to the counter.')
    .replace(/{greeting}/g, getGreeting())
    .replace(/{token}/g, token)
    .replace(/{name}/g, name)
    .replace(/{persons}/g, persons)
}

function getAvailableVoices() {
  return window.speechSynthesis?.getVoices() ?? []
}

function findVoiceForLang(lang) {
  const voices = getAvailableVoices()
  // exact match first, then prefix match (e.g. "ta" matches "ta-IN")
  return (
    voices.find(v => v.lang === lang) ||
    voices.find(v => v.lang.startsWith(lang.split('-')[0]))
  )
}

function speakCall(text, languages, repeatCount, repeatInterval) {
  if (!window.speechSynthesis) return
  const requested = languages?.length ? languages : ['en-US']
  // Filter to languages that have a voice installed; fall back to en-US if none match
  const voices = getAvailableVoices()
  let langs = requested.filter(l => findVoiceForLang(l))
  if (langs.length === 0) langs = ['en-US']
  let round = 0

  function speakRound() {
    if (round >= repeatCount) return
    round++
    let i = 0
    function next() {
      if (i >= langs.length) {
        if (round < repeatCount) setTimeout(speakRound, repeatInterval * 1000)
        return
      }
      const voice = findVoiceForLang(langs[i])
      const warmup = new SpeechSynthesisUtterance(',')
      warmup.lang = langs[i]; warmup.volume = 0; warmup.rate = 1
      if (voice) warmup.voice = voice
      warmup.onend = () => {
        const utt = new SpeechSynthesisUtterance('. . . ' + text)
        utt.lang = langs[i]; utt.rate = 0.88; utt.pitch = 1
        if (voice) utt.voice = voice
        utt.onend = () => { i++; next() }
        utt.onerror = () => { i++; next() }
        window.speechSynthesis.speak(utt)
      }
      warmup.onerror = warmup.onend
      window.speechSynthesis.speak(warmup)
    }
    next()
  }
  window.speechSynthesis.cancel()
  setTimeout(speakRound, 250)
}

const TODAY = new Date().toISOString().split('T')[0]

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
  const [seated, setSeated]     = useState([])
  const [restaurantName, setRestaurantName] = useState('Restaurant')
  const [audioUnlocked, setAudioUnlocked] = useState(false)
  const [callingBanner, setCallingBanner] = useState(null)
  const [showNowServing, setShowNowServing] = useState(true)
  const audioUnlockedRef = useRef(false)
  const pendingCall = useRef(null)
  const lastCallAt = useRef(null)
  const callSettings = useRef({ enabled: true, repeatCount: 3, repeatInterval: 5, languages: ['en-US'], template: '{greeting}. Token {token}, {name}, party of {persons}, please proceed to the counter.' })
  const { calcEwt } = useEwt()

  const joinUrl = `${window.location.origin}${import.meta.env.BASE_URL}queue/join`

  // Preload voices so findVoiceForLang works immediately
  useEffect(() => {
    const load = () => window.speechSynthesis?.getVoices()
    load()
    window.speechSynthesis?.addEventListener('voiceschanged', load)
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', load)
  }, [])

  function unlockAudio() {
    if (window.speechSynthesis) {
      const p = new SpeechSynthesisUtterance(' ')
      p.volume = 0
      window.speechSynthesis.speak(p)
    }
    audioUnlockedRef.current = true
    setAudioUnlocked(true)
    if (pendingCall.current) {
      const { text, cfg } = pendingCall.current
      pendingCall.current = null
      speakCall(text, cfg.languages, cfg.repeatCount, cfg.repeatInterval)
    }
  }

  // Restaurant settings + queueCall config
  useEffect(() => {
    getDoc(doc(db, 'restaurantSettings', 'main')).then(snap => {
      if (snap.exists()) {
        const data = snap.data()
        setRestaurantName(data.restaurantName ?? 'Restaurant')
        if (data.queueCall) callSettings.current = { ...callSettings.current, ...data.queueCall }
      }
    }).catch(() => {})
  }, [])

  // activeCall listener
  useEffect(() => {
    return onSnapshot(
      doc(db, 'restaurantSettings', 'activeCall'),
      (snap) => {
        if (!snap.exists()) return
        const data = snap.data()
        const calledAt = data.calledAt?.seconds ?? 0
        if (calledAt === lastCallAt.current) return
        lastCallAt.current = calledAt

        const cfg = callSettings.current
        if (!cfg.enabled) return

        const text = buildCallText(cfg.template, data.token, data.guestName, data.persons ?? 1)
        setCallingBanner({ token: data.token, name: data.guestName })
        setTimeout(() => setCallingBanner(null), (cfg.repeatCount * (cfg.repeatInterval + 3)) * 1000)

        if (!audioUnlockedRef.current) {
          pendingCall.current = { text, cfg }
        } else {
          speakCall(text, cfg.languages, cfg.repeatCount, cfg.repeatInterval)
        }
      },
      () => {}
    )
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
          .map(d => ({ ...d.data(), id: d.id }))
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
        .map(d => ({ ...d.data(), id: d.id }))
        .sort((a, b) => (b.seatedAt?.seconds ?? 0) - (a.seatedAt?.seconds ?? 0))
      setSeated(all.slice(0, 5))
    })
  }, [])

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col select-none" onClick={!audioUnlocked ? unlockAudio : undefined}>

      {/* Audio unlock overlay */}
      {!audioUnlocked && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 cursor-pointer">
          <div className="text-center space-y-4">
            <div className="text-6xl animate-bounce">🔊</div>
            <p className="text-2xl font-bold text-white">Tap anywhere to enable audio</p>
            <p className="text-sm text-gray-400">Required once per session — voice announcements work automatically after this</p>
          </div>
        </div>
      )}

      {/* Now Calling banner */}
      {callingBanner && (
        <div className="fixed top-0 inset-x-0 z-40 bg-amber-500 text-white px-6 py-4 flex items-center justify-center gap-4 animate-pulse shadow-2xl">
          <span className="text-3xl">📣</span>
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-widest opacity-80">Now Calling</p>
            <p className="text-2xl font-bold tracking-wide">{callingBanner.token} — {callingBanner.name}</p>
            <p className="text-sm opacity-80">Please proceed to the counter</p>
          </div>
          <span className="text-3xl">📣</span>
        </div>
      )}


      {/* Header */}
      <header className="flex items-center justify-between px-8 py-3 border-b border-gray-700 bg-gray-900">
        <div>
          <h1 className="text-2xl font-bold text-amber-400">🍽️ {restaurantName}</h1>
          <p className="text-sm text-gray-400 mt-0.5">Live Waiting Queue</p>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-center">
            <p className="text-3xl font-bold text-white">{waiting.length}</p>
            <p className="text-xs text-gray-400">waiting</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold text-gray-300"><Clock /></p>
            <p className="text-xs text-gray-500">{new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</p>
          </div>
          <button
            onClick={e => { e.stopPropagation(); setShowNowServing(v => !v) }}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-600 text-gray-400 hover:text-white hover:border-gray-400 transition-colors"
          >
            {showNowServing ? '👁 Hide Seated' : '👁 Show Seated'}
          </button>
          {/* Compact QR — top-right corner */}
          <div className="flex items-center gap-3 border-l border-gray-700 pl-6">
            <div className="bg-white p-1.5 rounded-lg shadow-lg">
              <QRCode value={joinUrl} size={56} />
            </div>
            <div>
              <p className="text-xs font-bold text-gray-300 leading-tight">Scan to join</p>
              <p className="text-xs text-gray-500 leading-tight">the queue</p>
            </div>
          </div>
        </div>
      </header>

      {/* Now Seated strip — toggled via header button */}
      {showNowServing && seated.length > 0 && (
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

      {/* Queue list — full width */}
      <div className="flex-1 overflow-y-auto p-6">
        {waiting.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-3">
            <p className="text-6xl">🎉</p>
            <p className="text-xl font-semibold">No one waiting right now!</p>
            <p className="text-sm">Walk-ins welcome — scan the QR to join.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {/* Precompute cumulative persons-ahead once — O(n) */}
            {(() => {
              let cum = 0;
              const ewtData = waiting.map(b => {
                const ewt = calcEwt(b.tablePreference ?? 'Any', cum);
                cum += b.partySize || 2;
                return ewt;
              });
              return waiting.map((b, idx) => (
              <div
                key={b.id}
                className={`flex items-center gap-4 rounded-2xl px-5 py-4 border ${
                  idx === 0
                    ? 'bg-amber-500/20 border-amber-500/50 ring-1 ring-amber-500/30'
                    : 'bg-gray-800 border-gray-700'
                }`}
              >
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
                  <p className="text-xs text-gray-400">👥 {b.partySize}{b.tablePreference && b.tablePreference !== 'Any' ? ` · ${b.tablePreference}` : ''}</p>
                </div>

                {/* EWT — precomputed above */}
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-gray-500">Est. wait</p>
                  {(() => {
                    const ewt = ewtData[idx];
                    return (
                      <p className={`text-xl font-bold ${idx === 0 ? 'text-amber-400' : 'text-gray-300'}`}>
                        {ewt === 0 ? (idx === 0 ? 'Ready!' : 'Soon') : `~${ewt}m`}
                      </p>
                    )
                  })()}
                </div>
              </div>
            ));
            })()}
          </div>
        )}
      </div>
    </div>
  )
}
