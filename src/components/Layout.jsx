import { useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useCards } from '../contexts/CardsContext.jsx'
import { isDueToday } from '../lib/srs.js'
import DueTodayPanel from './Dashboard/DueTodayPanel.jsx'
import CalendarView from './Calendar/CalendarView.jsx'
import VocabList from './VocabBook/VocabList.jsx'

const TABS = [
  { key: 'dashboard', label: '今日複習' },
  { key: 'calendar', label: '月曆' },
  { key: 'vocab', label: '單字本' },
]

export default function Layout() {
  const { logout } = useAuth()
  const { cards } = useCards()
  const [tab, setTab] = useState('dashboard')

  const dueCount = useMemo(() => cards.filter(isDueToday).length, [cards])

  return (
    <div className="app-layout">
      <header className="app-header">
        <h1>韓文複習</h1>
        <button className="logout-button" onClick={logout}>
          登出
        </button>
      </header>

      <nav className="app-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? 'active' : ''}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === 'dashboard' && dueCount > 0 && <span className="tab-badge">{dueCount}</span>}
          </button>
        ))}
      </nav>

      <main className="app-main">
        {tab === 'dashboard' && <DueTodayPanel />}
        {tab === 'calendar' && <CalendarView />}
        {tab === 'vocab' && <VocabList />}
      </main>
    </div>
  )
}
