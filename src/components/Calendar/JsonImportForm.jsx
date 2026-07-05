import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useCards } from '../../contexts/CardsContext.jsx'
import { parseRawJson, planImport } from '../../lib/cardParser.js'
import { importDayItems } from '../../lib/firestoreApi.js'

export default function JsonImportForm({ date, onImported }) {
  const { user } = useAuth()
  const { cards, refresh } = useCards()
  const [text, setText] = useState('')
  const [plan, setPlan] = useState(null)
  const [rawItems, setRawItems] = useState(null)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  function handlePreview() {
    setError(null)
    setPlan(null)
    try {
      const items = parseRawJson(text)
      const existingCardsById = Object.fromEntries(cards.map((c) => [c.id, c]))
      const result = planImport(items, existingCardsById)
      setRawItems(items)
      setPlan(result)
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleConfirm() {
    setSubmitting(true)
    setError(null)
    try {
      await importDayItems(user.uid, date, rawItems)
      await refresh()
      setText('')
      setPlan(null)
      setRawItems(null)
      onImported?.()
    } catch (e) {
      setError(e.message || '匯入失敗')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="json-import-form">
      <p className="import-hint">貼上 {date} 整理好的 JSON 筆記內容：</p>
      <textarea
        rows={10}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setPlan(null)
        }}
        placeholder='{ "data": [ ... ] }'
      />
      {error && <p className="error-text">{error}</p>}

      {!plan ? (
        <button className="primary-button" onClick={handlePreview} disabled={!text.trim()}>
          預覽
        </button>
      ) : (
        <div className="import-preview">
          <p>
            共 {plan.entries.length} 張字卡（新增 {plan.entries.filter((e) => e.isNew).length} 張、
            更新 {plan.entries.filter((e) => !e.isNew).length} 張）
            {plan.skipped > 0 && `，略過 ${plan.skipped} 筆無法辨識的內容`}。
          </p>
          <ul className="import-preview-list">
            {plan.entries.slice(0, 20).map((e) => (
              <li key={e.id}>
                {e.mergedContent.ko} — {e.mergedContent.zh} {e.isNew ? '(新)' : '(更新)'}
              </li>
            ))}
            {plan.entries.length > 20 && <li>… 其餘 {plan.entries.length - 20} 筆</li>}
          </ul>
          <div className="import-actions">
            <button onClick={() => setPlan(null)}>返回編輯</button>
            <button className="primary-button" onClick={handleConfirm} disabled={submitting}>
              {submitting ? '匯入中…' : '確認匯入'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
