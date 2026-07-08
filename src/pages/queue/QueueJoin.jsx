import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { collection, addDoc, serverTimestamp, doc, getDoc } from 'firebase/firestore'
import { db } from '../../firebase/config'

const TODAY = new Date().toISOString().split('T')[0]
const TABLE_PREFS = ['Any', 'Window', 'Booth', 'Outdoor']

function generateToken() {
  return 'Q' + Math.floor(100 + Math.random() * 900)
}

export default function QueueJoin() {
  const navigate = useNavigate()
  const [restaurantName, setRestaurantName] = useState('Restaurant')
  const [form, setForm] = useState({
    guestName: '', mobile: '', partySize: 2, tablePreference: 'Any',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getDoc(doc(db, 'restaurantSettings', 'main')).then(snap => {
      if (snap.exists()) setRestaurantName(snap.data().restaurantName ?? 'Restaurant')
    }).catch(() => {})
  }, [])

  function handleChange(e) {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: name === 'partySize' ? Number(value) : value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.guestName.trim()) { setError('Name is required.'); return }
    if (form.partySize < 1) { setError('Party size must be at least 1.'); return }
    setError('')
    setSubmitting(true)
    try {
      const ref = await addDoc(collection(db, 'bookings'), {
        guestName:       form.guestName.trim(),
        mobile:          form.mobile.trim(),
        partySize:       form.partySize,
        tablePreference: form.tablePreference,
        type:            'walk-in',
        status:          'waiting',
        date:            TODAY,
        token:           generateToken(),
        queueSequence:   Date.now(),
        source:          'self-register',
        createdAt:       serverTimestamp(),
      })
      navigate(`/queue/status/${ref.id}`)
    } catch (err) {
      console.error(err)
      setError('Could not join queue. Please ask staff for help.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <p className="text-4xl mb-2">🍽️</p>
          <h1 className="text-xl font-bold text-gray-800">{restaurantName}</h1>
          <p className="text-sm text-gray-500 mt-1">Join the waiting queue</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Full Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              name="guestName"
              required
              autoComplete="name"
              value={form.guestName}
              onChange={handleChange}
              placeholder="Your name"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Mobile Number <span className="text-gray-400 font-normal text-xs">(optional)</span>
            </label>
            <input
              type="tel"
              name="mobile"
              autoComplete="tel"
              value={form.mobile}
              onChange={handleChange}
              placeholder="10-digit number"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Party Size <span className="text-red-400">*</span>
            </label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setForm(p => ({ ...p, partySize: n }))}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                    form.partySize === n
                      ? 'bg-amber-500 text-white border-amber-500'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-amber-400'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            {form.partySize > 8 && (
              <input
                type="number"
                name="partySize"
                min={1}
                value={form.partySize}
                onChange={handleChange}
                className="mt-2 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Table Preference</label>
            <div className="flex gap-2 flex-wrap">
              {TABLE_PREFS.map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, tablePreference: p }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    form.tablePreference === p
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-400'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting || !form.guestName.trim()}
            className="w-full py-3 bg-amber-500 text-white rounded-xl font-semibold text-sm hover:bg-amber-600 disabled:opacity-50 transition"
          >
            {submitting ? 'Joining…' : 'Join Queue →'}
          </button>
        </form>

        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-gray-400">You'll get a token and track your position live.</p>
          <Link
            to="/queue"
            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium whitespace-nowrap"
          >
            View queue →
          </Link>
        </div>
      </div>
    </div>
  )
}
