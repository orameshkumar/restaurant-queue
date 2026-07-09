import { useState, useEffect } from 'react'
import { collection, onSnapshot, doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase/config'

const SECTIONS = ['Indoor', 'Outdoor', 'Bar & Lounge', 'Private Dining']
const DEFAULT_EWT = 30

export function useEwt() {
  const [tables, setTables] = useState([])
  const [sectionEwt, setSectionEwt] = useState({
    Indoor: 30,
    Outdoor: 25,
    'Bar & Lounge': 20,
    'Private Dining': 45,
  })
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  // Tick every minute so remaining-time calculations stay fresh without a table change
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 60000)
    return () => clearInterval(t)
  }, [])

  // Live subscription to tables
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'tables'), snap => {
      setTables(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    }, () => setLoading(false))
    return unsub
  }, [])

  // One-time read of settings
  useEffect(() => {
    getDoc(doc(db, 'restaurantSettings', 'main')).then(snap => {
      if (snap.exists() && snap.data().sectionEwt) {
        setSectionEwt(snap.data().sectionEwt)
      }
    }).catch(() => {})
  }, [])

  // All statuses that mean a table is actively in use (not yet freed)
  const IN_USE = ['occupied', 'ordering', 'eating', 'bill_requested']

  function avgRemainingForTables(inUseTables, ewt) {
    const active = inUseTables.filter(t => t.seatedAt)
    if (active.length === 0) return ewt
    const remainings = active.map(t => {
      const seated = t.seatedAt.toDate ? t.seatedAt.toDate() : new Date(t.seatedAt)
      const minutesSinceSeated = (Date.now() - seated.getTime()) / 60000
      return Math.max(0, ewt - minutesSinceSeated)
    })
    return remainings.reduce((a, b) => a + b, 0) / remainings.length
  }

  function calcEwt(section, partiesAhead) {
    if (section === 'Any') {
      const minEwt = Math.min(...SECTIONS.map(s => sectionEwt[s] ?? DEFAULT_EWT))
      const freeTables = tables.filter(t => t.status === 'available')
      const inUseTables = tables.filter(t => IN_USE.includes(t.status))
      const avg = avgRemainingForTables(inUseTables, minEwt)
      if (partiesAhead < freeTables.length) return 0
      return Math.ceil((partiesAhead - freeTables.length) * avg)
    }

    const configuredEwt = sectionEwt[section] ?? DEFAULT_EWT
    const sectionTables = tables.filter(t => t.section === section)
    const freeTables = sectionTables.filter(t => t.status === 'available')
    const inUseTables = sectionTables.filter(t => IN_USE.includes(t.status))
    const avg = avgRemainingForTables(inUseTables, configuredEwt)
    if (partiesAhead < freeTables.length) return 0
    return Math.ceil((partiesAhead - freeTables.length) * avg)
  }

  // Sections with at least one non-blocked table
  const activeSections = SECTIONS.filter(s => {
    const sectionTables = tables.filter(t => t.section === s)
    return sectionTables.length > 0 && sectionTables.some(t => t.status !== 'blocked')
  })

  return { calcEwt, sectionEwt, activeSections, loading }
}
