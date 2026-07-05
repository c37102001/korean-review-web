import { useState } from 'react'
import PracticeSetup from './PracticeSetup.jsx'
import QuizSession from './QuizSession.jsx'

// Wraps the "choose direction/unit" setup step and the quiz session itself,
// so the three practice entry points (today's due list, a calendar day, the
// vocab book) don't each have to reimplement this two-step flow.
export default function PracticeFlow({ pool, title, onRecordReview, onFinish }) {
  const [config, setConfig] = useState(null)

  if (!config) {
    return <PracticeSetup onStart={setConfig} onCancel={onFinish} />
  }

  return (
    <QuizSession
      pool={pool}
      config={config}
      title={title}
      onRecordReview={onRecordReview}
      onChangeMode={() => setConfig(null)}
      onFinish={onFinish}
    />
  )
}
