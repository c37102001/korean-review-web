import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppErrorBoundary } from '../app/AppErrorBoundary.jsx';

import { WordCard } from '../features/word-library/components/WordPresentation.jsx';
import { AddItemsForm } from '../features/word-import/components/WordImportForm.jsx';
import { WordChineseVisibilityButton } from '../features/word-library/components/WordCollectionView.jsx';
import { useWordCollection } from '../features/word-library/hooks/useWordCollection.js';
import NotesNotebookPage from '../features/notes/pages/NotesNotebookPage.jsx';
import { YoutubeSubtitleReader } from '../features/subtitles/pages/YoutubeSubtitleReader.jsx';
import { ReadingTestPage } from '../features/reading/pages/ReadingTestPage.jsx';
import { StudyPage } from '../features/sessions/study/StudyPage.jsx';
import { PracticePage } from '../features/sessions/practice/PracticePage.jsx';
import { createFixedWordPracticeSession, createStudySession, PRACTICE_ORDER_POLICY, PRACTICE_RETRY_POLICY } from '../features/sessions/core/sessionDefinitions.js';
import { folders, notes, questions, readingTest, subtitle, words } from './data.js';
import '../styles.css';

const noop = () => {};
const asyncNoop = async () => {};

function BrokenFixture() {
  throw new Error('Test render failure');
}

function CollectionFixture({ folder = false }) {
  const collection = useWordCollection({ items: words, questions, folders, sourceKey: folder ? 'folder' : 'notebook' });
  return (
    <section className="page notebook-page fixture-page">
      <div className="topbar">
        <div><span className="eyebrow">{folder ? 'Folder' : 'Notebook'}</span><h1>{folder ? folders[0].name : '單字本'}</h1></div>
        <div className="actions"><WordChineseVisibilityButton visible={collection.showAllChinese} onToggle={collection.toggleAllChinese} /></div>
      </div>
      <div className="word-grid">
        {words.map((word) => <WordCard key={word.id} word={word} folders={folders} onSpeak={noop} onEdit={noop} onDelete={asyncNoop} onToggleStar={noop} selectable onToggleSelected={noop} showChinese={collection.isChineseVisible(word.id)} onToggleChinese={() => collection.toggleChinese(word.id)} />)}
      </div>
    </section>
  );
}

function FixtureApp() {
  const [store, setStore] = useState({ starred: [], progress: {}, attempts: [] });
  const fixture = new URLSearchParams(window.location.search).get('case') || 'word-card';
  const updateStore = (updater) => setStore((current) => typeof updater === 'function' ? updater(current) : updater);
  const commonClassification = {
    learnedWordIds: new Set(), unfamiliarWordIds: new Set(),
    onToggleLearned: asyncNoop, onToggleUnfamiliar: asyncNoop,
  };
  let content;
  if (fixture === 'word-card') content = <section className="page fixture-page"><WordCard word={words[1]} folders={folders} onSpeak={noop} onEdit={noop} onDelete={asyncNoop} onToggleStar={noop} selectable onToggleSelected={noop} onToggleChinese={noop} /></section>;
  else if (fixture === 'word-edit') content = <section className="page fixture-page"><AddItemsForm title="編輯單字" date={words[0].date} editItem={words[0]} allItems={words} folders={folders} onUpdateRecord={async (record) => { window.__wordEditResult = record; }} /></section>;
  else if (fixture === 'word-import') content = <section className="page fixture-page"><AddItemsForm title="新增單字" date="2026-09-21" onWriteRecords={async (records) => { window.__wordImportResult = records; }} /></section>;
  else if (fixture === 'notebook') content = <CollectionFixture />;
  else if (fixture === 'folder') content = <CollectionFixture folder />;
  else if (fixture === 'study') content = <StudyPage store={store} updateStore={updateStore} set={createStudySession(words, '視覺測試')} allItems={words} folders={folders} onUpdateRecord={asyncNoop} {...commonClassification} />;
  else if (fixture === 'practice') {
    const session = createFixedWordPracticeSession(questions, '視覺測試');
    session.policy = { ...session.policy, order: PRACTICE_ORDER_POLICY.FIXED };
    content = <PracticePage store={store} updateStore={updateStore} set={session} allItems={words} folders={folders} onUpdateRecord={asyncNoop} {...commonClassification} />;
  }
  else if (fixture === 'practice-recovery' || fixture === 'practice-repeat') {
    const session = createFixedWordPracticeSession([questions[0]], '流程測試', {
      onComplete: fixture === 'practice-recovery' ? async () => {
        window.__completionAttempts = (window.__completionAttempts || 0) + 1;
        if (window.__completionAttempts === 1) throw new Error('暫時無法儲存');
      } : null,
    });
    session.policy = { ...session.policy, order: PRACTICE_ORDER_POLICY.FIXED, retry: fixture === 'practice-repeat' ? PRACTICE_RETRY_POLICY.REPEATABLE : PRACTICE_RETRY_POLICY.MISTAKES };
    content = <PracticePage store={store} updateStore={updateStore} set={session} allItems={words} folders={folders} {...commonClassification} />;
  }
  else if (fixture === 'yt-reader') content = <YoutubeSubtitleReader note={subtitle} allItems={words} folders={folders} onAddRecords={asyncNoop} onBack={noop} onOpenFolder={noop} onSave={asyncNoop} onDelete={asyncNoop} />;
  else if (fixture === 'yt-reader-video') content = <YoutubeSubtitleReader note={{ ...subtitle, videoId: 'subtitle-video' }} allItems={words} folders={folders} onAddRecords={asyncNoop} onBack={noop} onOpenFolder={noop} onSave={asyncNoop} onDelete={asyncNoop} />;
  else if (fixture === 'notes') content = <NotesNotebookPage notes={notes} loading={false} error="" onSave={asyncNoop} onDelete={asyncNoop} onPractice={noop} />;
  else if (fixture === 'render-error') content = <AppErrorBoundary><BrokenFixture /></AppErrorBoundary>;
  else content = <ReadingTestPage test={readingTest} allItems={words} folders={folders} onAddRecords={asyncNoop} onUpdateRecord={asyncNoop} onDeleteRecord={asyncNoop} onOpenFolder={noop} onSave={asyncNoop} onDelete={asyncNoop} onBack={noop} />;
  return (
    <main
      className="visual-fixture"
      data-fixture={fixture}
      style={{ '--mobile-nav-height': '66px', '--mobile-card-edge-gap': '8px' }}
    >
      {content}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<FixtureApp />);
