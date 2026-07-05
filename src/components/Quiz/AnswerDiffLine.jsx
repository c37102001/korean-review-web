const STATUS_CLASS = {
  match: 'diff-match',
  wrong: 'diff-wrong',
  'missing-char': 'diff-missing-char',
  'missing-space': 'diff-missing-space',
}

export default function AnswerDiffLine({ segments }) {
  return (
    <div className="diff-line">
      {segments.map((seg, i) => (
        <span key={i} className={STATUS_CLASS[seg.status]}>
          {seg.text}
        </span>
      ))}
    </div>
  )
}
