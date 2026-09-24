import { firestoreTimestampIso } from '../shared/firestoreTimestamp.js';
import { createId } from '../shared/id.js';
import { normalizeTextHighlights } from '../features/text-selection/model.js';

export const UNTAGGED_READING_TEST_LABEL = '無標籤';

export const READING_TEST_JSON_SAMPLE = `{
  "schemaVersion": 2,
  "data": [
    {
      "tag": "TOPIK",
      "passage": {
        "ko": "최근에는 필요한 물건을 직접 사기보다 빌려 쓰는 사람들이 많아지고 있다.",
        "zh": "最近，比起直接購買所需物品，租借使用的人愈來愈多。"
      },
      "questions": [
        {
          "id": "1",
          "question": {
            "ko": "이 글의 내용과 같은 것을 고르십시오.",
            "zh": "請選出與文章內容相符的選項。"
          },
          "options": [
            { "id": "1", "ko": "캠핑 용품은 직접 사는 것이 더 싸다.", "zh": "露營用品直接購買比較便宜。" },
            { "id": "2", "ko": "물건을 빌려 쓰는 사람은 점점 줄고 있다.", "zh": "租借物品使用的人正在逐漸減少。" },
            { "id": "3", "ko": "자주 사용하지 않는 물건은 보관하기 편리하다.", "zh": "不常使用的物品很方便保管。" },
            { "id": "4", "ko": "물건을 빌려 쓰면 비용과 자원을 아낄 수 있다.", "zh": "租借物品可以節省費用與資源。" }
          ],
          "answer": "4"
        }
      ],
      "learned": false
    }
  ]
}`;

function normalizeReadingQuestion(input, index) {
  const options = Array.isArray(input?.options)
    ? input.options.map((option, optionIndex) => ({
      id: String(option?.id || optionIndex + 1),
      ko: String(option?.ko || '').trim(),
      zh: String(option?.zh || '').trim(),
    }))
    : [];
  return {
    id: String(input?.id || index + 1),
    question: {
      ko: String(input?.question?.ko || '').trim(),
      zh: String(input?.question?.zh || '').trim(),
    },
    options,
    answer: String(input?.answer || '').trim(),
  };
}

function readingQuestionEntryId(testId, question, questionIndex) {
  return questionIndex === 0 ? `${testId}-question` : `${testId}-question-${question.id}`;
}

function readingOptionEntryId(testId, question, questionIndex, optionId) {
  return questionIndex === 0 ? `${testId}-option-${optionId}` : `${testId}-question-${question.id}-option-${optionId}`;
}

export function readingTestTextEntries(test) {
  if (!test) return [];
  return [
    { id: `${test.id}-passage`, ko: test.passage?.ko || '', zh: test.passage?.zh || '' },
    ...(test.questions || []).flatMap((question, questionIndex) => [
      { id: readingQuestionEntryId(test.id, question, questionIndex), ko: question.question.ko, zh: question.question.zh },
      ...question.options.map((option) => ({
        id: readingOptionEntryId(test.id, question, questionIndex, option.id),
        ko: option.ko,
        zh: option.zh,
      })),
    ]),
  ];
}

export function normalizeReadingTest(input, fallbackId = '') {
  const id = String(input?.id || fallbackId);
  const rawQuestions = Array.isArray(input?.questions)
    ? input.questions
    : [{ id: '1', question: input?.question, options: input?.options, answer: input?.answer }];
  const normalized = {
    id,
    tag: String(input?.tag || '').trim(),
    passage: {
      ko: String(input?.passage?.ko || '').trim(),
      zh: String(input?.passage?.zh || '').trim(),
    },
    questions: rawQuestions.map(normalizeReadingQuestion),
    learned: input?.learned === true,
    order: Number.isSafeInteger(input?.order) ? input.order : 0,
    createdAt: firestoreTimestampIso(input?.createdAt),
    updatedAt: firestoreTimestampIso(input?.updatedAt),
  };
  return {
    ...normalized,
    highlights: normalizeTextHighlights(input?.highlights, readingTestTextEntries(normalized)),
  };
}

