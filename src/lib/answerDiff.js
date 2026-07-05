// Character-level diff between a typed answer and the correct answer, used
// to give "which character is wrong" feedback on typing questions. Standard
// Wagner-Fischer edit distance (substitution/insert/delete all cost 1) with
// backtrace — a rule-based approach misses too many edge cases (a real diff
// algorithm handles shifted/inserted/deleted runs correctly by construction).
//
// Punctuation is ignored entirely (stripped before comparing), and both
// strings are NFC-normalized first so visually-identical Hangul composed
// differently at the Unicode level never registers as a false mismatch.

const PUNCTUATION_REGEX = /[.,!?~。，！？、；：·…\-—()「」『』"'"'“”‘’]/g

function normalize(text) {
  return (text || '').normalize('NFC').replace(PUNCTUATION_REGEX, '')
}

// Returns { isCorrect, segments } where segments is an ordered list of
// { text, status } — status is one of:
//   'match'          -> typed correctly
//   'wrong'          -> typed but incorrect (substitution) or extra (insertion)
//   'missing-char'   -> a non-space character the user never typed
//   'missing-space'  -> a space the user never typed
// Plain minimum edit distance has ties: when several alignments cost the
// same, Levenshtein alone may pick one that substitutes a character that
// actually recurs correctly elsewhere (confusing to read as feedback). To
// match human intuition, cells track {cost, charMatches, spaceMatches}
// triples: among equal-cost alignments, prefer the one matching the most
// real characters first, then the most spaces — a match on an actual
// syllable is more informative to the reader than a match on a space.
function better(a, b) {
  if (a.cost !== b.cost) return a.cost < b.cost ? a : b
  if (a.charMatches !== b.charMatches) return a.charMatches > b.charMatches ? a : b
  return a.spaceMatches >= b.spaceMatches ? a : b
}

export function diffTypedAnswer(userInput, correctAnswer) {
  const ref = normalize(correctAnswer)
  const hyp = normalize(userInput)

  const n = ref.length
  const m = hyp.length
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1))
  for (let i = 0; i <= n; i += 1) dp[i][0] = { cost: i, charMatches: 0, spaceMatches: 0 }
  for (let j = 0; j <= m; j += 1) dp[0][j] = { cost: j, charMatches: 0, spaceMatches: 0 }
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const isMatch = ref[i - 1] === hyp[j - 1]
      const isSpace = ref[i - 1] === ' '
      const diag = isMatch
        ? {
            cost: dp[i - 1][j - 1].cost,
            charMatches: dp[i - 1][j - 1].charMatches + (isSpace ? 0 : 1),
            spaceMatches: dp[i - 1][j - 1].spaceMatches + (isSpace ? 1 : 0),
          }
        : {
            cost: dp[i - 1][j - 1].cost + 1,
            charMatches: dp[i - 1][j - 1].charMatches,
            spaceMatches: dp[i - 1][j - 1].spaceMatches,
          }
      const up = {
        cost: dp[i - 1][j].cost + 1,
        charMatches: dp[i - 1][j].charMatches,
        spaceMatches: dp[i - 1][j].spaceMatches,
      }
      const left = {
        cost: dp[i][j - 1].cost + 1,
        charMatches: dp[i][j - 1].charMatches,
        spaceMatches: dp[i][j - 1].spaceMatches,
      }
      dp[i][j] = better(better(diag, up), left)
    }
  }

  const ops = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    const here = dp[i][j]
    const diagCell = i > 0 && j > 0 ? dp[i - 1][j - 1] : null
    const upCell = i > 0 ? dp[i - 1][j] : null
    if (
      diagCell &&
      ref[i - 1] === hyp[j - 1] &&
      here.cost === diagCell.cost &&
      here.charMatches === diagCell.charMatches + (ref[i - 1] === ' ' ? 0 : 1) &&
      here.spaceMatches === diagCell.spaceMatches + (ref[i - 1] === ' ' ? 1 : 0)
    ) {
      ops.push({ type: 'match', ch: ref[i - 1] })
      i -= 1
      j -= 1
    } else if (
      diagCell &&
      here.cost === diagCell.cost + 1 &&
      here.charMatches === diagCell.charMatches &&
      here.spaceMatches === diagCell.spaceMatches
    ) {
      ops.push({ type: 'sub', ch: hyp[j - 1] })
      i -= 1
      j -= 1
    } else if (
      upCell &&
      here.cost === upCell.cost + 1 &&
      here.charMatches === upCell.charMatches &&
      here.spaceMatches === upCell.spaceMatches
    ) {
      ops.push({ type: 'del', ch: ref[i - 1] })
      i -= 1
    } else {
      ops.push({ type: 'ins', ch: hyp[j - 1] })
      j -= 1
    }
  }
  ops.reverse()

  const isCorrect = ops.every((op) => op.type === 'match')

  const segments = ops.map((op) => {
    if (op.type === 'match') return { text: op.ch, status: 'match' }
    if (op.type === 'sub' || op.type === 'ins') return { text: op.ch, status: 'wrong' }
    // 'del' -> present in the answer but never typed
    return op.ch === ' ' ? { text: '_', status: 'missing-space' } : { text: '□', status: 'missing-char' }
  })

  return { isCorrect, segments }
}
