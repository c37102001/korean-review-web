import { useState } from 'react'

export default function QuestionCard({ question, onAnswer }) {
  const [selectedOptionId, setSelectedOptionId] = useState(null)
  const [revealed, setRevealed] = useState(false)

  const isMc = question.kind === 'mc'
  const answered = isMc ? selectedOptionId != null : revealed

  function selectOption(optionId) {
    if (selectedOptionId != null) return
    setSelectedOptionId(optionId)
  }

  function continueToNext() {
    const wasCorrect = selectedOptionId === question.correctOptionId
    onAnswer(wasCorrect)
  }

  function selfGrade(wasCorrect) {
    onAnswer(wasCorrect)
  }

  return (
    <div className="question-card">
      {question.hint && <p className="question-hint">{question.hint}</p>}
      <p className="question-prompt">{question.prompt}</p>

      {isMc ? (
        <div className="question-options">
          {question.options.map((opt) => {
            let cls = 'option-button'
            if (selectedOptionId) {
              if (opt.id === question.correctOptionId) cls += ' option-correct'
              else if (opt.id === selectedOptionId) cls += ' option-wrong'
            }
            return (
              <button
                key={opt.id}
                className={cls}
                disabled={selectedOptionId != null}
                onClick={() => selectOption(opt.id)}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="question-recall">
          {!revealed ? (
            <button className="reveal-button" onClick={() => setRevealed(true)}>
              顯示答案
            </button>
          ) : (
            <p className="question-answer">{question.answer}</p>
          )}
        </div>
      )}

      {isMc && answered && (
        <button className="continue-button" onClick={continueToNext}>
          下一題
        </button>
      )}
      {!isMc && revealed && (
        <div className="self-grade-buttons">
          <button className="grade-wrong" onClick={() => selfGrade(false)}>
            答錯了
          </button>
          <button className="grade-correct" onClick={() => selfGrade(true)}>
            答對了
          </button>
        </div>
      )}
    </div>
  )
}
