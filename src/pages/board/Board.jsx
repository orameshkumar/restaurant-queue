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
  if (h >= 17 && h < 21) return 'Good evening';
  return 'Good evening';
}

function buildText(template, token, name, persons) {
  const greeting = getGreeting();
  return (template || '{greeting}. Token {token}, {name}, party of {persons}, please proceed to the counter.')
    .replace(/{greeting}/g, greeting)
    .replace(/{token}/g, token)
    .replace(/{name}/g, name)
    .replace(/{persons}/g, persons);
}

function speakInLanguages(text, languages, repeatCount, repeatInterval, onLog) {
  if (!window.speechSynthesis) { onLog?.('ERROR: window.speechSynthesis not available'); return; }
  const langs = (languages && languages.length) ? languages : ['en-US'];
  let round = 0;
  onLog?.(`Speaking: "${text}" | langs=${langs.join(',')} | repeat=${repeatCount} every ${repeatInterval}s`);

  function speakRound() {
    if (round >= repeatCount) { onLog?.('All repeats done'); return; }
    round++;
    onLog?.(`Round ${round}/${repeatCount}`);
    let i = 0;

    function speakNext() {
      if (i >= langs.length) {
        if (round < repeatCount) setTimeout(speakRound, repeatInterval * 1000);
        return;
      }
      const warmup = new SpeechSynthesisUtterance(',');
      warmup.lang = langs[i];
      warmup.volume = 0;
      warmup.rate = 1;
      warmup.onend = () => {
        onLog?.(`Warmup done for lang ${langs[i]}, speaking main text`);
        const utt = new SpeechSynthesisUtterance('. . . ' + text);
        utt.lang = langs[i];
        utt.rate = 0.88;
        utt.pitch = 1;
        utt.onstart = () => onLog?.(`▶ Speaking [${langs[i]}]`);
        utt.onend = () => { onLog?.(`✓ Done [${langs[i]}]`); i++; speakNext(); };
        utt.onerror = (e) => { onLog?.(`✗ Error [${langs[i]}]: ${e.error}`); i++; speakNext(); };
        window.speechSynthesis.speak(utt);
      };
      warmup.onerror = (e) => { onLog?.(`Warmup error [${langs[i]}]: ${e.error}`); warmup.onend(); };
      window.speechSynthesis.speak(warmup);
    }

    speakNext();
  }

  window.speechSynthesis.cancel();
  setTimeout(speakRound, 250);
}

