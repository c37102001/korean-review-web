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
