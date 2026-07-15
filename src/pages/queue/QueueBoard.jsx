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

const CARD_GAP = 12
const MIN_COUNTS = { large: 10, medium: 20, small: 30 }
const SMALL_FEATURED = 3

function maskName(name = '') {
  const parts = name.trim().split(' ')
  if (parts.length === 1) return parts[0]
  return parts[0] + ' ' + parts.slice(1).map(p => p[0] + '.').join(' ')
}

function calcFit(cW, cH, minCount, gap) {
  let best = { w: 80, h: 100 }
  let bestArea = 0
  for (let cols = 1; cols <= minCount; cols++) {
    const rows = Math.ceil(minCount / cols)
    const w = (cW - (cols - 1) * gap) / cols
    const h = (cH - (rows - 1) * gap) / rows
    if (w >= 60 && h >= 60 && w * h > bestArea) {
      bestArea = w * h
      best = { w: Math.floor(w), h: Math.floor(h) }
    }
  }
  return best
}

function tokenFontClass(h) {
  if (h < 120) return 'text-xl'
  if (h < 160) return 'text-2xl'
  if (h < 200) return 'text-3xl'
  if (h < 250) return 'text-4xl'
  return 'text-5xl'
}

function TokenCard({ b, globalIdx, card, ewtData, animDelay }) {
  const isNext = globalIdx === 0
  const ewt = ewtData[globalIdx]
  return (
    <div
      style={{
        width: card.w, height: card.h, flexShrink: 0,
        animation: `tokenSlideIn 0.4s ease both ${animDelay}ms${isNext ? ', tokenPulseGlow 2.4s ease-in-out infinite' : ''}`,
      }}
      className={`rounded-2xl border flex flex-col items-center justify-center gap-1 px-2
        ${isNext ? 'bg-amber-500/20 border-amber-500/60' : 'bg-gray-800 border-gray-700'}`}
    >
      <div className={`${tokenFontClass(card.h)} font-black tracking-tight ${isNext ? 'text-amber-400' : 'text-white'}`}>
        {b.token ?? '—'}
      </div>
      <div className="text-xs font-semibold text-gray-200 text-center truncate w-full px-1">
        {maskName(b.guestName)}
      </div>
      {card.h >= 130 && (
        <div className="text-xs text-gray-400">
          👥 {b.partySize}{b.tablePreference && b.tablePreference !== 'Any' ? ` · ${b.tablePreference}` : ''}
        </div>
      )}
      {card.h >= 110 && (
        <div className={`text-xs font-bold px-2 py-0.5 rounded-full mt-0.5 ${isNext ? 'bg-amber-500 text-white' : 'bg-gray-700 text-gray-300'}`}>
          {isNext && ewt === 0 ? '● Ready!' : ewt === 0 ? 'Soon' : `~${ewt}m`}
        </div>
      )}
      {isNext && card.h >= 140 && (
        <div className="text-xs font-bold text-amber-400 animate-pulse">Next up</div>
      )}
    </div>
  )
}

function OverflowCard({ card, count }) {
  return (
    <div
      style={{ width: card.w, height: card.h, flexShrink: 0, animation: 'tokenSlideIn 0.4s ease both' }}
      className="rounded-2xl border border-gray-600 bg-gray-800/60 flex flex-col items-center justify-center gap-1 px-2"
    >
      <div className="text-2xl">⏳</div>
      <div className="text-sm font-bold text-gray-300 text-center">+{count} more</div>
      <div className="text-xs text-gray-500 text-center">in queue</div>
    </div>
  )
}

function QueueGrid({ waiting, calcEwt, cardSize = 'medium' }) {
  const containerRef = useRef(null)
  const [containerDims, setContainerDims] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    function measure() {
      const { width, height } = el.getBoundingClientRect()
      setContainerDims({ w: width, h: height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { w: cW, h: cH } = containerDims

  let cum = 0
  const ewtData = waiting.map(b => {
    const ewt = calcEwt(b.tablePreference ?? 'Any', cum)
    cum += b.partySize || 2
    return ewt
  })

  const medCard = cW && cH ? calcFit(cW, cH, MIN_COUNTS.medium, CARD_GAP) : { w: 200, h: 220 }
  const isSmall = cardSize === 'small'
  const featCount = isSmall ? Math.min(SMALL_FEATURED, waiting.length) : 0
  const featCard = isSmall ? medCard : null
  const featRowH = featCard ? featCard.h + CARD_GAP : 0
  const mainMinCount = isSmall ? Math.max(1, MIN_COUNTS.small - SMALL_FEATURED) : (MIN_COUNTS[cardSize] ?? MIN_COUNTS.medium)
  const mainAvailH = cW && cH ? Math.max(60, cH - featRowH) : 400
  const mainCard = cW && cH ? calcFit(cW, mainAvailH, mainMinCount, CARD_GAP) : { w: 150, h: 170 }
  const mainCols = mainCard.w ? Math.max(1, Math.floor((cW + CARD_GAP) / (mainCard.w + CARD_GAP))) : 1
  const mainRows = mainCard.h ? Math.max(1, Math.floor((mainAvailH + CARD_GAP) / (mainCard.h + CARD_GAP))) : 1
  const maxMain = mainCols * mainRows
  const totalMax = featCount + maxMain
  const overflow = waiting.length > totalMax
  const featItems = waiting.slice(0, featCount)
  const mainItems = overflow ? waiting.slice(featCount, totalMax - 1) : waiting.slice(featCount)
  const overflowCount = overflow ? waiting.length - (totalMax - 1) : 0

  if (waiting.length === 0) {
    return (
      <div ref={containerRef} className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-3 p-6">
        <p className="text-6xl">🎉</p>
        <p className="text-xl font-semibold">No one waiting right now!</p>
        <p className="text-sm">Walk-ins welcome — scan the QR to join.</p>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-hidden p-3 flex flex-col" style={{ gap: CARD_GAP }}>
      <style>{`
        @keyframes tokenSlideIn {
          from { opacity: 0; transform: translateY(16px) scale(0.94); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes tokenPulseGlow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(245,158,11,0); }
          50%       { box-shadow: 0 0 20px 5px rgba(245,158,11,0.35); }
        }
      `}</style>

      {featItems.length > 0 && (
        <div style={{ display: 'flex', gap: CARD_GAP, flexShrink: 0 }}>
          {featItems.map((b, idx) => (
            <TokenCard key={b.id} b={b} globalIdx={idx} card={featCard} ewtData={ewtData} animDelay={idx * 40} />
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: CARD_GAP, alignContent: 'flex-start', overflow: 'hidden' }}>
        {mainItems.map((b, idx) => (
          <TokenCard key={b.id} b={b} globalIdx={featCount + idx} card={mainCard} ewtData={ewtData} animDelay={(featCount + idx) * 40} />
        ))}
        {overflow && <OverflowCard card={mainCard} count={overflowCount} />}
      </div>
    </div>
  )
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
  const [tokenCardSize, setTokenCardSize] = useState('medium')
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
        if (data.tokenCardSize) setTokenCardSize(data.tokenCardSize)
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

      {/* Now Seated strip — hidden on queue board */}
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

      {/* Queue grid — fixed-size animated token cards */}
      <QueueGrid waiting={waiting} calcEwt={calcEwt} cardSize={tokenCardSize} />
    </div>
  )
}