export default function Board() {
  const [bookings, setBookings] = useState([]);
  const [restaurantName, setRestaurantName] = useState('Restaurant');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [callingBanner, setCallingBanner] = useState(null);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const audioUnlockedRef = useRef(false);
  const queueCallSettings = useRef({ enabled: true, repeatCount: 3, repeatInterval: 5, languages: ['en-US'], template: '{greeting}. Token {token}, {name}, party of {persons}, please proceed to the counter.' });
  const lastCallAt = useRef(null);
  const pendingCall = useRef(null);
  const [showDiag, setShowDiag] = useState(false);
  const [diagLogs, setDiagLogs] = useState([]);
  const [diagInfo, setDiagInfo] = useState({ synthAvailable: false, voices: [], lastCall: null, settingsReceived: false });
  const { calcEwt } = useEwt();

  function diagLog(msg) {
    const ts = new Date().toLocaleTimeString();
    setDiagLogs(prev => [`[${ts}] ${msg}`, ...prev].slice(0, 30));
  }

  // Populate static diag info once on mount
  useEffect(() => {
    const synthAvailable = !!window.speechSynthesis;
    const loadVoices = () => {
      const voices = window.speechSynthesis?.getVoices().map(v => `${v.name} (${v.lang})`) ?? [];
      setDiagInfo(d => ({ ...d, synthAvailable, voices }));
    };
    loadVoices();
    window.speechSynthesis?.addEventListener('voiceschanged', loadVoices);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', loadVoices);
  }, []);

  function unlockAudio() {
    diagLog('User tapped — unlocking audio');
    if (window.speechSynthesis) {
      const primer = new SpeechSynthesisUtterance(' ');
      primer.volume = 0;
      primer.onend = () => diagLog('Primer utterance ended — audio unlocked');
      primer.onerror = (e) => diagLog(`Primer error: ${e.error}`);
      window.speechSynthesis.speak(primer);
    } else {
      diagLog('ERROR: window.speechSynthesis is undefined');
    }
    audioUnlockedRef.current = true;
    setAudioUnlocked(true);
    if (pendingCall.current) {
      diagLog('Playing queued call now');
      const { text, cfg } = pendingCall.current;
      pendingCall.current = null;
      speakInLanguages(text, cfg.languages, cfg.repeatCount, cfg.repeatInterval, diagLog);
    }
  }

  // Clock — updates every second
  useEffect(() => {
    const id = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Firestore: bookings listener
  useEffect(() => {
    const q = query(collection(db, 'bookings'), orderBy('queueSequence', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      const filtered = docs.filter(
        (b) =>
          isToday(b.createdAt || b.date) &&
          (b.status === 'waiting' || b.status === 'seated')
      );
      setBookings(filtered);
    });
    return () => unsub();
  }, []);

  // Firestore: restaurantSettings — name + queueCall config
  useEffect(() => {
    const q = query(collection(db, 'restaurantSettings'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        const data = snap.docs[0].data();
        if (data.restaurantName) setRestaurantName(data.restaurantName);
        if (data.queueCall) {
          queueCallSettings.current = { ...queueCallSettings.current, ...data.queueCall };
          setDiagInfo(d => ({ ...d, settingsReceived: true, queueCall: data.queueCall }));
          diagLog(`Settings loaded — enabled=${data.queueCall.enabled}, repeat=${data.queueCall.repeatCount}, langs=${(data.queueCall.languages||[]).join(',')}`);
        }
      }
    });
    return () => unsub();
  }, []);

  // Firestore: activeCall listener — triggers voice announcement
  useEffect(() => {
    diagLog('activeCall listener registered');
    const unsub = onSnapshot(
      doc(db, 'restaurantSettings', 'activeCall'),
      (snap) => {
        if (!snap.exists()) { diagLog('activeCall doc does not exist yet'); return; }
        const data = snap.data();
        const calledAt = data.calledAt?.seconds ?? 0;
        diagLog(`activeCall snapshot — token=${data.token}, calledAt=${calledAt}, lastSeen=${lastCallAt.current}`);
        if (calledAt === lastCallAt.current) { diagLog('Duplicate snapshot, ignoring'); return; }
        lastCallAt.current = calledAt;
        setDiagInfo(d => ({ ...d, lastCall: { token: data.token, name: data.guestName, persons: data.persons, calledAt } }));

        const cfg = queueCallSettings.current;
        diagLog(`cfg.enabled=${cfg.enabled}, audioUnlocked=${audioUnlockedRef.current}`);
        if (!cfg.enabled) { diagLog('Voice disabled in settings, skipping'); return; }

        const text = buildText(cfg.template, data.token, data.guestName, data.persons ?? 1);
        diagLog(`Built text: "${text}"`);
        setCallingBanner({ token: data.token, name: data.guestName });
        setTimeout(() => setCallingBanner(null), (cfg.repeatCount * (cfg.repeatInterval + 3)) * 1000);

        if (!audioUnlockedRef.current) {
          diagLog('Audio not yet unlocked — queuing call');
          pendingCall.current = { text, cfg };
        } else {
          speakInLanguages(text, cfg.languages, cfg.repeatCount, cfg.repeatInterval, diagLog);
        }
      },
      (err) => diagLog(`activeCall listener ERROR: ${err.message}`)
    );
    return () => unsub();
  }, []);

  const seatedTokens = bookings.filter((b) => b.status === 'seated');
  const waitingTokens = bookings.filter((b) => b.status === 'waiting').slice(0, 6);

  const pad = (n) => String(n).padStart(2, '0');
  const timeString =
    pad(currentTime.getHours()) +
    ':' +
    pad(currentTime.getMinutes()) +
    ':' +
    pad(currentTime.getSeconds());

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col overflow-hidden" onClick={!audioUnlocked ? unlockAudio : undefined}>
      {/* Audio unlock overlay — browsers require a user gesture before speech synthesis works */}
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
          <p className="text-sm text-indigo-400 font-medium mt-0.5 uppercase tracking-widest">
            Live Queue Board
          </p>
        </div>
        <div className="text-right">
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
      <main className="flex flex-col md:flex-row flex-1 gap-0 overflow-auto">
        {/* Now Serving */}
        <section className="w-full md:w-1/4 flex flex-col p-6 md:p-8 border-b md:border-b-0 md:border-r border-gray-700">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-indigo-400 mb-6">
            Now Serving
          </h2>
          {seatedTokens.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-gray-600 text-xl">No guests currently seated</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {seatedTokens.map((b) => (
                <div
                  key={b.id}
                  className="bg-indigo-700 rounded-2xl p-6 flex items-center gap-6 shadow-lg"
                >
                  <div className="flex items-center justify-center w-20 h-20 rounded-full bg-indigo-500 text-white font-extrabold text-3xl shrink-0">
                    {b.tokenNumber || b.queueSequence || '–'}
                  </div>
                  <div className="min-w-0">
                    <p className="text-2xl font-bold text-white truncate">{b.guestName || 'Guest'}</p>
                    {b.tableNumber && (
                      <p className="text-indigo-200 text-sm mt-1">
                        Table <span className="font-semibold text-white">{b.tableNumber}</span>
                      </p>
                    )}
                    {b.partySize && (
                      <p className="text-indigo-300 text-xs mt-0.5">{b.partySize} guests</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Waiting List */}
        <section className="w-full md:flex-1 flex flex-col p-6 md:p-8 bg-gray-800/50">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-yellow-400 mb-6">
            Waiting
          </h2>
          {waitingTokens.length === 0 ? (
            <p className="text-gray-600 text-base">Queue is empty</p>
          ) : (
            <div className="space-y-3">
              {waitingTokens.map((b, idx) => {
                const personsAhead = waitingTokens.slice(0, idx).reduce((s, w) => s + (w.partySize || 1), 0);
                const ewtMins = calcEwt(b.tablePreference ?? 'Any', personsAhead);
                const ewtLabel = ewtMins > 0 ? `~${ewtMins} min` : 'Ready soon';
                return (
                  <div
                    key={b.id}
                    className="flex items-center gap-4 bg-gray-800 rounded-xl px-4 py-3"
                  >
                    <div className="flex items-center justify-center w-12 h-12 rounded-full bg-gray-700 text-yellow-300 font-bold text-lg shrink-0">
                      {b.tokenNumber || b.queueSequence || idx + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-white truncate">{b.guestName || 'Guest'}</p>
                      {b.partySize && (
                        <p className="text-xs text-gray-400">{b.partySize} guests</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-gray-400">Est. wait</p>
                      <p className="text-sm font-semibold text-yellow-300">{ewtLabel}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* Diag toggle — z-[60] keeps it above the audio-unlock overlay (z-50) */}
      <button
        onClick={e => { e.stopPropagation(); setShowDiag(v => !v); }}
        className="fixed bottom-3 right-3 z-[60] bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white text-xs px-3 py-1.5 rounded-lg border border-gray-500 transition-colors shadow-lg"
        title="Toggle diagnostics"
      >
        🔬 Diag
      </button>

      {/* Diagnostic panel */}
      {showDiag && (
        <div className="fixed inset-0 z-50 bg-black/90 text-green-300 font-mono text-xs p-4 overflow-y-auto flex flex-col gap-3"
          onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-white font-bold text-sm">🔬 Board Diagnostics</span>
            <button onClick={() => setShowDiag(false)} className="text-white text-lg leading-none px-2">✕</button>
          </div>

          {/* Status grid */}
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

          {/* Settings detail */}
          {diagInfo.queueCall && (
            <div className="bg-gray-900 rounded p-2 space-y-0.5">
              <div className="text-white font-semibold mb-1">Queue call config</div>
              <div>enabled: <span className="text-yellow-300">{String(diagInfo.queueCall.enabled)}</span></div>
              <div>repeat: <span className="text-yellow-300">{diagInfo.queueCall.repeatCount}×</span> every <span className="text-yellow-300">{diagInfo.queueCall.repeatInterval}s</span></div>
              <div>languages: <span className="text-yellow-300">{(diagInfo.queueCall.languages || []).join(', ')}</span></div>
              <div>template: <span className="text-yellow-300">{diagInfo.queueCall.template}</span></div>
            </div>
          )}

          {/* Available voices */}
          <div className="bg-gray-900 rounded p-2">
            <div className="text-white font-semibold mb-1">Available voices ({diagInfo.voices.length})</div>
            {diagInfo.voices.length === 0
              ? <div className="text-red-400">No voices loaded — browser may not support TTS or voices not yet populated</div>
              : <div className="max-h-32 overflow-y-auto space-y-0.5">{diagInfo.voices.map((v, i) => <div key={i}>{v}</div>)}</div>
            }
          </div>

          {/* Test speak button */}
          <button
            onClick={() => {
              diagLog('Manual test speak triggered');
              const cfg = queueCallSettings.current;
              speakInLanguages('Testing. Good morning. Token A 1, John, party of 2, please proceed to the counter.', cfg.languages, 1, 0, diagLog);
            }}
            className="bg-indigo-700 hover:bg-indigo-600 text-white rounded px-4 py-2 text-sm font-semibold"
          >
            ▶ Test Speak Now
          </button>

          {/* Log */}
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

      {/* Bottom Ticker */}
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
        .animate-marquee {
          animation: marquee 30s linear infinite;
        }
      `}</style>
    </div>
  );
}
