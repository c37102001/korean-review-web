import { createId } from '../shared/id.js';

export const NOTE_CATEGORY_GRAMMAR = 'grammar';
export const NOTE_CATEGORY_VOCABULARY = 'vocabulary';

export function normalizeGrammarNote(note, fallbackId = '') {
  const examples = Array.isArray(note?.examples)
    ? note.examples.map((example, index) => ({
      id: String(example?.id || `${fallbackId || 'grammar'}-example-${index}`),
      ko: String(example?.ko || '').trim(),
      zh: String(example?.zh || '').trim(),
    })).filter((example) => example.ko || example.zh)
    : [];
  return {
    id: String(note?.id || fallbackId),
    title: String(note?.title || '').trim(),
    notes: String(note?.notes || '').trim(),
    examples,
    category: note?.category === NOTE_CATEGORY_VOCABULARY
      ? NOTE_CATEGORY_VOCABULARY
      : NOTE_CATEGORY_GRAMMAR,
    pinned: note?.pinned === true,
    createdAt: String(note?.createdAt || ''),
    updatedAt: String(note?.updatedAt || ''),
  };
}

export function formatGrammarExamplesText(examples = []) {
  return examples
    .filter((example) => example.ko || example.zh)
    .map((example) => `${example.ko || ''}\n${example.zh || ''}`)
    .join('\n\n');
}

export function parseGrammarExamplesText(text, existingExamples = []) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  if (lines.length % 2 !== 0) throw new Error(`第 ${Math.floor(lines.length / 2) + 1} 個例句缺少中文翻譯`);
  const parsed = [];
  for (let index = 0; index < lines.length; index += 2) parsed.push({ ko: lines[index], zh: lines[index + 1] });

  const usedIds = new Set();
  const resolved = parsed.map((example) => {
    const exact = existingExamples.find((current) => (
      !usedIds.has(current.id) && String(current.ko || '').trim() === example.ko && String(current.zh || '').trim() === example.zh
    ));
    if (!exact) return example;
    usedIds.add(exact.id);
    return { ...example, id: exact.id };
  });
  return resolved.map((example, index) => {
    if (example.id) return example;
    const samePosition = existingExamples[index];
    if (samePosition?.id && !usedIds.has(samePosition.id)) {
      usedIds.add(samePosition.id);
      return { ...example, id: samePosition.id };
    }
    const unused = existingExamples.find((current) => current.id && !usedIds.has(current.id));
    if (unused) {
      usedIds.add(unused.id);
      return { ...example, id: unused.id };
    }
    return { ...example, id: createId() };
  });
}

export function formatTaggedNoteText(note) {
  return [
    '[標題]', '', String(note?.title || '').trim(), '',
    '[筆記]', '', String(note?.notes || '').trim(), '',
    '[例句]', '', formatGrammarExamplesText(note?.examples || []),
  ].join('\n').trimEnd();
}

export function parseTaggedNoteText(text, existingExamples = []) {
  const normalized = String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]*\\[ \t]*$/, ''))
    .join('\n');
  const tagPattern = /^\s*\[(標題|筆記|例句)\]\s*$/gm;
  const matches = [...normalized.matchAll(tagPattern)];
  const requiredTags = ['標題', '筆記', '例句'];
  const counts = new Map(requiredTags.map((tag) => [tag, 0]));
  matches.forEach((match) => counts.set(match[1], (counts.get(match[1]) || 0) + 1));
  const missing = requiredTags.filter((tag) => !counts.get(tag));
  if (missing.length) throw new Error(`缺少 ${missing.map((tag) => `[${tag}]`).join('、')} 區段`);
  const duplicated = requiredTags.filter((tag) => counts.get(tag) > 1);
  if (duplicated.length) throw new Error(`${duplicated.map((tag) => `[${tag}]`).join('、')} 不可以重複`);
  const sections = {};
  matches.forEach((match, index) => {
    const contentStart = match.index + match[0].length;
    sections[match[1]] = normalized.slice(contentStart, matches[index + 1]?.index ?? normalized.length).trim();
  });
  if (!sections.標題) throw new Error('[標題] 內容不可留空');
  return {
    title: sections.標題,
    notes: sections.筆記 || '',
    examples: parseGrammarExamplesText(sections.例句 || '', existingExamples),
  };
}
