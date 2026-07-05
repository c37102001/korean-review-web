// Builds one quiz question per due card. Every question is either:
//   - kind: 'mc'     -> multiple choice, auto-graded by comparing the chosen
//                        option id to `correctOptionId`
//   - kind: 'recall' -> the user thinks of the answer, taps "顯示答案", then
//                        self-grades (matches the "主動回想" method from the
//                        note's own Ebbinghaus write-up; typed Korean/Chinese
//                        matching would be unreliable to auto-grade fairly)
//
// Question shape:
// {
//   cardId, questionType, kind, prompt, hint, options, correctOptionId, answer
// }
//
// Multiple-choice questions always fall back to a recall question when there
// aren't enough distractor candidates yet (e.g. only a handful of cards
// exist early on) — a 1-option "choice" isn't a real question.

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

function shuffle(array) {
  const result = [...array]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

// Builds an mc question from `distractors`, or degrades to a recall question
// if there's no usable distractor (guarantees the correct value is always
// present and never silently dropped by truncation).
function mcOrRecall(meta, correctValue, distractors) {
  const seen = new Set([correctValue])
  const uniqueDistractors = []
  for (const v of shuffle(distractors)) {
    if (!v || seen.has(v)) continue
    seen.add(v)
    uniqueDistractors.push(v)
  }

  if (uniqueDistractors.length === 0) {
    return { ...meta, kind: 'recall', options: null, correctOptionId: null, answer: correctValue }
  }

  const finalValues = shuffle([correctValue, ...uniqueDistractors.slice(0, 3)])
  const options = finalValues.map((v, i) => ({ id: `opt-${i}`, label: v }))
  const correctOptionId = options.find((o) => o.label === correctValue).id
  return { ...meta, kind: 'mc', options, correctOptionId, answer: correctValue }
}

function recallQuestion(meta, answer) {
  return { ...meta, kind: 'recall', options: null, correctOptionId: null, answer }
}

function relatedKoList(card) {
  return (card.related || [])
    .map((r) => (typeof r === 'string' ? r : r?.ko))
    .filter(Boolean)
}

function otherLexemeCards(allCards, excludeId, preferPos) {
  const pool = allCards.filter((c) => c.id !== excludeId && c.kind === 'lexeme' && c.zh && c.ko)
  const preferred = preferPos ? pool.filter((c) => c.pos === preferPos) : []
  const rest = pool.filter((c) => !preferred.includes(c))
  return [...shuffle(preferred), ...shuffle(rest)]
}

function ko2zhQuestion(card, allCards) {
  const meta = { cardId: card.id, questionType: 'ko2zh', prompt: card.ko, hint: '這個字的意思是？' }
  if (Math.random() < 0.5) return recallQuestion(meta, card.zh)
  const distractors = otherLexemeCards(allCards, card.id, card.pos).slice(0, 8).map((c) => c.zh)
  return mcOrRecall(meta, card.zh, distractors)
}

function zh2koQuestion(card, allCards) {
  const meta = { cardId: card.id, questionType: 'zh2ko', prompt: card.zh, hint: '這個意思的韓文是？' }
  const distractors = [
    ...relatedKoList(card),
    ...otherLexemeCards(allCards, card.id, card.pos).map((c) => c.ko),
  ]
  return mcOrRecall(meta, card.ko, distractors)
}

function similarQuestion(card, allCards) {
  const related = relatedKoList(card)
  const example = (card.examples || [])[0]
  let prompt = `「${card.zh}」最適合用哪個字？`
  if (example?.ko) {
    const blanked = example.ko.includes(card.ko)
      ? example.ko.replace(card.ko, '＿＿＿')
      : example.ko
    prompt = `${blanked}（${example.zh || card.zh}）`
  }
  const meta = { cardId: card.id, questionType: 'similar', prompt, hint: '選出正確的字' }
  const distractors = [...related, ...otherLexemeCards(allCards, card.id, card.pos).map((c) => c.ko)]
  return mcOrRecall(meta, card.ko, distractors)
}

function sentenceQuestion(card, allCards) {
  const example = pickRandom(card.examples)
  const meta = { cardId: card.id, questionType: 'sentence', prompt: example.ko, hint: '這句話的意思是？' }
  if (Math.random() < 0.5) return recallQuestion(meta, example.zh)
  const distractors = otherLexemeCards(allCards, card.id, card.pos)
    .map((c) => (c.examples || [])[0]?.zh)
    .filter(Boolean)
  return mcOrRecall(meta, example.zh, distractors)
}

function conjugationQuestion(card, allCards) {
  const formKeys = Object.keys(card.forms || {}).filter((k) => card.forms[k])
  const baseKey = formKeys.includes('dictionary') ? 'dictionary' : formKeys[0]
  const targetKeys = formKeys.filter((k) => k !== baseKey)
  const targetKey = pickRandom(targetKeys)
  const baseForm = card.forms[baseKey] || card.ko
  const targetLabel = FORM_LABELS[targetKey] || targetKey
  const answer = card.forms[targetKey]
  const meta = {
    cardId: card.id,
    questionType: 'conjugation',
    prompt: `${baseForm}（${targetLabel}）`,
    hint: '這個變化形是？',
  }
  if (Math.random() < 0.5) return recallQuestion(meta, answer)

  const sameCardValues = targetKeys.filter((k) => k !== targetKey).map((k) => card.forms[k])
  const crossCardValues = (allCards || [])
    .filter((c) => c.id !== card.id && c.forms?.[targetKey])
    .map((c) => c.forms[targetKey])
  return mcOrRecall(meta, answer, [...sameCardValues, ...crossCardValues])
}

function splitContrastItem(item) {
  const [dictForm, conjFormRaw] = (item.ko || '').split('→').map((s) => s?.trim())
  const conjForm = conjFormRaw || dictForm
  const zhParts = (item.zh || '').split(/[：:]/)
  const meaning = zhParts[0]?.trim() || item.zh || ''
  const example = zhParts.length > 1 ? zhParts.slice(1).join('：').trim() : null
  return { dictForm, conjForm, meaning, example }
}

function contrastQuestion(card) {
  const parsedItems = (card.items || []).map(splitContrastItem).filter((p) => p.conjForm)
  if (parsedItems.length < 2) return null
  const target = pickRandom(parsedItems)
  let prompt = `「${target.meaning}」該用哪一個？`
  if (target.example) {
    const blanked = target.example.includes(target.conjForm)
      ? target.example.replace(target.conjForm, '＿＿＿')
      : target.example
    prompt = `${blanked}（${target.meaning}）`
  }
  const meta = { cardId: card.id, questionType: 'similar', prompt, hint: '選出正確的字' }
  const distractors = parsedItems.filter((p) => p !== target).map((p) => p.conjForm)
  const question = mcOrRecall(meta, target.conjForm, distractors)
  // A contrast group with only 2 items and a degraded recall question is
  // still useful, but with 2 items mc is almost always possible; no special-case needed.
  return question
}

export function generateQuestionForCard(card, allCards) {
  if (card.kind === 'contrast') {
    return contrastQuestion(card) || null
  }

  const available = ['ko2zh', 'zh2ko']
  if (relatedKoList(card).length > 0) available.push('similar')
  if ((card.examples || []).length > 0) available.push('sentence')
  if (Object.keys(card.forms || {}).length > 1) available.push('conjugation')

  const type = pickRandom(available)
  switch (type) {
    case 'zh2ko':
      return zh2koQuestion(card, allCards)
    case 'similar':
      return similarQuestion(card, allCards)
    case 'sentence':
      return sentenceQuestion(card, allCards)
    case 'conjugation':
      return conjugationQuestion(card, allCards)
    case 'ko2zh':
    default:
      return ko2zhQuestion(card, allCards)
  }
}

export function buildQuizQuestions(poolCards, allCards) {
  const distractorSource = allCards && allCards.length ? allCards : poolCards
  return poolCards
    .map((card) => generateQuestionForCard(card, distractorSource))
    .filter(Boolean)
}
