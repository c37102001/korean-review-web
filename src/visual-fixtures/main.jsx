import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { WordCard } from '../features/word-library/components/WordPresentation.jsx';
import NotesNotebookPage from '../features/notes/pages/NotesNotebookPage.jsx';
import { YoutubeSubtitleReader } from '../features/subtitles/pages/YoutubeSubtitleReader.jsx';
import { ReadingTestPage } from '../features/reading/pages/ReadingTestPage.jsx';
import { StudyPage } from '../features/sessions/study/StudyPage.jsx';
import { PracticePage } from '../features/sessions/practice/PracticePage.jsx';
import { createFixedWordPracticeSession, createStudySession, PRACTICE_ORDER_POLICY } from '../features/sessions/core/sessionDefinitions.js';
import { folders, notes, questions, readingTest, subtitle, words } from './data.js';
import '../styles.css';

const noop = () => {};
const asyncNoop = async () => {};

function CollectionFixture({ folder = false }) {
  return (
    <section className="page notebook-page fixture-page">
      <div className="topbar"><div><span className="eyebrow">{folder ? 'Folder' : 'Notebook'}</span><h1>{folder ? folders[0].name : '單字本'}</h1></div></div>
      <div className="word-grid">
        {words.map((word) => <WordCard key={word.id} word={word} folders={folders} onSpeak={noop} onEdit={noop} onDelete={asyncNoop} onToggleStar={noop} selectable onToggleSelected={noop} />)}
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
  if (fixture === 'word-card') content = <section className="page fixture-page"><WordCard word={words[1]} folders={folders} onSpeak={noop} onEdit={noop} onDelete={asyncNoop} onToggleStar={noop} selectable onToggleSelected={noop} /></section>;
  else if (fixture === 'notebook') content = <CollectionFixture />;
  else if (fixture === 'folder') content = <CollectionFixture folder />;
  else if (fixture === 'study') content = <StudyPage store={store} updateStore={updateStore} set={createStudySession(words, '視覺測試')} allItems={words} folders={folders} onUpdateRecord={asyncNoop} {...commonClassification} />;
  else if (fixture === 'practice') {
    const session = createFixedWordPracticeSession(questions, '視覺測試');
    session.policy = { ...session.policy, order: PRACTICE_ORDER_POLICY.FIXED };
    content = <PracticePage store={store} updateStore={updateStore} set={session} allItems={words} folders={folders} onUpdateRecord={asyncNoop} {...commonClassification} />;
  }
  else if (fixture === 'yt-reader') content = <YoutubeSubtitleReader note={subtitle} allItems={words} folders={folders} onAddRecords={asyncNoop} onBack={noop} onOpenFolder={noop} onSave={asyncNoop} onDelete={asyncNoop} />;
  else if (fixture === 'notes') content = <NotesNotebookPage notes={notes} loading={false} error="" onSave={asyncNoop} onDelete={asyncNoop} onPractice={noop} />;
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
