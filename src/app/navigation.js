import { useCallback, useState } from 'react';
import { PRACTICE_SESSION_KIND } from '../features/sessions/core/sessionDefinitions.js';

const GRAMMAR_PRACTICE_KINDS = new Set([
  PRACTICE_SESSION_KIND.DAILY_GRAMMAR,
  PRACTICE_SESSION_KIND.OPTIONAL_GRAMMAR,
  PRACTICE_SESSION_KIND.GRAMMAR_EXAMPLES,
]);

export function routeDataPolicy(page, practiceKind = '') {
  return {
    grammar: page === 'home' || page === 'notes'
      || (page === 'practice' && GRAMMAR_PRACTICE_KINDS.has(practiceKind)),
    youtubeSubtitles: page === 'ytSubtitles' || page === 'ytSubtitle',
    readingTests: page === 'readingTests' || page === 'readingTest',
    folders: !['calendar', 'notes', 'ytSubtitles', 'readingTests'].includes(page),
  };
}

export function navigationTransition(state, action) {
  if (action.type === 'top') return { page: action.page, stack: [] };
  if (action.type === 'child') return { page: action.page, stack: [...state.stack, state.page] };
  if (action.type === 'up') {
    if (!state.stack.length) return { page: state.page === 'home' ? 'home' : 'home', stack: [] };
    return {
      page: state.stack[state.stack.length - 1],
      stack: state.stack.slice(0, -1),
    };
  }
  return state;
}

export function useAppNavigation(initialPage = 'home', onTopNavigate) {
  const [navigation, setNavigation] = useState({ page: initialPage, stack: [] });

  const navTop = useCallback((page) => {
    onTopNavigate?.(page);
    setNavigation((current) => navigationTransition(current, { type: 'top', page }));
  }, [onTopNavigate]);

  const navChild = useCallback((page) => {
    setNavigation((current) => navigationTransition(current, { type: 'child', page }));
  }, []);

  const goUp = useCallback(() => {
    setNavigation((current) => navigationTransition(current, { type: 'up' }));
  }, []);

  return {
    page: navigation.page,
    pageStack: navigation.stack,
    navTop,
    navChild,
    goUp,
  };
}
