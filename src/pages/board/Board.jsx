import { useState, useEffect, useRef } from 'react';
import { collection, query, onSnapshot, orderBy, doc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useEwt } from '../../hooks/useEwt';

function isToday(ts) {
  const date = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
  if (!date) return false;
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Good morning';
  if (h >= 12 && h < 17) return 'Good afternoon';
  return 'Good evening';
}

function buildText(template, token, name, persons) {
  return (template || '{greeting}. Token {token}, {name}, party of {persons}, please proceed to the counter.')
    .replace(/{greeting}/g, getGreeting())
    .replace(/{token}/g, token)
    .replace(/{name}/g, name)
    .replace(/{persons}/g, persons);
}

function getAvailableVoices() {
  return window.speechSynthesis?.getVoices() ?? [];
}

function findVoiceForLang(lang) {
  const voices = getAvailableVoices();
  return (
    voices.find(v => v.lang === lang) ||
    voices.find(v => v.lang.startsWith(lang.split('-')[0]))
  );
}

function speakInLanguages(text, languages, repeatCount, repeatInterval) {
  if (!window.speechSynthesis) return;
  const requested = languages?.length ? languages : ['en-US'];
  let langs = requested.filter(l => findVoiceForLang(l));
  if (langs.length === 0) langs = ['en-US'];
  let round = 0;

  function speakRound() {
    if (round >= repeatCount) return;
    round++;
    let i = 0;
    function speakNext() {
      if (i >= langs.length) {
        if (round < repeatCount) setTimeout(speakRound, repeatInterval * 1000);
        return;
      }
      const voice = findVoiceForLang(langs[i]);
      const warmup = new SpeechSynthesisUtterance(',');
      warmup.lang = langs[i]; warmup.volume = 0; warmup.rate = 1;
      if (voice) warmup.voice = voice;
      warmup.onend = () => {
        const utt = new SpeechSynthesisUtterance('. . . ' + text);
        utt.lang = langs[i]; utt.rate = 0.88; utt.pitch = 1;
        if (voice) utt.voice = voice;
        utt.onend = () => { i++; speakNext(); };
        utt.onerror = () => { i++; speakNext(); };
        window.speechSynthesis.speak(utt);
      };
      warmup.onerror = warmup.onend;
      window.speechSynthesis.speak(warmup);
    }
    speakNext();
  }

  window.speechSynthesis.cancel();
  setTimeout(speakRound, 250);
}

const CARD_GAP = 12;
// Minimum tokens that must be visible per mode
const MIN_COUNTS = { large: 10, medium: 20, small: 30 };
// In small mode, first N tokens are rendered at medium size
const SMALL_FEATURED = 3;

function maskName(name = '') {
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0];
  return parts[0] + ' ' + parts.slice(1).map(p => p[0] + '.').join(' ');
}

// Find card dimensions so that minCount cards fill cW×cH
function calcFit(cW, cH, minCount, gap) {
  let best = { w: 80, h: 100 };
  let bestArea = 0;
  for (let cols = 1; cols <= minCount; cols++) {
    const rows = Math.ceil(minCount / cols);
    const w = (cW - (cols - 1) * gap) / cols;
    const h = (cH - (rows - 1) * gap) / rows;
    if (w >= 60 && h >= 60 && w * h > bestArea) {
      bestArea = w * h;
      best = { w: Math.floor(w), h: Math.floor(h) };
    }
  }
  return best;
}

function tokenFontClass(h) {
  if (h < 120) return 'text-xl';
  if (h < 160) return 'text-2xl';
  if (h < 200) return 'text-3xl';
  if (h < 250) return 'text-4xl';
  return 'text-5xl';
}

