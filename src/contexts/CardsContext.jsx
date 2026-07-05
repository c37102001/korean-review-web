import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useAuth } from './AuthContext.jsx'
import { fetchAllCards } from '../lib/firestoreApi.js'

const CardsContext = createContext(null)

export function CardsProvider({ children }) {
  const { user } = useAuth()
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const all = await fetchAllCards(user.uid)
      setCards(all)
      setError(null)
    } catch (e) {
      setError(e.message || '讀取字卡失敗')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (user) refresh()
  }, [user, refresh])

  return (
    <CardsContext.Provider value={{ cards, loading, error, refresh }}>
      {children}
    </CardsContext.Provider>
  )
}

export function useCards() {
  const ctx = useContext(CardsContext)
  if (!ctx) throw new Error('useCards must be used within CardsProvider')
  return ctx
}
