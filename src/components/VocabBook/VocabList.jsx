import { useMemo, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useCards } from '../../contexts/CardsContext.jsx'
import { masteryOf, MASTERY, MASTERY_LABEL } from '../../lib/mastery.js'
import { recordReview } from '../../lib/firestoreApi.js'
import VocabDetailPanel from './VocabDetailPanel.jsx'
import PracticeFlow from '../Quiz/PracticeFlow.jsx'

export default function VocabList() {
  const { user } = useAuth()
  const { cards, loading, refresh } = useCards()
  const [typeFilter, setTypeFilter] = useState('all')
  const [masteryFilter, setMasteryFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedCard, setSelectedCard] = useState(null)
  const [practicing, setPracticing] = useState(false)

  const types = useMemo(() => {
    const set = new Set(cards.map((c) => c.type).filter(Boolean))
    return ['all', ...Array.from(set).sort()]
  }, [cards])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return cards.filter((c) => {
      if (typeFilter !== 'all' && c.type !== typeFilter) return false
      if (masteryFilter !== 'all' && masteryOf(c) !== masteryFilter) return false
      if (q && !`${c.ko} ${c.zh}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [cards, typeFilter, masteryFilter, search])

  if (loading) return <p>載入中…</p>

  if (practicing) {
    return (
      <PracticeFlow
        pool={filtered}
        title="單字本複習"
        onRecordReview={(cardId, wasCorrect) => recordReview(user.uid, cardId, wasCorrect)}
        onFinish={() => {
          setPracticing(false)
          refresh()
        }}
      />
    )
  }

  return (
    <div className="vocab-book">
      <h2>單字本</h2>
      <div className="vocab-filters">
        <input
          type="text"
          placeholder="搜尋韓文或中文…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          {types.map((t) => (
            <option key={t} value={t}>
              {t === 'all' ? '全部類型' : t}
            </option>
          ))}
        </select>
        <select value={masteryFilter} onChange={(e) => setMasteryFilter(e.target.value)}>
          <option value="all">全部熟練度</option>
          {Object.values(MASTERY).map((m) => (
            <option key={m} value={m}>
              {MASTERY_LABEL[m]}
            </option>
          ))}
        </select>
      </div>

      <p className="vocab-count">
        共 {filtered.length} 張字卡
        {filtered.length > 0 && (
          <button className="primary-button small" onClick={() => setPracticing(true)}>
            複習這些
          </button>
        )}
      </p>

      <ul className="vocab-list">
        {filtered.map((c) => {
          const mastery = masteryOf(c)
          return (
            <li key={c.id} className="vocab-list-item" onClick={() => setSelectedCard(c)}>
              <span className="vocab-ko">{c.ko}</span>
              <span className="vocab-zh">{c.zh}</span>
              <span className={`mastery-badge mastery-${mastery}`}>{MASTERY_LABEL[mastery]}</span>
            </li>
          )
        })}
      </ul>

      {selectedCard && (
        <div className="modal-overlay" onClick={() => setSelectedCard(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <VocabDetailPanel card={selectedCard} onClose={() => setSelectedCard(null)} />
          </div>
        </div>
      )}
    </div>
  )
}
