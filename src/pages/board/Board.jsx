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

function speakInLanguages(text, languages, repeatCount, repeatInterval) {
  if (!window.speechSynthesis) return;
  const langs = (languages && languages.length) ? languages : ['en-US'];
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
      // Warm-up utterance — Web Speech API suppresses the first few ms of audio;
      // speaking a near-silent comma first lets the engine stabilise before the real text.
      const warmup = new SpeechSynthesisUtterance(',');
      warmup.lang = langs[i];
      warmup.volume = 0;
      warmup.rate = 1;
      warmup.onend = () => {
        const utt = new SpeechSynthesisUtterance(text);
        utt.lang = langs[i];
        utt.rate = 0.88;
        utt.pitch = 1;
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
  // Small delay after cancel() so the engine fully resets before the warm-up fires
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
  const { calcEwt } = useEwt();

  function unlockAudio() {
    // Speak a silent utterance to satisfy the browser's user-gesture requirement,
    // then immediately cancel it — this primes the speech engine for real calls.
    if (window.speechSynthesis) {
      const primer = new SpeechSynthesisUtterance(' ');
      primer.volume = 0;
      window.speechSynthesis.speak(primer);
      window.speechSynthesis.cancel();
    }
    audioUnlockedRef.current = true;
    setAudioUnlocked(true);
    // If a call arrived before the user tapped, speak it now
    if (pendingCall.current) {
      const { text, cfg } = pendingCall.current;
      pendingCall.current = null;
      speakInLanguages(text, cfg.languages, cfg.repeatCount, cfg.repeatInterval);
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
        if (data.queueCall) queueCallSettings.current = { ...queueCallSettings.current, ...data.queueCall };
      }
    });
    return () => unsub();
  }, []);

  // Firestore: activeCall listener — triggers voice announcement
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'restaurantSettings', 'activeCall'), (snap) => {
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
        // Audio locked — queue this call; it will speak once the operator taps the screen
        pendingCall.current = { text, cfg };
      } else {
        speakInLanguages(text, cfg.languages, cfg.repeatCount, cfg.repeatInterval);
      }
    });
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
        <section className="flex-1 flex flex-col p-6 md:p-8 border-b md:border-b-0 md:border-r border-gray-700">
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
        <section className="w-full md:w-96 flex flex-col p-6 md:p-8 bg-gray-800/50">
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
