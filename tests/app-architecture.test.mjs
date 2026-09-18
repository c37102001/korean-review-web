import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PRACTICE_SESSION_KIND } from '../src/features/sessions/core/sessionDefinitions.js';
import { navigationTransition, routeDataPolicy } from '../src/app/navigation.js';

test('route data policy enables only collections required by the active feature', () => {
  assert.deepEqual(routeDataPolicy('calendar'), {
    grammar: false,
    youtubeSubtitles: false,
    readingTests: false,
    folders: false,
  });
  assert.deepEqual(routeDataPolicy('ytSubtitle'), {
    grammar: false,
    youtubeSubtitles: true,
    readingTests: false,
    folders: true,
  });
  assert.equal(routeDataPolicy('practice', PRACTICE_SESSION_KIND.OPTIONAL_GRAMMAR).grammar, true);
  assert.equal(routeDataPolicy('practice', PRACTICE_SESSION_KIND.COLLECTION).grammar, false);
});

test('navigation stack always returns exactly one level', () => {
  const folderList = navigationTransition({ page: 'home', stack: [] }, { type: 'top', page: 'folders' });
  const folderDetail = navigationTransition(folderList, { type: 'child', page: 'folder' });
  const practice = navigationTransition(folderDetail, { type: 'child', page: 'practice' });
  assert.deepEqual(navigationTransition(practice, { type: 'up' }), folderDetail);
  assert.deepEqual(navigationTransition(folderDetail, { type: 'up' }), folderList);
  assert.deepEqual(navigationTransition(folderList, { type: 'up' }), { page: 'home', stack: [] });
});

test('daily wrong review sits between home and its study or practice session', () => {
  const home = { page: 'home', stack: [] };
  const wrongReview = navigationTransition(home, { type: 'child', page: 'wrongReview' });
  for (const page of ['study', 'practice']) {
    const session = navigationTransition(wrongReview, { type: 'child', page });
    assert.deepEqual(navigationTransition(session, { type: 'up' }), wrongReview);
  }
  assert.deepEqual(navigationTransition(wrongReview, { type: 'up' }), home);
});

test('home starts all due words from one daily test instead of rendering date tasks', async () => {
  const source = await readFile(new URL('../src/app/HomeCalendarPages.jsx', import.meta.url), 'utf8');
  assert.match(source, /onPractice\(due, '今日測驗'/);
  assert.doesNotMatch(source, /groupTasks|task\.studyDate/);
});

test('feature collection hooks depend on repositories instead of Firebase SDK', async () => {
  const hookPaths = [
    '../src/features/folders/hooks/useWordFolders.js',
    '../src/features/notes/hooks/useGrammarNotes.js',
    '../src/features/reading/hooks/useReadingTests.js',
    '../src/features/subtitles/hooks/useYoutubeSubtitles.js',
  ];
  const sources = await Promise.all(hookPaths.map((path) => readFile(new URL(path, import.meta.url), 'utf8')));
  sources.forEach((source) => {
    assert.doesNotMatch(source, /firebase\/(?:firestore|auth)/);
    assert.doesNotMatch(source, /doc\(db|collection\(db|writeBatch\(db/);
  });
});

test('content library routes are lazy chunks and never import the app entry', async () => {
  const runtimeSource = await readFile(new URL('../src/app/AppRuntime.jsx', import.meta.url), 'utf8');
  const mainSource = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const routePaths = [
    '../src/features/notes/pages/NotesNotebookPage.jsx',
    '../src/features/reading/pages/ReadingTestPage.jsx',
    '../src/features/reading/pages/ReadingTestsPage.jsx',
    '../src/features/subtitles/pages/YoutubeSubtitleReader.jsx',
    '../src/features/subtitles/pages/YoutubeSubtitlesPage.jsx',
  ];
  routePaths.forEach((path) => {
    const modulePath = path.replace('../src/', '../');
    assert.match(runtimeSource, new RegExp(`lazy\\(\\(\\) => import\\('${modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\)`));
  });
  assert.doesNotMatch(mainSource, /lazy\(|features\//);
  const routeSources = await Promise.all(routePaths.map((path) => readFile(new URL(path, import.meta.url), 'utf8')));
  routeSources.forEach((source) => assert.doesNotMatch(source, /from ['"].*main\.jsx['"]/));
});

test('web entry is bootstrap-only and feature readers do not depend on App', async () => {
  const mainSource = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const lines = mainSource.split('\n').filter((line) => line.trim());
  assert.ok(lines.length <= 8);
  assert.match(mainSource, /import App from '\.\/app\/App\.jsx'/);
  assert.doesNotMatch(mainSource, /function App|useState|firebase|Firestore/);

  const readers = await Promise.all([
    '../src/features/reading/pages/ReadingTestPage.jsx',
    '../src/features/subtitles/pages/YoutubeSubtitleReader.jsx',
  ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')));
  readers.forEach((source) => assert.doesNotMatch(source, /app\/App|main\.jsx/));
});

test('study and practice pages are owned by the sessions feature', async () => {
  const runtimeSource = await readFile(new URL('../src/app/AppRuntime.jsx', import.meta.url), 'utf8');
  const sessionSource = await readFile(new URL('../src/features/sessions/SessionPages.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(runtimeSource, /function (?:StudyPage|PracticePage)\b/);
  assert.match(runtimeSource, /import\('\.\.\/features\/sessions\/study\/StudyPage\.jsx'\)/);
  assert.match(runtimeSource, /import\('\.\.\/features\/sessions\/practice\/PracticePage\.jsx'\)/);
  assert.doesNotMatch(sessionSource, /function |useState|useEffect/);
  assert.match(sessionSource, /export \{ StudyPage \}/);
  assert.match(sessionSource, /export \{ PracticePage \}/);
});
