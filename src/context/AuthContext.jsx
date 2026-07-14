import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../firebase/config'

const AuthContext = createContext(null)

const Spinner = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="animate-spin h-8 w-8 border-4 border-amber-500 border-t-transparent rounded-full" />
  </div>
)

export function AuthProvider({ children }) {
  // undefined = still loading; null = not signed in / no profile
  const [user, setUser]       = useState(undefined)
  const [profile, setProfile] = useState(undefined)

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUser(u)
        setProfile(undefined) // profile loading
        try {
          const snap = await getDoc(doc(db, 'staff', u.uid))
          setProfile(snap.exists() ? { ...snap.data(), id: snap.id } : null)
        } catch {
          setProfile(null)
        }
      } else {
        setUser(null)
        setProfile(null)
      }
    })
  }, [])

  const login  = (email, password) => signInWithEmailAndPassword(auth, email, password)
  const logout = () => signOut(auth)

  // Block children until both auth state and profile are fully resolved
  const loading = user === undefined || (user !== null && profile === undefined)

  return (
    <AuthContext.Provider value={{ user, profile, login, logout }}>
      {loading ? <Spinner /> : children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
