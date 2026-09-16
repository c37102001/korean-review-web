import { createContext, useContext, useMemo } from 'react';
import { useWordFolders } from '../features/folders/hooks/useWordFolders.js';
import { useGrammarNotes } from '../features/notes/hooks/useGrammarNotes.js';
import { useReadingTests } from '../features/reading/hooks/useReadingTests.js';
import { useYoutubeSubtitles } from '../features/subtitles/hooks/useYoutubeSubtitles.js';
import { routeDataPolicy } from './navigation.js';

const AppDataContext = createContext(null);

export function AppDataProvider({ user, page, practiceKind, children }) {
  const policy = routeDataPolicy(page, practiceKind);
  const grammar = useGrammarNotes(user, policy.grammar);
  const youtubeSubtitles = useYoutubeSubtitles(user, policy.youtubeSubtitles);
  const readingTests = useReadingTests(user, policy.readingTests);
  const folders = useWordFolders(user, policy.folders);
  const value = useMemo(() => ({
    policy,
    grammar,
    youtubeSubtitles,
    readingTests,
    folders,
  }), [policy.grammar, policy.youtubeSubtitles, policy.readingTests, policy.folders,
    grammar, youtubeSubtitles, readingTests, folders]);
  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const value = useContext(AppDataContext);
  if (!value) throw new Error('useAppData must be used inside AppDataProvider');
  return value;
}
