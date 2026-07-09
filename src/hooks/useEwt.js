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

  // Missing/null status treated as 'available' (handles old records with no status field)
  function isFree(t) {
    return !t.status || t.status === 'available'
  }

  // Average remaining time across all in-use tables that have a seatedAt timestamp.
  // Falls back to the full configured turn time if none have timestamps yet.
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

  /**
   * calcEwt(section, personsAhead)
   *
   * personsAhead — total number of PEOPLE (not parties) waiting ahead of this guest.
   *
   * Logic:
   *   freeCapacity  = sum of capacities of available tables
   *   cycleCapacity = sum of capacities of in-use tables (freed each turn)
   *   avgRemaining  = average (configuredEwt − minutesSinceSeated) across in-use tables
   *
   *   If personsAhead fits in freeCapacity → immediate (0)
   *   Otherwise figure out how many full cycles are needed for the overflow:
   *     cycles = ceil((personsAhead − freeCapacity) / cycleCapacity)
   *     EWT    = avgRemaining + (cycles − 1) × configuredEwt
   */
  function calcEwt(section, personsAhead) {
    if (loading || tables.length === 0) return 0

    const configuredEwt = section === 'Any'
      ? Math.min(...SECTIONS.map(s => sectionEwt[s] ?? DEFAULT_EWT))
      : (sectionEwt[section] ?? DEFAULT_EWT)

    const pool       = section === 'Any' ? tables : tables.filter(t => t.section === section)
    const freeTables = pool.filter(isFree)
    const inUseTables = pool.filter(t => IN_USE.includes(t.status))

    const freeCapacity  = freeTables.reduce((s, t) => s + (t.capacity || 4), 0)
    const cycleCapacity = inUseTables.reduce((s, t) => s + (t.capacity || 4), 0)

    if (personsAhead <= freeCapacity) return 0
    if (cycleCapacity === 0) return 0

    const overflow     = personsAhead - freeCapacity
    const cyclesNeeded = Math.ceil(overflow / cycleCapacity)
    const avgRemaining = avgRemainingForTables(inUseTables, configuredEwt)

    return Math.ceil(avgRemaining + (cyclesNeeded - 1) * configuredEwt)
  }

  // Sections with at least one non-blocked table
  const activeSections = SECTIONS.filter(s => {
    const sectionTables = tables.filter(t => t.section === s)
    return sectionTables.length > 0 && sectionTables.some(t => t.status !== 'blocked')
  })

  return { calcEwt, sectionEwt, activeSections, loading }
}
