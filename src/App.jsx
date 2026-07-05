import { AuthProvider, useAuth } from './contexts/AuthContext.jsx'
import { CardsProvider } from './contexts/CardsContext.jsx'
import Login from './components/Login.jsx'
import Layout from './components/Layout.jsx'

function AppContent() {
  const { user } = useAuth()

  if (user === undefined) return <div className="loading-screen">載入中…</div>
  if (user === null) return <Login />

  return (
    <CardsProvider>
      <Layout />
    </CardsProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}