function TokenCard({ b, globalIdx, card, ewtData, animDelay }) {
  const isNext = globalIdx === 0;
  const ewt = ewtData[globalIdx];
  return (
    <div
      key={b.id}
      style={{
        width: card.w,
        height: card.h,
        flexShrink: 0,
        animation: `tokenSlideIn 0.4s ease both ${animDelay}ms${isNext ? ', tokenPulseGlow 2.4s ease-in-out infinite' : ''}`,
      }}
      className={`rounded-2xl border flex flex-col items-center justify-center gap-1 px-2
        ${isNext ? 'bg-amber-500/20 border-amber-500/60' : 'bg-gray-800 border-gray-700'}`}
    >
      <div className={`${tokenFontClass(card.h)} font-black tracking-tight ${isNext ? 'text-amber-400' : 'text-white'}`}>
        {b.token ?? b.tokenNumber ?? b.queueSequence ?? '—'}
      </div>
      <div className="text-xs font-semibold text-gray-200 text-center truncate w-full px-1">
        {maskName(b.guestName || 'Guest')}
      </div>
      {card.h >= 130 && (
        <div className="text-xs text-gray-400">
          👥 {b.partySize}{b.tablePreference && b.tablePreference !== 'Any' ? ` · ${b.tablePreference}` : ''}
        </div>
      )}
      {card.h >= 110 && (
        <div className={`text-xs font-bold px-2 py-0.5 rounded-full mt-0.5 ${
          isNext ? 'bg-amber-500 text-white' : 'bg-gray-700 text-gray-300'
        }`}>
          {isNext && ewt === 0 ? '● Ready!' : ewt === 0 ? 'Soon' : `~${ewt}m`}
        </div>
      )}
      {isNext && card.h >= 140 && (
        <div className="text-xs font-bold text-amber-400 animate-pulse">Next up</div>
      )}
    </div>
  );
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
  );
}

function QueueGrid({ waiting, calcEwt, cardSize = 'medium' }) {
  const containerRef = useRef(null);
  const [containerDims, setContainerDims] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function measure() {
      const { width, height } = el.getBoundingClientRect();
      setContainerDims({ w: width, h: height });
    }
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w: cW, h: cH } = containerDims;

  // Precompute EWT for all tokens
  let cum = 0;
  const ewtData = waiting.map(b => {
    const ewt = calcEwt(b.tablePreference ?? 'Any', cum);
    cum += b.partySize || 2;
    return ewt;
  });

  // Compute card sizes only once container is measured
  const medCard = cW && cH ? calcFit(cW, cH, MIN_COUNTS.medium, CARD_GAP) : { w: 200, h: 220 };
  const isSmall = cardSize === 'small';
  const isLarge = cardSize === 'large';

  // Featured row (small mode): first SMALL_FEATURED tokens use medium-sized cards
  const featCard = isSmall ? medCard : null;
  const featCount = isSmall ? Math.min(SMALL_FEATURED, waiting.length) : 0;
  const featRowH = featCard ? featCard.h + CARD_GAP : 0;

  // Main grid card size
  const mainMinCount = isSmall
    ? Math.max(1, MIN_COUNTS.small - SMALL_FEATURED)
    : MIN_COUNTS[cardSize] ?? MIN_COUNTS.medium;
  const mainAvailH = cW && cH ? Math.max(60, cH - featRowH) : cH || 400;
  const mainCard = cW && cH ? calcFit(cW, mainAvailH, mainMinCount, CARD_GAP) : { w: 150, h: 170 };

  // How many main cards fit
  const mainCols = mainCard.w ? Math.max(1, Math.floor((cW + CARD_GAP) / (mainCard.w + CARD_GAP))) : 1;
  const mainRows = mainCard.h ? Math.max(1, Math.floor((mainAvailH + CARD_GAP) / (mainCard.h + CARD_GAP))) : 1;
  const maxMain = mainCols * mainRows;

  const totalMax = featCount + maxMain;
  const overflow = waiting.length > totalMax;
  const featItems = waiting.slice(0, featCount);
  const mainItems = overflow
    ? waiting.slice(featCount, totalMax - 1)
    : waiting.slice(featCount);
  const overflowCount = overflow ? waiting.length - (totalMax - 1) : 0;

  if (waiting.length === 0) {
    return (
      <div ref={containerRef} className="flex-1 flex items-center justify-center text-gray-600 text-base p-6">
        Queue is empty
      </div>
    );
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

      {/* Featured row — first 3 at medium size (small mode only) */}
      {featItems.length > 0 && (
        <div style={{ display: 'flex', gap: CARD_GAP, flexShrink: 0 }}>
          {featItems.map((b, idx) => (
            <TokenCard key={b.id} b={b} globalIdx={idx} card={featCard} ewtData={ewtData} animDelay={idx * 40} />
          ))}
        </div>
      )}

      {/* Main grid */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: CARD_GAP, alignContent: 'flex-start', overflow: 'hidden' }}>
        {mainItems.map((b, idx) => (
          <TokenCard key={b.id} b={b} globalIdx={featCount + idx} card={mainCard} ewtData={ewtData} animDelay={(featCount + idx) * 40} />
        ))}
        {overflow && <OverflowCard card={mainCard} count={overflowCount} />}
      </div>
    </div>
  );
}

