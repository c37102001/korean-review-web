import {
  BookOpen,
  CalendarDays,
  Captions,
  ChevronLeft,
  Folder,
  LibraryBig,
  LogOut,
  NotebookPen,
  Sparkles,
} from 'lucide-react';

function navClass(page, pages) {
  return pages.includes(page) ? 'active' : '';
}

export function AppShell({
  page,
  navTop,
  goUp,
  onLogout,
  status,
  errors = [],
  backButtonClassName = '',
  children,
}) {
  return (
    <div className="app">
      <aside className="sidebar">
        <button className={`brand brand-button ${navClass(page, ['home', 'wrongReview'])}`} onClick={() => navTop('home')}><Sparkles size={24} /> 韓文筆記</button>
        <button className={navClass(page, ['calendar', 'dateNotes'])} onClick={() => navTop('calendar')}><CalendarDays size={18} /> 日曆</button>
        <button className={navClass(page, ['notebook'])} onClick={() => navTop('notebook')}><LibraryBig size={18} /> 單字本</button>
        <button className={navClass(page, ['folders', 'folder'])} onClick={() => navTop('folders')}><Folder size={18} /> 資料夾</button>
        <button className={navClass(page, ['notes'])} onClick={() => navTop('notes')}><NotebookPen size={18} /> 筆記</button>
        <button className={navClass(page, ['ytSubtitles', 'ytSubtitle'])} onClick={() => navTop('ytSubtitles')}><Captions size={18} /> YT 字幕</button>
        <button className={navClass(page, ['readingTests', 'readingTest'])} onClick={() => navTop('readingTests')}><BookOpen size={18} /> 閱讀測驗</button>
        <button className="logout-button" onClick={onLogout}><LogOut size={18} /> 登出</button>
      </aside>
      <main>
        {status}
        {errors.filter((entry) => entry.message).map((entry) => (
          <div className="sync-error" key={entry.label}>{entry.label}：{entry.message}</div>
        ))}
        {children}
      </main>
      {page !== 'home' && (
        <button
          type="button"
          className={`global-back-button ${backButtonClassName}`.trim()}
          onClick={goUp}
          title="回到上一層"
          aria-label="回到上一層"
        >
          <ChevronLeft size={24} />
        </button>
      )}
    </div>
  );
}