export function validateReadingTest(test, index = 0) {
  const label = `第 ${index + 1} 題`;
  if (!test.passage.ko || !test.passage.zh) throw new Error(`${label}的 passage 必須包含 ko 與 zh`);
  if (!test.questions.length || test.questions.length > 3) throw new Error(`${label}的 questions 必須包含 1 至 3 題`);
  const questionIds = test.questions.map((question) => question.id);
  if (new Set(questionIds).size !== questionIds.length) throw new Error(`${label}的題目 id 不可重複`);
  test.questions.forEach((question, questionIndex) => {
    const questionLabel = `${label}的第 ${questionIndex + 1} 個問題`;
    if (!question.question.ko || !question.question.zh) throw new Error(`${questionLabel}的 question 必須包含 ko 與 zh`);
    if (question.options.length < 2) throw new Error(`${questionLabel}至少需要兩個選項`);
    const optionIds = question.options.map((option) => option.id);
    if (new Set(optionIds).size !== optionIds.length) throw new Error(`${questionLabel}的選項 id 不可重複`);
    const incompleteOption = question.options.findIndex((option) => !option.ko || !option.zh);
    if (incompleteOption >= 0) throw new Error(`${questionLabel}的第 ${incompleteOption + 1} 個選項必須包含 id、ko 與 zh`);
    if (!optionIds.includes(question.answer)) throw new Error(`${questionLabel}的 answer 必須是其中一個選項 id`);
  });
  return test;
}

export function parseReadingTestsJson(text, existingTests = []) {
  let parsed;
  try {
    parsed = JSON.parse(String(text || ''));
  } catch {
    throw new Error('閱讀測驗 JSON 格式無法解析');
  }
  if (!parsed || !Array.isArray(parsed.data)) throw new Error('閱讀測驗 JSON 必須是包含 data 陣列的物件');
  if (!parsed.data.length) throw new Error('data 至少需要一題閱讀測驗');
  const existingById = new Map(existingTests.map((test) => [test.id, test]));
  const tests = parsed.data.map((entry, index) => {
    const existing = entry?.id ? existingById.get(String(entry.id)) : null;
    const id = String(entry?.id || createId());
    const merged = {
      ...existing,
      ...entry,
      id,
      order: Number.isSafeInteger(entry?.order) ? entry.order : index,
      createdAt: entry?.createdAt || existing?.createdAt || '',
    };
    if (!Array.isArray(entry?.questions) && (entry?.question || entry?.options || entry?.answer)) delete merged.questions;
    return validateReadingTest(normalizeReadingTest(merged, id), index);
  });
  const ids = tests.map((test) => test.id);
  if (new Set(ids).size !== ids.length) throw new Error('同一份 JSON 中的閱讀題目 id 不可重複');
  return tests;
}

export function formatReadingTestsJson(tests = []) {
  return JSON.stringify({
    schemaVersion: 2,
    data: tests.map((source) => {
      const test = normalizeReadingTest(source, source?.id || '');
      return {
        ...(test.id ? { id: test.id } : {}),
        ...(test.tag ? { tag: test.tag } : {}),
        passage: test.passage,
        questions: test.questions,
        learned: test.learned === true,
        ...(test.highlights?.length ? { highlights: test.highlights } : {}),
        ...(Number.isSafeInteger(test.order) ? { order: test.order } : {}),
      };
    }),
  }, null, 2);
}

export function readingTestTagLabel(test) {
  return String(test?.tag || '').trim() || UNTAGGED_READING_TEST_LABEL;
}

export function groupReadingTestsByTag(tests = []) {
  const groups = new Map();
  tests.forEach((test) => {
    const label = readingTestTagLabel(test);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(test);
  });
  return [...groups.entries()]
    .map(([label, groupedTests]) => ({
      label,
      tests: [...groupedTests].sort((left, right) => Number(left.learned) - Number(right.learned)),
    }))
    .sort((left, right) => {
      if (left.label === UNTAGGED_READING_TEST_LABEL) return 1;
      if (right.label === UNTAGGED_READING_TEST_LABEL) return -1;
      return left.label.localeCompare(right.label, 'zh-TW');
    });
}