export default function Board() {
  const [bookings, setBookings] = useState([]);
  const [restaurantName, setRestaurantName] = useState('Restaurant');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [callingBanner, setCallingBanner] = useState(null);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [showSeated, setShowSeated] = useState(true);
  const [tokenCardSize, setTokenCardSize] = useState('medium');
  const audioUnlockedRef = useRef(false);
  const queueCallSettings = useRef({ enabled: true, repeatCount: 3, repeatInterval: 5, languages: ['en-US'], template: '{greeting}. Token {token}, {name}, party of {persons}, please proceed to the counter.' });
  const lastCallAt = useRef(null);
  const pendingCall = useRef(null);
  const { calcEwt } = useEwt();

  // Preload voices so findVoiceForLang works immediately
  useEffect(() => {
    const load = () => window.speechSynthesis?.getVoices();
    load();
    window.speechSynthesis?.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', load);
  }, []);

  function unlockAudio() {
    if (window.speechSynthesis) {
      const primer = new SpeechSynthesisUtterance(' ');
      primer.volume = 0;
      window.speechSynthesis.speak(primer);
    }
    audioUnlockedRef.current = true;
    setAudioUnlocked(true);
    if (pendingCall.current) {
      const { text, cfg } = pendingCall.current;
      pendingCall.current = null;
      speakInLanguages(text, cfg.languages, cfg.repeatCount, cfg.repeatInterval);
    }
  }

  // Clock
  useEffect(() => {
    const id = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Firestore: bookings listener
  useEffect(() => {
    const q = query(collection(db, 'bookings'), orderBy('queueSequence', 'asc'));
    return onSnapshot(q, (snap) => {
      const docs = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      setBookings(docs.filter(b =>
        isToday(b.createdAt || b.date) &&
        (b.status === 'waiting' || b.status === 'seated')
      ));
    });
  }, []);

  // Firestore: restaurantSettings
  useEffect(() => {
    const q = query(collection(db, 'restaurantSettings'), orderBy('createdAt', 'asc'));
    return onSnapshot(q, (snap) => {
      if (!snap.empty) {
        const data = snap.docs[0].data();
        if (data.restaurantName) setRestaurantName(data.restaurantName);
        if (data.queueCall) queueCallSettings.current = { ...queueCallSettings.current, ...data.queueCall };
        if (data.tokenCardSize) setTokenCardSize(data.tokenCardSize);
      }
    });
  }, []);

  // Firestore: activeCall listener
  useEffect(() => {
    return onSnapshot(
      doc(db, 'restaurantSettings', 'activeCall'),
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        const calledAt = data.calledAt?.seconds ?? 0;
        if (calledAt === lastCallAt.current) return;
        lastCallAt.current = calledAt;

        const cfg = queueCallSettings.current;
        if (!cfg.enabled) return;

        const text = buildText(cfg.template, data.token, data.guestName, data.persons ?? 1);
        setCallingBanner({ token: data.token, name: data.guestName });
        setTimeout(() => setCallingBanner(null), (cfg.repeatCount * (cfg.repeatInterval + 3)) * 1000);

        if (!audioUnlockedRef.current) {
          pendingCall.current = { text, cfg };
        } else {
          speakInLanguages(text, cfg.languages, cfg.repeatCount, cfg.repeatInterval);
        }
      },
      () => {}
    );
  }, []);

  const seatedTokens = bookings.filter((b) => b.status === 'seated');
  const waitingTokens = bookings.filter((b) => b.status === 'waiting');

  const pad = (n) => String(n).padStart(2, '0');
  const timeString =
    pad(currentTime.getHours()) + ':' +
    pad(currentTime.getMinutes()) + ':' +
    pad(currentTime.getSeconds());

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col overflow-hidden" onClick={!audioUnlocked ? unlockAudio : undefined}>

      {/* Audio unlock overlay */}
      {!audioUnlocked && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 cursor-pointer select-none">
          <div className="text-center space-y-4">
            <div className="text-6xl animate-bounce">🔊</div>
            <p className="text-2xl font-bold text-white">Tap anywhere to enable audio</p>
            <p className="text-sm text-gray-400">Required once per session — voice announcements will work automatically after this</p>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="flex items-center justify-between px-4 md:px-8 py-4 md:py-5 bg-gray-800 border-b border-gray-700">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-wide">{restaurantName}</h1>
          <p className="text-sm text-indigo-400 font-medium mt-0.5 uppercase tracking-widest">Live Queue Board</p>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={e => { e.stopPropagation(); setShowSeated(v => !v); }}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-600 text-gray-400 hover:text-white hover:border-gray-400 transition-colors"
          >
            {showSeated ? '👁 Hide Seated' : '👁 Show Seated'}
          </button>
          <p className="text-3xl font-mono font-bold text-indigo-300">{timeString}</p>
        </div>
      </header>

      {/* Now Calling banner */}
      {callingBanner && (
        <div className="bg-amber-500 text-white px-6 py-4 flex items-center justify-center gap-4 animate-pulse">
          <span className="text-3xl">📣</span>
          <div className="text-center">
            <p className="text-sm font-semibold uppercase tracking-widest opacity-80">Now Calling</p>
            <p className="text-2xl font-bold tracking-wide">{callingBanner.token} — {callingBanner.name}</p>
            <p className="text-sm opacity-80">Please proceed to the counter</p>
          </div>
          <span className="text-3xl">📣</span>
        </div>
      )}

      {/* Main content */}
      <main className="flex flex-col md:flex-row flex-1 gap-0 overflow-hidden">

        {/* Now Serving — 25% width, shown only when toggled on */}
        {showSeated && (
          <section className="w-full md:w-1/4 flex flex-col p-6 md:p-8 border-b md:border-b-0 md:border-r border-gray-700 overflow-y-auto">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-indigo-400 mb-6">Now Serving</h2>
            {seatedTokens.length === 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-gray-600 text-xl">No guests currently seated</p>
              </div>
            ) : (
              <div className="grid gap-4">
                {seatedTokens.map((b) => (
                  <div key={b.id} className="bg-indigo-700 rounded-2xl p-6 flex items-center gap-6 shadow-lg">
                    <div className="flex items-center justify-center w-20 h-20 rounded-full bg-indigo-500 text-white font-extrabold text-3xl shrink-0">
                      {b.token || b.tokenNumber || b.queueSequence || '–'}
                    </div>
                    <div className="min-w-0">
                      <p className="text-2xl font-bold text-white truncate">{b.guestName || 'Guest'}</p>
                      {b.tableNumber && (
                        <p className="text-indigo-200 text-sm mt-1">Table <span className="font-semibold text-white">{b.tableNumber}</span></p>
                      )}
                      {b.partySize && <p className="text-indigo-300 text-xs mt-0.5">{b.partySize} guests</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Waiting — fills remaining space */}
        <section className="flex flex-col flex-1 overflow-hidden bg-gray-800/50">
          <div className="px-6 pt-6 pb-2">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-yellow-400">Waiting</h2>
          </div>
          <QueueGrid waiting={waitingTokens} calcEwt={calcEwt} cardSize={tokenCardSize} />
        </section>
      </main>

      {/* Bottom ticker */}
      <footer className="bg-indigo-800 py-3 overflow-hidden">
        <div className="flex animate-marquee whitespace-nowrap">
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className="mx-12 text-indigo-200 font-medium text-sm tracking-wide">
              Please listen for your token number &nbsp;•&nbsp; Thank you for your patience
            </span>
          ))}
        </div>
      </footer>

      <style>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-marquee { animation: marquee 30s linear infinite; }
      `}</style>
    </div>
  );
}
