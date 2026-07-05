// Parsing is deliberately tolerant: the note-taking JSON format has already
// drifted from its own README spec (extra fields like `hanja`/`components`,
// `related` sometimes strings/sometimes objects, extra `type` values like
// `collocation`/`example_sentence`/`contrast`). Only pull fields that exist;
// never assume a strict schema, since future pasted JSON will keep varying.

export function parseRawJson(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('JSON 格式錯誤，請確認貼上的內容是合法 JSON。')
  }
  const data = parsed?.data
  if (!Array.isArray(data)) {
    throw new Error('JSON 內容缺少 "data" 陣列。')
  }
  return data
}

export function normalizeKo(ko) {
  return (ko || '').trim()
}

// Firestore doc IDs can be unicode but must not contain "/" and can't be
// empty/"." /"..". Korean text is otherwise fine to use directly as an ID.
export function cardIdForKo(ko) {
  const safe = normalizeKo(ko).replace(/[/\s]+/g, '_').slice(0, 400)
  return safe || null
}

// Returns 'lexeme' | 'contrast' | null (null = unsupported item, skipped)
export function classifyRawItem(item) {
  if (!item || typeof item !== 'object') return null
  if (item.type === 'contrast' && Array.isArray(item.items) && item.items.length) return 'contrast'
  if (item.ko && item.zh) return 'lexeme'
  return null
}

// Extracts just the "content" fields of a card (no SRS/stat fields) from one
// raw JSON item, for a given classification.
export function buildCardContentFromItem(item, kind) {
  const base = {
    ko: normalizeKo(item.ko),
    zh: item.zh ?? null,
    type: item.type ?? null,
  }
  if (kind === 'contrast') {
    return { ...base, items: item.items ?? [] }
  }
  return {
    ...base,
    pos: item.pos ?? null,
    hanja: item.hanja ?? null,
    forms: item.forms ?? null,
    examples: item.examples ?? [],
    notes: item.notes ?? [],
    related: item.related ?? [],
    senses: item.senses ?? [],
    components: item.components ?? null,
  }
}

// Merges freshly-parsed content into an existing card's content: arrays are
// unioned (dedup by deep equality), objects merged key-wise, scalars take
// the incoming (latest) value. Never overwrites with null/undefined.
export function mergeCardContent(existingContent, incomingContent) {
  const merged = { ...(existingContent || {}) }
  for (const key of Object.keys(incomingContent)) {
    const incomingVal = incomingContent[key]
    if (incomingVal == null) continue
    const existingVal = existingContent?.[key]
    if (Array.isArray(incomingVal)) {
      const existingArr = Array.isArray(existingVal) ? existingVal : []
      const seen = new Set(existingArr.map((v) => JSON.stringify(v)))
      const additions = incomingVal.filter((v) => !seen.has(JSON.stringify(v)))
      merged[key] = [...existingArr, ...additions]
    } else if (typeof incomingVal === 'object') {
      merged[key] = { ...(existingVal || {}), ...incomingVal }
    } else {
      merged[key] = incomingVal
    }
  }
  return merged
}

// Plans an import: given the day's raw items and a map of existing cards
// (id -> card doc, may be empty/partial), returns per-item plan entries plus
// a count of skipped/unsupported items. Pure function, no Firestore access,
// so it can drive both the import preview UI and the actual write.
export function planImport(rawItems, existingCardsById) {
  const entries = []
  let skipped = 0

  for (const item of rawItems) {
    const kind = classifyRawItem(item)
    if (!kind) {
      skipped += 1
      continue
    }
    const content = buildCardContentFromItem(item, kind)
    const id = cardIdForKo(content.ko)
    if (!id) {
      skipped += 1
      continue
    }
    const existing = existingCardsById[id]
    entries.push({
      id,
      kind,
      isNew: !existing,
      mergedContent: mergeCardContent(existing, content),
    })
  }

  return { entries, skipped }
}
