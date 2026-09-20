export function koreanTextMatches(text, words = []) {
  const source = String(text || '');
  const bySurface = new Map();
  words.forEach((word) => {
    const surfaces = [...new Set([word?.ko, ...(word?.variants || [])]
      .map((value) => String(value || '').trim().normalize('NFC'))
      .filter(Boolean))];
    surfaces.forEach((surface) => {
      const matches = bySurface.get(surface) || [];
      if (!matches.some((candidate) => candidate.id === word.id && candidate.ko === word.ko)) matches.push(word);
      bySurface.set(surface, matches);
    });
  });
  const candidates = [...bySurface.entries()]
    .map(([surface, matches]) => ({ surface, words: matches }))
    .sort((left, right) => right.surface.length - left.surface.length || left.surface.localeCompare(right.surface, 'ko'));
  const found = [];
  candidates.forEach((candidate) => {
    let start = source.indexOf(candidate.surface);
    while (start >= 0) {
      found.push({ start, end: start + candidate.surface.length, word: candidate.words[0], words: candidate.words });
      start = source.indexOf(candidate.surface, start + candidate.surface.length);
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
