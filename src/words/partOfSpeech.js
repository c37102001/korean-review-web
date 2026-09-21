export const WORD_POS_OPTIONS = Object.freeze(['名詞', '動詞', '形容詞', '副詞', '片語', '固定表達', '其他']);

const LEGACY_POS_MAP = Object.freeze({
  名詞: '名詞', 動詞: '動詞', 形容詞: '形容詞', 副詞: '副詞',
  片語: '片語', 動詞片語: '片語', 名詞片語: '片語', 副詞片語: '片語', 形容詞片語: '片語',
  慣用句: '固定表達', 慣用表達: '固定表達', 諺語: '固定表達',
  固定表達: '固定表達',
  冠形詞: '其他', 代名詞: '其他', 依存名詞: '其他', 助詞: '其他', 接尾詞: '其他',
  文法: '其他', 文法表達: '其他', 實用表達: '其他', 句子: '其他', 比較: '其他',
  其他: '其他',
});

export function normalizeWordPos(value) {
  return typeof value === 'string' ? LEGACY_POS_MAP[value.trim()] || '' : '';
}

export function isAllowedWordPos(value) {
  return WORD_POS_OPTIONS.includes(value);
}
