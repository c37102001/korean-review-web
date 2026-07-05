import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useCards } from '../../contexts/CardsContext.jsx'
import { fetchCardsForDate, recordReview } from '../../lib/firestoreApi.js'
import CardView from '../CardView.jsx'
import JsonImportForm from './JsonImportForm.jsx'
import PracticeFlow from '../Quiz/PracticeFlow.jsx'

export default function DayDetailModal({ date, onClose }) {
  const { user } = useAuth()
  const { refresh } = useCards()
  const [dayCards, setDayCards] = useState(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState('view') // 'view' | 'import' | 'practice'

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchCardsForDate(user.uid, date).then((result) => {
      if (!cancelled) {
        setDayCards(result)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [user.uid, date])

  async function refreshDayCards() {
    const result = await fetchCardsForDate(user.uid, date)
    setDayCards(result)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{date}</h2>
          <button className="close-button" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-tabs">
          <button className={mode === 'view' ? 'active' : ''} onClick={() => setMode('view')}>
            瀏覽筆記
          </button>
          <button
            className={mode === 'practice' ? 'active' : ''}
            onClick={() => setMode('practice')}
            disabled={!dayCards || dayCards.length === 0}
          >
            練習這天
          </button>
          <button className={mode === 'import' ? 'active' : ''} onClick={() => setMode('import')}>
            新增/貼上 JSON
          </button>
        </div>

        {mode === 'view' &&
          (loading ? (
            <p>載入中…</p>
          ) : dayCards.length === 0 ? (
            <p>這天還沒有任何學習紀錄。</p>
          ) : (
            <div className="day-card-list">
              {dayCards.map((c) => (
                <CardView key={c.id} card={c} />
              ))}
            </div>
          ))}

        {mode === 'import' && (
          <JsonImportForm
            date={date}
            onImported={async () => {
              await refreshDayCards()
              setMode('view')
            }}
          />
        )}

        {mode === 'practice' && dayCards && dayCards.length > 0 && (
          <PracticeFlow
            pool={dayCards}
            title={`練習 ${date}`}
            onRecordReview={(cardId, wasCorrect) => recordReview(user.uid, cardId, wasCorrect)}
            onFinish={async () => {
              await Promise.all([refresh(), refreshDayCards()])
              setMode('view')
            }}
          />
        )}
      </div>
    </div>
  )
}
