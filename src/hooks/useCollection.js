import { useEffect, useState } from 'react'
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { db } from '../firebase/config'

export function useCollection(col, orderField = 'createdAt', orderDir = 'asc', filters = []) {
  const [docs, setDocs]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    let q = query(collection(db, col))
    filters.forEach(([field, op, val]) => { q = query(q, where(field, op, val)) })
    if (orderField) q = query(q, orderBy(orderField, orderDir))

    const unsub = onSnapshot(q,
      (snap) => {
        setDocs(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        setLoading(false)
      },
      (err) => { setError(err); setLoading(false) }
    )
    return unsub
  }, [col, orderField, orderDir, JSON.stringify(filters)])

  return { docs, loading, error }
}
