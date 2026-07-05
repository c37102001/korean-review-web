import { useState } from 'react'

const DIRECTIONS = [
  { key: 'zh2ko', label: '中翻韓', hint: '打字輸入，逐字比對' },
  { key: 'ko2zh', label: '韓翻中', hint: '心中作答，公佈答案自評' },
]

const UNITS = [
  { key: 'word', label: '單字' },
  { key: 'sentence', label: '例句' },
]

export default function PracticeSetup({ onStart, onCancel }) {
  const [direction, setDirection] = useState(null)
  const [unit, setUnit] = useState(null)

  const canStart = direction != null && unit != null

  return (
    <div className="practice-setup">
      <h2>複習設定</h2>

      <div className="setup-group">
        <p className="setup-label">方向</p>
        <div className="setup-options">
          {DIRECTIONS.map((d) => (
            <button
              key={d.key}
              className={direction === d.key ? 'setup-option active' : 'setup-option'}
              onClick={() => setDirection(d.key)}
            >
              <span>{d.label}</span>
              <small>{d.hint}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="setup-group">
        <p className="setup-label">單元</p>
        <div className="setup-options">
          {UNITS.map((u) => (
            <button
              key={u.key}
              className={unit === u.key ? 'setup-option active' : 'setup-option'}
              onClick={() => setUnit(u.key)}
            >
              <span>{u.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="setup-actions">
        {onCancel && (
          <button className="secondary-button" onClick={onCancel}>
            取消
          </button>
        )}
        <button
          className="primary-button"
          disabled={!canStart}
          onClick={() => onStart({ direction, unit })}
        >
          開始複習
        </button>
      </div>
    </div>
  )
}
