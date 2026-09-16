import React from 'react';
import { koreanTextMatches } from '../model.js';

export function SelectableKoreanText({ entry, words = [], highlights = [], onSelectWord, onSelectHighlight, className = '' }) {
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
        return (
          <mark
            className={`${known ? 'subtitle-known-word' : ''} ${highlight ? 'reading-text-highlight' : ''}`.trim()}
            onClick={(event) => (known ? onSelectWord?.(event, known.word) : onSelectHighlight?.(event, highlight, entry))}
            key={`mark-${start}`}
          >{text}</mark>
        );
      })}
    </span>
  );
}
