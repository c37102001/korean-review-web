import { useMemo, useState } from 'react'
import { buildQuizQuestions } from '../../lib/quizGenerator.js'
import QuestionCard from './QuestionCard.jsx'

export default function QuizSession({ pool, allCards, title, onRecordReview, onFinish }) {
  const questions = useMemo(() => {
    const shuffledPool = [...pool].sort(() => Math.random() - 0.5)
    return buildQuizQuestions(shuffledPool, allCards)
  }, [pool, allCards])

  const [index, setIndex] = useState(0)
  const [tally, setTally] = useState({ correct: 0, wrong: 0 })

  if (questions.length === 0) {
    return (
      <div className="quiz-session">
        <p>目前沒有可以出題的內容（這些字卡缺少足夠的例句/欄位）。</p>
        <button onClick={onFinish}>返回</button>
      </div>
    )
  }

  if (index >= questions.length) {
    return (
      <div className="quiz-session quiz-summary">
        <h2>複習完成！</h2>
        <p>
          共 {questions.length} 題，答對 {tally.correct} 題，答錯 {tally.wrong} 題。
        </p>
        <button onClick={onFinish}>完成</button>
      </div>
    )
  }

  const question = questions[index]

  async function handleAnswer(wasCorrect) {
    setTally((t) => ({
      correct: t.correct + (wasCorrect ? 1 : 0),
      wrong: t.wrong + (wasCorrect ? 0 : 1),
    }))
    try {
      await onRecordReview(question.cardId, wasCorrect)
    } catch {
      // best-effort; the review UI shouldn't block on a transient write error
    }
    setIndex((i) => i + 1)
  }

  return (
    <div className="quiz-session">
      <div className="quiz-progress">
        {title ? `${title} · ` : ''}
        {index + 1} / {questions.length}
      </div>
      <QuestionCard key={`${question.cardId}-${index}`} question={question} onAnswer={handleAnswer} />
    </div>
  )
}
