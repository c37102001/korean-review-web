function relatedLabel(r) {
  if (typeof r === 'string') return r
  return [r.ko, r.zh, r.relation].filter(Boolean).join(' — ')
}

export default function CardView({ card }) {
  if (card.kind === 'contrast') {
    return (
      <div className="card-view card-view-contrast">
        <h3>{card.ko}</h3>
        <p className="card-zh">{card.zh}</p>
        <ul>
          {(card.items || []).map((it, i) => (
            <li key={i}>
              <strong>{it.ko}</strong> — {it.zh}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div className="card-view">
      <h3>{card.ko}</h3>
      <p className="card-zh">{card.zh}</p>
      <p className="card-meta">
        {[card.type, card.pos, card.hanja].filter(Boolean).join(' · ')}
      </p>

      {card.forms && Object.keys(card.forms).length > 0 && (
        <div className="card-section">
          <h4>變化形</h4>
          <ul>
            {Object.entries(card.forms).map(([k, v]) => (
              <li key={k}>
                {k}: {v}
              </li>
            ))}
          </ul>
        </div>
      )}

      {card.senses && card.senses.length > 0 && (
        <div className="card-section">
          <h4>語意</h4>
          {card.senses.map((s, i) => (
            <div key={i} className="sense-block">
              <p>
                {s.zh}
                {s.pattern ? `（${s.pattern}）` : ''}
              </p>
              {(s.examples || []).map((ex, j) => (
                <p key={j} className="example-line">
                  {ex.ko} — {ex.zh}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}

      {card.examples && card.examples.length > 0 && (
        <div className="card-section">
          <h4>例句</h4>
          {card.examples.map((ex, i) => (
            <p key={i} className="example-line">
              {ex.ko} — {ex.zh}
            </p>
          ))}
        </div>
      )}

      {card.notes && card.notes.length > 0 && (
        <div className="card-section">
          <h4>補充說明</h4>
          <ul>
            {card.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      {card.related && card.related.length > 0 && (
        <div className="card-section">
          <h4>相關字</h4>
          <ul>
            {card.related.map((r, i) => (
              <li key={i}>{relatedLabel(r)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
