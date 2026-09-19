export function koreanTextMatches(text, words = []) {
  const source = String(text || '');
  const byKorean = new Map();
  words.forEach((word) => {
    const ko = String(word?.ko || '').trim();
    if (ko && !byKorean.has(ko)) byKorean.set(ko, word);
  });
  const candidates = [...byKorean.entries()]
    .map(([ko, word]) => ({ ko, word }))
    .sort((left, right) => right.ko.length - left.ko.length || left.ko.localeCompare(right.ko, 'ko'));
  const found = [];
  candidates.forEach((candidate) => {
    let start = source.indexOf(candidate.ko);
    while (start >= 0) {
      found.push({ start, end: start + candidate.ko.length, word: candidate.word });
      start = source.indexOf(candidate.ko, start + candidate.ko.length);
    }
  });
  return found
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .reduce((accepted, match) => {
      const previous = accepted[accepted.length - 1];
      if (!previous || match.start >= previous.end) accepted.push(match);
      return accepted;
    }, []);
}

export function naverKoreanDictionaryUrl(text) {
  return `https://korean.dict.naver.com/kozhdict/#/search?query=${encodeURIComponent(String(text || '').trim())}`;
}

export function isRepeatedWordActivation(previous, key, now, maximumDelay = 420) {
  return previous?.key === key && now - previous.time <= maximumDelay;
}
