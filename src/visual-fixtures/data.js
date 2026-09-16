export const folders = [
  { id: 'folder-1', name: '韓檢單字 D27', tag: 'TOPIK', wordIds: ['word-1', 'word-2'] },
  { id: 'folder-2', name: '旅行會話', tag: '生活', wordIds: ['word-2'] },
];

export const words = [
  {
    id: 'word-1', date: '2026-09-16', ko: '어쩌피', zh: '反正、無論如何、終究', pos: '副詞',
    level: '學習中', score: -1, total: 4,
    meanings: [{ id: 'meaning-1', zh: '反正、無論如何', examples: [{ id: 'example-1', ko: '어차피 해야 할 일이에요.', zh: '反正是必須要做的事情。' }] }],
    notes: ['口語中常用來表示結果不會改變。'],
  },
  {
    id: 'word-2', date: '2026-09-15', ko: '아이디어', zh: '想法、意見、主意', pos: '名詞',
    level: '不熟悉', score: -3, total: 2,
    meanings: [{ id: 'meaning-2', zh: '想法、意見、主意', examples: [{ id: 'example-2', ko: '이번에는 새로운 아이디어로 상품을 만들었어요.', zh: '這次用新的點子製作了商品。' }] }],
    notes: [],
  },
];

export const questions = words.map((word) => ({
  id: `question-${word.id}`,
  itemId: word.id,
  date: word.date,
  kind: 'term',
  ko: word.ko,
  zh: word.zh,
  source: word,
}));

export const notes = [
  {
    id: 'note-1', category: 'vocabulary', pinned: true, createdAt: '2026-09-16T08:00:00.000Z',
    title: '나름：按照自己的方式', notes: '用來表達「按照自己的標準」或「取決於怎麼做」。',
    examples: [{ id: 'note-example-1', ko: '저도 나름대로 열심히 했어요.', zh: '我也有用自己的方式努力了。' }],
  },
  {
    id: 'note-2', category: 'grammar', pinned: false, createdAt: '2026-09-15T08:00:00.000Z',
    title: '過去反覆的習慣：-곤 했다', notes: '描述以前反覆發生的習慣。',
    examples: [{ id: 'note-example-2', ko: '어렸을 때 이 공원에서 놀곤 했어요.', zh: '小時候常常在這個公園玩。' }],
  },
];

export const subtitle = {
  id: 'subtitle-1', title: 'What Does Love Mean?', mode: 'json', learned: false,
  entries: [
    { id: 'subtitle-entry-1', ko: '안녕하세요 여러분, 솔 선생님입니다.', zh: '大家好，我是 Sol 老師。', startMs: null },
    { id: 'subtitle-entry-2', ko: '오늘은 여러분들이랑 사랑 얘기를 해볼까 하는데요.', zh: '今天想跟大家聊聊愛情這個話題。', startMs: null },
    { id: 'subtitle-entry-3', ko: '첫눈에 반한 적이 있어요?', zh: '你曾經一見鍾情過嗎？', startMs: null },
  ],
};

export const readingTest = {
  id: 'reading-1', learned: false,
  passage: {
    ko: '최근에는 필요한 물건을 직접 사기보다 빌려 쓰는 사람들이 많아지고 있다.',
    zh: '最近比起直接購買需要的物品，選擇租借使用的人正在增加。',
  },
  question: { ko: '이 글의 내용과 같은 것을 고르십시오.', zh: '請選出與文章內容相符的選項。' },
  options: [
    { id: '1', ko: '물건을 직접 사는 것이 더 싸다.', zh: '直接購買物品比較便宜。' },
    { id: '2', ko: '물건을 빌리면 비용과 자원을 아낄 수 있다.', zh: '租借物品可以節省費用與資源。' },
  ],
  answer: '2',
};
