import { accuracyOf, masteryOf, MASTERY_LABEL } from '../../lib/mastery.js'
import CardView from '../CardView.jsx'

export default function VocabDetailPanel({ card, onClose }) {
  const acc = accuracyOf(card)
  const mastery = masteryOf(card)

  return (
    <div className="vocab-detail-panel">
      <div className="modal-header">
        <h2>字卡詳情</h2>
        <button className="close-button" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="vocab-stats">
        <span className={`mastery-badge mastery-${mastery}`}>{MASTERY_LABEL[mastery]}</span>
        <span>
          複習次數：{card.totalReviews}　正確率：{acc == null ? '—' : `${Math.round(acc * 100)}%`}
        </span>
        <span>下次複習：{card.nextReviewDate}</span>
        <span>首次學習：{card.firstLearnedDate}</span>
      </div>
      <CardView card={card} />
    </div>
  )
}
