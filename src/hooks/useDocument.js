import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase/config'

export function useDocument(col, id) {
  const [document, setDocument] = useState(null)
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    if (!id) { setLoading(false); return }
    return onSnapshot(doc(db, col, id), (snap) => {
      setDocument(snap.exists() ? { id: snap.id, ...snap.data() } : null)
      setLoading(false)
    })
  }, [col, id])

  return { document, loading }
}
