import { useState } from 'react'
import { diffTypedAnswer } from '../../lib/answerDiff.js'
import AnswerDiffLine from './AnswerDiffLine.jsx'

function RecallQuestion({ question, onAnswer }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <>
      {!revealed ? (
        <button className="reveal-button" onClick={() => setRevealed(true)}>
          公佈答案
        </button>
      ) : (
        <>
          <p className="question-answer">{question.answer}</p>
          <div className="self-grade-buttons">
            <button className="grade-wrong" onClick={() => onAnswer(false)}>
              答錯了
            </button>
            <button className="grade-correct" onClick={() => onAnswer(true)}>
              答對了
            </button>
          </div>
        </>
      )}
    </>
  )
}

function TypingQuestion({ question, onAnswer }) {
  const [input, setInput] = useState('')
  const [diffResult, setDiffResult] = useState(null)
  const [revealed, setRevealed] = useState(false)

  const isConfirmedCorrect = diffResult?.isCorrect === true

  function handleConfirm(e) {
    e.preventDefault()
    if (!input.trim()) return
    setDiffResult(diffTypedAnswer(input, question.answer))
  }

  function handleReveal() {
    setRevealed(true)
  }

  if (revealed) {
    return (
      <>
        <p className="question-answer">{question.answer}</p>
        <div className="self-grade-buttons">
          <button className="grade-wrong" onClick={() => onAnswer(false)}>
            答錯了
          </button>
          <button className="grade-correct" onClick={() => onAnswer(true)}>
            答對了
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <form className="typing-form" onSubmit={handleConfirm}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="輸入韓文…"
          autoFocus
          disabled={isConfirmedCorrect}
        />
        <div className="typing-actions">
          <button type="button" className="reveal-button" onClick={handleReveal}>
            公佈答案
          </button>
          <button type="submit" className="primary-button" disabled={!input.trim() || isConfirmedCorrect}>
            確認
          </button>
        </div>
      </form>

      {diffResult && <AnswerDiffLine segments={diffResult.segments} />}

      {isConfirmedCorrect && (
        <>
          <p className="question-correct-banner">答案正確！</p>
          <div className="self-grade-buttons">
            <button className="grade-wrong" onClick={() => onAnswer(false)}>
              答錯了
            </button>
            <button className="grade-correct" onClick={() => onAnswer(true)}>
              答對了
            </button>
          </div>
        </>
      )}
    </>
  )
}

export default function QuestionCard({ question, onAnswer }) {
  return (
    <div className="question-card">
      {question.hint && <p className="question-hint">{question.hint}</p>}
      <p className="question-prompt">{question.prompt}</p>

      {question.kind === 'typing' ? (
        <TypingQuestion question={question} onAnswer={onAnswer} />
      ) : (
        <RecallQuestion question={question} onAnswer={onAnswer} />
      )}
    </div>
  )
}
