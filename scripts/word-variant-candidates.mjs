import { Action, Adjective, conjugate } from '@dongsa/conjugation';

const PREDICATE = /^[가-힣]+다$/u;
const HANGUL_FORM = /^[가-힣]+$/u;
const LEXICAL_FORMS = new Map([
  ['걷다', ['걸어요', '걷어요']],
  ['계시다', ['계세요']],
  ['묻다', ['묻어요']],
  ['붓다', ['부어요', '붓어요']],
  ['이르다', ['이르러요', '일러요']],
  ['띠다', ['띠어요']],
  ['필연적이다', ['필연적이에요', '필연적인']],
  ['보편적', ['보편적인']],
]);

export function proposeWordVariants(record) {
  const item = record?.item || {};
  if (item.pos !== '動詞' && item.pos !== '形容詞') return { additions: [], reason: '非動詞或形容詞' };
  const lemma = String(item.ko || '').trim().normalize('NFC');
  if (!PREDICATE.test(lemma) && !LEXICAL_FORMS.has(lemma)) {
    return { additions: [], reason: '不是單一韓文原形' };
  }
  if (item.variants !== undefined && !Array.isArray(item.variants)) {
    return { additions: [], reason: '既有活用欄位格式不符' };
  }

  let candidates = LEXICAL_FORMS.get(lemma);
  if (!candidates) {
    let forms;
    try {
      forms = conjugate(lemma, { partOfSpeech: item.pos === '動詞' ? Action : Adjective });
    } catch {
      return { additions: [], reason: '活用工具無法解析' };
    }
    const wanted = item.pos === '形容詞'
      ? ['declarativePresentInformalHigh', 'adnominalPresent']
      : ['declarativePresentInformalHigh'];
    candidates = wanted.map((name) => forms.find((entry) => entry.conjugationName === name)?.conjugated?.normalize('NFC'));
  }
  const existing = new Set((item.variants || []).map((value) => String(value).trim().normalize('NFC')));
  const additions = [];
  for (const form of candidates) {
    if (!form || !HANGUL_FORM.test(form) || form === lemma) {
      return { additions: [], reason: '無法確認活用形式' };
    }
    if (!existing.has(form)) {
      additions.push(form);
      existing.add(form);
    }
  }
  return { additions, reason: additions.length ? '' : '已包含常用活用' };
}

export function buildVariantPlan(records) {
  const changes = [];
  const skipped = [];
  for (const record of records) {
    if (record.deletedAt) continue;
    const { additions, reason } = proposeWordVariants(record);
    if (additions.length) {
      changes.push({ id: record._docId || record.id, ko: record.item.ko, pos: record.item.pos, additions });
    } else if (record.item?.pos === '動詞' || record.item?.pos === '形容詞') {
      skipped.push({ id: record._docId || record.id, ko: record.item.ko, pos: record.item.pos, reason });
    }
  }
  changes.sort((left, right) => left.id.localeCompare(right.id));
  skipped.sort((left, right) => left.id.localeCompare(right.id));
  return { changes, skipped };
}
