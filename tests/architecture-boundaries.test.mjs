import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);

async function sourceFiles(directory, extensions) {
  const entries = await readdir(path.join(ROOT, directory), { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(relative, extensions);
    return extensions.some((extension) => entry.name.endsWith(extension)) ? [relative] : [];
  }));
  return nested.flat();
}

async function assertNoImport(files, forbidden, description) {
  for (const file of files) {
    const source = await readFile(path.join(ROOT, file), 'utf8');
    assert.doesNotMatch(source, forbidden, `${file} ${description}`);
  }
}

test('web features never import bootstrap entry points', async () => {
  const files = await sourceFiles('src/features', ['.js', '.jsx']);
  await assertNoImport(files, /(?:from\s+|import\()['"][^'"]*(?:main\.jsx|app\/App\.jsx)['"]/, 'must not import an app entry');
});

test('web domain and model modules never import Firebase adapters', async () => {
  const candidates = [
    ...(await sourceFiles('src/review-engine', ['.js'])),
    ...(await sourceFiles('src/features', ['model.js'])),
    ...(await sourceFiles('src/words', ['.js'])),
  ];
  await assertNoImport(candidates, /from ['"][^'"]*(?:firebase|repositories)\//, 'must remain persistence independent');
});

test('terminal domain never imports curses, HTTP, repositories, or application entry', async () => {
  const files = await sourceFiles('terminal_app/domain', ['.py']);
  await assertNoImport(files, /^(?:from|import)\s+(?:curses|urllib|requests|terminal_app\.repositories|terminal_app\.app)\b/m, 'must remain UI and persistence independent');
});

test('compatibility entries stay bootstrap-only', async () => {
  const webEntry = await readFile(path.join(ROOT, 'src/main.jsx'), 'utf8');
  const terminalEntry = await readFile(path.join(ROOT, 'terminal_review_practice.py'), 'utf8');
  assert.ok(webEntry.split('\n').length <= 80, 'src/main.jsx exceeds 80 lines');
  assert.ok(terminalEntry.split('\n').length <= 100, 'terminal_review_practice.py exceeds 100 lines');
  assert.doesNotMatch(terminalEntry, /class FirebaseClient|def run_terminal_ui/);
});

test('App is orchestration-only and does not access Firebase SDK directly', async () => {
  const source = await readFile(path.join(ROOT, 'src/app/App.jsx'), 'utf8');
  assert.ok(source.split('\n').length <= 500, 'src/app/App.jsx exceeds 500 lines');
  assert.doesNotMatch(source, /from ['"]firebase\/(?:auth|firestore)['"]/);
  assert.doesNotMatch(source, /function (?:HomePage|CalendarPage|NotebookPage|FoldersPage|AppWorkspace)\b/);
});

test('terminal app is orchestration-only and extracted screens stay bounded', async () => {
  const app = await readFile(path.join(ROOT, 'terminal_app/app.py'), 'utf8');
  assert.ok(app.split('\n').length <= 600, 'terminal_app/app.py exceeds 600 lines');
  assert.doesNotMatch(app, /^(?:from|import)\s+(?:urllib|requests|subprocess|terminal_app\.repositories)\b/m);
  assert.doesNotMatch(app, /^class FirebaseClient\b|^def run_(?:study|practice|notebook|calendar)\b/m);

  const screens = await sourceFiles('terminal_app/ui/screens', ['.py']);
  for (const file of screens) {
    const source = await readFile(path.join(ROOT, file), 'utf8');
    assert.ok(source.split('\n').length <= 700, `${file} exceeds 700 lines`);
    assert.doesNotMatch(
      source,
      /^(?:from|import)\s+(?:urllib|requests|subprocess|terminal_app\.repositories)\b/m,
      `${file} must use application services instead of transport or repositories`,
    );
  }
});

test('study and practice sessions have independent bounded page owners', async () => {
  const facade = await readFile(path.join(ROOT, 'src/features/sessions/SessionPages.jsx'), 'utf8');
  assert.ok(facade.split('\n').length <= 20, 'SessionPages.jsx must remain an export-only facade');
  assert.doesNotMatch(facade, /function |useState|useEffect/);

  for (const [file, maximum] of [
    ['src/features/sessions/study/StudyPage.jsx', 500],
    ['src/features/sessions/practice/PracticePage.jsx', 500],
  ]) {
    const source = await readFile(path.join(ROOT, file), 'utf8');
    assert.ok(source.split('\n').length <= maximum, `${file} exceeds ${maximum} lines`);
    assert.doesNotMatch(source, /firebase\/|repositories\//, `${file} must not access persistence adapters`);
  }
});

test('canonical word and session styles have a single owner', async () => {
  const styleFiles = await sourceFiles('src', ['.css']);
  const sources = new Map(await Promise.all(styleFiles.map(async (file) => [
    file,
    await readFile(path.join(ROOT, file), 'utf8'),
  ])));
  const wordOwner = 'src/features/word-library/components/word-presentation.css';
  const wordSelectorFiles = [...sources]
    .filter(([, source]) => /\.word-card(?:\b|[- ])|\.word-meta\b|\.word-folder-tags\b/.test(source))
    .map(([file]) => file);
  assert.deepEqual(wordSelectorFiles, [wordOwner]);

  const responsive = sources.get('src/styles/responsive.css');
  assert.doesNotMatch(responsive, /\.(?:study-page|practice-page|flashcard|practice-shell|practice-answer-panel|quiz-options)\b/);
});
