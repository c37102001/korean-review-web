import React, { useRef } from 'react';
import { isRepeatedWordActivation, koreanTextMatches } from '../model.js';

export function SelectableKoreanText({ entry, words = [], highlights = [], onSelectWord, onSelectWords, onOpenWord, onOpenWords, onSelectHighlight, className = '' }) {
  const lastActivationRef = useRef(null);
  const knownMatches = koreanTextMatches(entry.ko, words);
  const highlightMatches = highlights.filter((highlight) => (
    highlight.entryId === entry.id
      && entry.ko.slice(highlight.start, highlight.end) === highlight.text
  ));
  const boundaries = [...new Set([
    0,
    entry.ko.length,
    ...knownMatches.flatMap((match) => [match.start, match.end]),
    ...highlightMatches.flatMap((highlight) => [highlight.start, highlight.end]),
  ])].sort((left, right) => left - right);

  return (
    <span className={className} data-selectable-entry-id={entry.id} lang="ko">
      {boundaries.slice(0, -1).map((start, index) => {
        const end = boundaries[index + 1];
        const text = entry.ko.slice(start, end);
        const known = knownMatches.find((match) => match.start <= start && match.end >= end);
        const highlight = highlightMatches.find((match) => match.start <= start && match.end >= end);
        if (!known && !highlight) return <React.Fragment key={`text-${start}`}>{text}</React.Fragment>;
        const selectMark = (event) => {
          if (!known) {
            onSelectHighlight?.(event, highlight, entry);
            return;
          }
          const now = Date.now();
          const matchedWords = known.words || [known.word];
          const activationKey = `${matchedWords.map((word) => word.id || word.ko).sort().join('|')}:${start}:${end}`;
          const previous = lastActivationRef.current;
          if ((onOpenWords || onOpenWord) && isRepeatedWordActivation(previous, activationKey, now)) {
            event.preventDefault();
            event.stopPropagation();
            lastActivationRef.current = null;
            if (onOpenWords) onOpenWords(matchedWords);
            else onOpenWord(known.word);
            return;
          }
          lastActivationRef.current = { key: activationKey, time: now };
          if (onSelectWords) onSelectWords(event, matchedWords);
          else onSelectWord?.(event, known.word);
        };
        return (
          <mark
            className={`${known ? 'subtitle-known-word' : ''} ${highlight ? 'reading-text-highlight' : ''}`.trim()}
            onClick={selectMark}
            key={`mark-${start}`}
          >{text}</mark>
        );
      })}
    </span>
  );
}
