import { useMemo, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useCards } from '../../contexts/CardsContext.jsx'
import { isDueToday } from '../../lib/srs.js'
import { recordReview } from '../../lib/firestoreApi.js'
import PracticeFlow from '../Quiz/PracticeFlow.jsx'

export default function DueTodayPanel() {
  const { user } = useAuth()
  const { cards, loading, refresh } = useCards()
  const [reviewing, setReviewing] = useState(false)

  const dueCards = useMemo(() => cards.filter(isDueToday), [cards])

  if (loading) return <p>載入中…</p>

  if (reviewing) {
    return (
      <PracticeFlow
        pool={dueCards}
        title="今日複習"
        onRecordReview={(cardId, wasCorrect) => recordReview(user.uid, cardId, wasCorrect)}
        onFinish={() => {
          setReviewing(false)
          refresh()
        }}
      />
    )
  }

  return (
    <div className="due-today-panel">
      <h2>今日複習</h2>
      {dueCards.length === 0 ? (
        <p>目前沒有到期需要複習的字卡，太棒了！</p>
      ) : (
        <>
          <p>
            共有 <strong>{dueCards.length}</strong> 張字卡到了複習時間（包含之前累積未複習完的）。
          </p>
          <button className="primary-button" onClick={() => setReviewing(true)}>
            開始複習
          </button>
        </>
      )}
    </div>
  )
}
