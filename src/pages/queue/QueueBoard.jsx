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

function speakCall(text, languages, repeatCount, repeatInterval, onLog) {
  if (!window.speechSynthesis) { onLog?.('ERROR: speechSynthesis not available'); return }
  const langs = languages?.length ? languages : ['en-US']
  let round = 0
  onLog?.(`Speaking: "${text}" langs=${langs.join(',')} repeat=${repeatCount}`)

  function speakRound() {
    if (round >= repeatCount) { onLog?.('All repeats done'); return }
    round++
    let i = 0
    function next() {
      if (i >= langs.length) {
        if (round < repeatCount) setTimeout(speakRound, repeatInterval * 1000)
        return
      }
      const warmup = new SpeechSynthesisUtterance(',')
      warmup.lang = langs[i]; warmup.volume = 0; warmup.rate = 1
      warmup.onend = () => {
        const utt = new SpeechSynthesisUtterance('. . . ' + text)
        utt.lang = langs[i]; utt.rate = 0.88; utt.pitch = 1
        utt.onstart = () => onLog?.(`▶ [${langs[i]}]`)
        utt.onend = () => { onLog?.(`✓ [${langs[i]}]`); i++; next() }
        utt.onerror = (e) => { onLog?.(`✗ [${langs[i]}] ${e.error}`); i++; next() }
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
  const [showDiag, setShowDiag] = useState(false)
  const [diagLogs, setDiagLogs] = useState([])
  const [diagInfo, setDiagInfo] = useState({ synthAvailable: !!window.speechSynthesis, voices: [], lastCall: null, settingsReceived: false })
  const audioUnlockedRef = useRef(false)
  const pendingCall = useRef(null)
  const lastCallAt = useRef(null)
  const callSettings = useRef({ enabled: true, repeatCount: 3, repeatInterval: 5, languages: ['en-US'], template: '{greeting}. Token {token}, {name}, party of {persons}, please proceed to the counter.' })
  const { calcEwt } = useEwt()

  const joinUrl = `${window.location.origin}${import.meta.env.BASE_URL}queue/join`

  function diagLog(msg) {
    const ts = new Date().toLocaleTimeString()
    setDiagLogs(prev => [`[${ts}] ${msg}`, ...prev].slice(0, 30))
  }

  // Load available voices
  useEffect(() => {
    const load = () => setDiagInfo(d => ({ ...d, voices: window.speechSynthesis?.getVoices().map(v => `${v.name} (${v.lang})`) ?? [] }))
    load()
    window.speechSynthesis?.addEventListener('voiceschanged', load)
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', load)
  }, [])

  function unlockAudio() {
    diagLog('Tap received — unlocking audio')
    if (window.speechSynthesis) {
      const p = new SpeechSynthesisUtterance(' ')
      p.volume = 0
      p.onend = () => diagLog('Primer done — audio unlocked')
      p.onerror = (e) => diagLog(`Primer error: ${e.error}`)
      window.speechSynthesis.speak(p)
    } else {
      diagLog('ERROR: window.speechSynthesis undefined')
    }
    audioUnlockedRef.current = true
    setAudioUnlocked(true)
    if (pendingCall.current) {
      diagLog('Playing queued call')
      const { text, cfg } = pendingCall.current
      pendingCall.current = null
      speakCall(text, cfg.languages, cfg.repeatCount, cfg.repeatInterval, diagLog)
    }
  }

  // Restaurant settings + queueCall config
  useEffect(() => {
    getDoc(doc(db, 'restaurantSettings', 'main')).then(snap => {
      if (snap.exists()) {
        const data = snap.data()
        setRestaurantName(data.restaurantName ?? 'Restaurant')
        if (data.queueCall) {
          callSettings.current = { ...callSettings.current, ...data.queueCall }
          setDiagInfo(d => ({ ...d, settingsReceived: true, queueCall: data.queueCall }))
          diagLog(`Settings loaded — enabled=${data.queueCall.enabled}, langs=${(data.queueCall.languages||[]).join(',')}`)
        }
      }
    }).catch(() => {})
  }, [])

  // activeCall listener
  useEffect(() => {
    diagLog('activeCall listener registered')
    return onSnapshot(
      doc(db, 'restaurantSettings', 'activeCall'),
      (snap) => {
        if (!snap.exists()) { diagLog('activeCall doc not found'); return }
        const data = snap.data()
        const calledAt = data.calledAt?.seconds ?? 0
        diagLog(`Snapshot — token=${data.token} calledAt=${calledAt} last=${lastCallAt.current}`)
        if (calledAt === lastCallAt.current) { diagLog('Duplicate, skipping'); return }
        lastCallAt.current = calledAt
        setDiagInfo(d => ({ ...d, lastCall: { token: data.token, name: data.guestName, calledAt } }))

        const cfg = callSettings.current
        diagLog(`cfg.enabled=${cfg.enabled} audioUnlocked=${audioUnlockedRef.current}`)
        if (!cfg.enabled) { diagLog('Voice disabled in settings'); return }

        const text = buildCallText(cfg.template, data.token, data.guestName, data.persons ?? 1)
        diagLog(`Text: "${text}"`)
        setCallingBanner({ token: data.token, name: data.guestName })
        setTimeout(() => setCallingBanner(null), (cfg.repeatCount * (cfg.repeatInterval + 3)) * 1000)

        if (!audioUnlockedRef.current) {
          diagLog('Audio locked — queuing call')
          pendingCall.current = { text, cfg }
        } else {
          speakCall(text, cfg.languages, cfg.repeatCount, cfg.repeatInterval, diagLog)
        }
      },
      (err) => diagLog(`Listener ERROR: ${err.message}`)
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

      {/* Diag button */}
      <button
        onClick={e => { e.stopPropagation(); setShowDiag(v => !v) }}
        className="fixed bottom-3 right-3 z-[60] bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white text-xs px-3 py-1.5 rounded-lg border border-gray-500 transition-colors shadow-lg"
      >
        🔬 Diag
      </button>

      {/* Diagnostic panel */}
      {showDiag && (
        <div className="fixed inset-0 z-50 bg-black/90 text-green-300 font-mono text-xs p-4 overflow-y-auto flex flex-col gap-3" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-white font-bold text-sm">🔬 QueueBoard Diagnostics</span>
            <button onClick={() => setShowDiag(false)} className="text-white text-lg px-2">✕</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className={`rounded p-2 ${diagInfo.synthAvailable ? 'bg-green-900' : 'bg-red-900'}`}>
              <div className="text-white font-semibold">Speech API</div>
              <div>{diagInfo.synthAvailable ? '✓ Available' : '✗ NOT available'}</div>
            </div>
            <div className={`rounded p-2 ${audioUnlocked ? 'bg-green-900' : 'bg-yellow-900'}`}>
              <div className="text-white font-semibold">Audio unlock</div>
              <div>{audioUnlocked ? '✓ Unlocked' : '⚠ Waiting for tap'}</div>
            </div>
            <div className={`rounded p-2 ${diagInfo.settingsReceived ? 'bg-green-900' : 'bg-red-900'}`}>
              <div className="text-white font-semibold">Settings loaded</div>
              <div>{diagInfo.settingsReceived ? `✓ enabled=${diagInfo.queueCall?.enabled}` : '✗ Not received'}</div>
            </div>
            <div className={`rounded p-2 ${diagInfo.lastCall ? 'bg-green-900' : 'bg-gray-800'}`}>
              <div className="text-white font-semibold">Last call</div>
              <div>{diagInfo.lastCall ? `${diagInfo.lastCall.token} — ${diagInfo.lastCall.name}` : 'None yet'}</div>
            </div>
          </div>
          {diagInfo.queueCall && (
            <div className="bg-gray-900 rounded p-2 space-y-0.5">
              <div className="text-white font-semibold mb-1">Queue call config</div>
              <div>enabled: <span className="text-yellow-300">{String(diagInfo.queueCall.enabled)}</span></div>
              <div>repeat: <span className="text-yellow-300">{diagInfo.queueCall.repeatCount}×</span> every <span className="text-yellow-300">{diagInfo.queueCall.repeatInterval}s</span></div>
              <div>languages: <span className="text-yellow-300">{(diagInfo.queueCall.languages || []).join(', ')}</span></div>
              <div>template: <span className="text-yellow-300">{diagInfo.queueCall.template}</span></div>
            </div>
          )}
          <div className="bg-gray-900 rounded p-2">
            <div className="text-white font-semibold mb-1">Available voices ({diagInfo.voices.length})</div>
            {diagInfo.voices.length === 0
              ? <div className="text-red-400">No voices loaded</div>
              : <div className="max-h-32 overflow-y-auto space-y-0.5">{diagInfo.voices.map((v, i) => <div key={i}>{v}</div>)}</div>
            }
          </div>
          <button
            onClick={() => {
              diagLog('Manual test speak')
              const cfg = callSettings.current
              speakCall('Testing. Good morning. Token A 1, John, party of 2, please proceed to the counter.', cfg.languages, 1, 0, diagLog)
            }}
            className="bg-indigo-700 hover:bg-indigo-600 text-white rounded px-4 py-2 text-sm font-semibold"
          >
            ▶ Test Speak Now
          </button>
          <div className="bg-gray-900 rounded p-2 flex-1">
            <div className="text-white font-semibold mb-1">Event log</div>
            <div className="space-y-0.5 max-h-48 overflow-y-auto">
              {diagLogs.length === 0
                ? <div className="text-gray-500">No events yet</div>
                : diagLogs.map((l, i) => <div key={i}>{l}</div>)
              }
            </div>
          </div>
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

      {/* Now Serving strip — hidden on queue board */}
      {false && seated.length > 0 && (
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
