import { collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '../firebase/config'

/**
 * Returns the next sequential daily token: Q001, Q002, Q003…
 * Reads today's bookings to find the current max, then increments.
 */
export async function generateToken() {
  const today = new Date().toISOString().split('T')[0]
  const snap = await getDocs(
    query(collection(db, 'bookings'), where('date', '==', today))
  )

  let max = 0
  snap.forEach(d => {
    const t = d.data().token ?? ''
    const match = t.match(/^Q(\d+)$/)
    if (match) {
      const n = parseInt(match[1], 10)
      if (n > max) max = n
    }
  })

  return 'Q' + String(max + 1).padStart(3, '0')
}
