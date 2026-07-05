// Builds one quiz question per card, given a practice config chosen up front:
//   { direction: 'zh2ko' | 'ko2zh', unit: 'word' | 'sentence' }
//
// zh2ko is always a typing question (kind: 'typing') — the user types the
// Korean, gets a character-level diff against the answer (see answerDiff.js)
// on "確認", and can always fall back to "公佈答案". ko2zh is always a
// recall question (kind: 'recall') — no input, just "顯示答案" then
// self-graded 答對/答錯. There is no multiple choice in this design.
//
// Question shape:
// { cardId, questionType: 'word'|'sentence', kind: 'typing'|'recall', prompt, hint, answer }
//
// A card that doesn't support the chosen unit (e.g. a word with no examples
// asked in 'sentence' mode) yields null and is filtered out by the caller.

const FORM_LABELS = {
  dictionary: '原形',
  polite_present: '요體現在式',
  polite_past: '過去式',
  past: '過去式',
  future: '未來式',
  future_commitment: '未來式（承諾）',
  request: '請求形',
  imperative_polite: '請求/命令形',
  adverb: '副詞形',
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function wordQuestion(card, direction) {
  if (direction === 'ko2zh') {
    return {
      cardId: card.id,
      questionType: 'word',
      kind: 'recall',
      prompt: card.ko,
      hint: '這個字的意思是？',
      answer: card.zh,
    }
  }

  const formKeys = Object.keys(card.forms || {}).filter((k) => card.forms[k])
  if (formKeys.length > 1 && Math.random() < 0.4) {
    const baseKey = formKeys.includes('dictionary') ? 'dictionary' : formKeys[0]
    const targetKeys = formKeys.filter((k) => k !== baseKey)
    const targetKey = pickRandom(targetKeys)
    const label = FORM_LABELS[targetKey] || targetKey
    return {
      cardId: card.id,
      questionType: 'word',
      kind: 'typing',
      prompt: `${card.zh}（${label}）`,
      hint: '請輸入韓文',
      answer: card.forms[targetKey],
    }
  }

  let prompt = card.zh
  if ((card.senses || []).length && Math.random() < 0.4) {
    const sense = pickRandom(card.senses)
    prompt = sense.pattern ? `${sense.zh}（${sense.pattern}）` : sense.zh
  }
  return {
    cardId: card.id,
    questionType: 'word',
    kind: 'typing',
    prompt,
    hint: '請輸入韓文',
    answer: card.ko,
  }
}

function sentenceQuestion(card, direction) {
  const examples = card.examples || []
  if (!examples.length) return null
  const example = pickRandom(examples)
  if (direction === 'ko2zh') {
    return {
      cardId: card.id,
      questionType: 'sentence',
      kind: 'recall',
      prompt: example.ko,
      hint: '這句話的意思是？',
      answer: example.zh,
    }
  }
  return {
    cardId: card.id,
    questionType: 'sentence',
    kind: 'typing',
    prompt: example.zh,
    hint: '請輸入韓文句子',
    answer: example.ko,
  }
}

function splitContrastItem(item) {
  const [dictForm, conjFormRaw] = (item.ko || '').split('→').map((s) => s?.trim())
  const conjForm = conjFormRaw || dictForm
  const zhParts = (item.zh || '').split(/[：:]/)
  const meaning = zhParts[0]?.trim() || item.zh || ''
  const example = zhParts.length > 1 ? zhParts.slice(1).join('：').trim() : null
  return { dictForm, conjForm, meaning, example }
}

function contrastQuestion(card, direction) {
  const parsedItems = (card.items || []).map(splitContrastItem).filter((p) => p.conjForm)
  if (parsedItems.length < 2) return null
  const target = pickRandom(parsedItems)

  if (direction === 'ko2zh') {
    return {
      cardId: card.id,
      questionType: 'word',
      kind: 'recall',
      prompt: target.conjForm,
      hint: '這個字的意思是？',
      answer: target.meaning,
    }
  }

  let prompt = `「${target.meaning}」該用哪一個？`
  if (target.example) {
    const blanked = target.example.includes(target.conjForm)
      ? target.example.replace(target.conjForm, '＿＿＿')
      : target.example
    prompt = `${blanked}（${target.meaning}）`
  }
  return {
    cardId: card.id,
    questionType: 'word',
    kind: 'typing',
    prompt,
    hint: '請輸入正確的字',
    answer: target.conjForm,
  }
}

export function generateQuestionForCard(card, config) {
  const { direction, unit } = config
  if (card.kind === 'contrast') {
    if (unit === 'sentence') return null
    return contrastQuestion(card, direction)
  }
  if (unit === 'sentence') return sentenceQuestion(card, direction)
  return wordQuestion(card, direction)
}

export function buildQuizQuestions(poolCards, config) {
  return poolCards.map((card) => generateQuestionForCard(card, config)).filter(Boolean)
}
