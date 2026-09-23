import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Eye, EyeOff, FolderOpen, Highlighter, Link2, Pause, Play, Plus, Trash2 } from 'lucide-react';

import { EditIconButton } from '../../../components/actions/ContentActionButtons.jsx';
import { isSystemFolder, YT_SOURCE_FOLDER_NAME } from '../../../folders/model.js';
import { todayString } from '../../../shared/date.js';
import { createId } from '../../../shared/id.js';
import { subtitleEntryAtTime, YOUTUBE_EMBED_ORIGIN, YT_SUBTITLE_MODE_SRT } from '../../../subtitles/model.js';
import { loadYoutubeIframeApi, subtitleTimeLabel } from '../../../subtitles/player.js';
import { AddItemsModal } from '../../word-import/components/WordImportForm.jsx';
import { WordMatchesModal } from '../../word-library/components/WordPresentation.jsx';
import { SelectableKoreanText } from '../../text-selection/components/SelectableKoreanText.jsx';
import { SelectionActionPopover, WordDefinitionPopover } from '../../text-selection/components/SelectionOverlays.jsx';
import { HighlightExportModal } from '../../text-selection/components/HighlightExportModal.jsx';
import { useDismissibleWordDefinition, useTextSelectionActions } from '../../text-selection/hooks/useTextSelectionActions.js';
import { YoutubeSubtitleEditorModal } from './YoutubeSubtitlesPage.jsx';

export function YoutubeSubtitleReader({ note, allItems = [], folders = [], onSpeak, onAddRecords, onUpdateRecord, onWriteRecords, onDeleteRecord, onBack, onOpenFolder, onSave, onDelete }) {
  const [showChinese, setShowChinese] = useState(true);
  const [editing, setEditing] = useState(null);
  const [editingWord, setEditingWord] = useState(null);
  const [viewingWords, setViewingWords] = useState([]);
  const [quickAdd, setQuickAdd] = useState(null);
  const [localHighlights, setLocalHighlights] = useState(note?.highlights || []);
  const [exportHighlights, setExportHighlights] = useState(false);
  const [playerLoaded, setPlayerLoaded] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [activeSubtitleEntryId, setActiveSubtitleEntryId] = useState(null);
  const [error, setError] = useState('');
  const iframeRef = useRef(null);
  const youtubePlayerRef = useRef(null);
  const subtitleListRef = useRef(null);
  const subtitleEntryRefs = useRef(new Map());
  const { selectionAction, setSelectionAction, clearSelectionAction } = useTextSelectionActions({ entries: note?.entries || [], trackOffsets: true });
  const [definitionBubble, setDefinitionBubble] = useDismissibleWordDefinition();
  useEffect(() => {
    document.documentElement.classList.add('yt-reader-scroll-snap');
    document.body.classList.add('yt-reader-scroll-snap');
    return () => {
      document.documentElement.classList.remove('yt-reader-scroll-snap');
      document.body.classList.remove('yt-reader-scroll-snap');
    };
  }, []);
  useEffect(() => {
    setPlayerLoaded(false);
    setIsVideoPlaying(false);
    setActiveSubtitleEntryId(null);
    setLocalHighlights(note?.highlights || []);
  }, [note?.id, note?.highlights]);
  const subtitleFolder = useMemo(() => folders.find((folder) => (
    !isSystemFolder(folder) && folder.name.toLocaleLowerCase() === YT_SOURCE_FOLDER_NAME.toLocaleLowerCase()
  )) || null, [folders]);
  const subtitleWords = useMemo(() => {
    const wordIds = new Set(subtitleFolder?.wordIds || []);
    return allItems.filter((item) => wordIds.has(item.id));
  }, [allItems, subtitleFolder]);
  useEffect(() => {
    if (!note?.videoId || !iframeRef.current) return undefined;
    let disposed = false;
    let player = null;
    loadYoutubeIframeApi()
      .then((YT) => {
        if (disposed || !iframeRef.current) return;
        player = new YT.Player(iframeRef.current, {
          events: {
            onReady: () => {
              if (disposed) return;
              youtubePlayerRef.current = player;
              setPlayerLoaded(true);
            },
            onStateChange: (event) => {
              if (!disposed) setIsVideoPlaying(event.data === 1);
            },
          },
        });
      })
      .catch((playerError) => {
        if (!disposed) setError(playerError.message || 'YouTube 播放器無法同步字幕');
      });
    return () => {
      disposed = true;
      if (youtubePlayerRef.current === player) youtubePlayerRef.current = null;
      player?.destroy?.();
    };
  }, [note?.id, note?.videoId]);
  useEffect(() => {
    if (!playerLoaded || note?.mode !== YT_SUBTITLE_MODE_SRT) return undefined;
    const syncCurrentSubtitle = () => {
      try {
        const currentTime = Number(youtubePlayerRef.current?.getCurrentTime?.());
        if (!Number.isFinite(currentTime)) return;
        setActiveSubtitleEntryId(subtitleEntryAtTime(note.entries, currentTime * 1000)?.id || null);
      } catch {
        // The YouTube player can reject a read while its iframe is being reinitialized.
      }
    };
    syncCurrentSubtitle();
    const interval = window.setInterval(syncCurrentSubtitle, 350);
    return () => window.clearInterval(interval);
  }, [note?.entries, note?.mode, playerLoaded]);
  useEffect(() => {
    if (!activeSubtitleEntryId) return;
    const list = subtitleListRef.current;
    const entry = subtitleEntryRefs.current.get(activeSubtitleEntryId);
    if (!list || !entry) return;
    const listRect = list.getBoundingClientRect();
    const entryRect = entry.getBoundingClientRect();
    const listCanScroll = list.scrollHeight > list.clientHeight + 2;
    if (listCanScroll) {
      list.scrollTo({
        top: Math.max(0, list.scrollTop + entryRect.top - listRect.top - ((list.clientHeight - entryRect.height) / 2)),
        behavior: 'smooth',
      });
      return;
    }
  }, [activeSubtitleEntryId]);
  if (!note) return <section className="page"><div className="empty">找不到這篇字幕筆記。<button onClick={onBack}>返回上一層</button></div></section>;
  const seekTo = (entry) => {
    if (note.mode !== YT_SUBTITLE_MODE_SRT || entry.startMs === null || !youtubePlayerRef.current) return;
    youtubePlayerRef.current.seekTo(entry.startMs / 1000, true);
    youtubePlayerRef.current.playVideo();
    setIsVideoPlaying(true);
    setActiveSubtitleEntryId(entry.id);
    window.requestAnimationFrame(() => {
      const list = subtitleListRef.current;
      const element = subtitleEntryRefs.current.get(entry.id);
      if (!list || !element) return;
      const listRect = list.getBoundingClientRect();
      const entryRect = element.getBoundingClientRect();
      list.scrollTo({
        top: Math.max(0, list.scrollTop + entryRect.top - listRect.top - ((list.clientHeight - entryRect.height) / 2)),
        behavior: 'smooth',
      });
    });
  };
  const pauseVideo = () => {
    try {
      youtubePlayerRef.current?.pauseVideo?.();
      setIsVideoPlaying(false);
    } catch {
      // The YouTube iframe may be between player states while the selection starts.
    }
  };
  const toggleVideoPlayback = () => {
    const player = youtubePlayerRef.current;
    if (!player) return;
    try {
      const playing = player.getPlayerState?.() === 1;
      if (playing) player.pauseVideo?.();
      else player.playVideo?.();
      setIsVideoPlaying(!playing);
    } catch {
      setError('YouTube 播放器尚未準備完成，請稍後再試。');
    }
  };
  const deleteNote = async () => {
    if (!window.confirm(`確定要刪除「${note.title}」嗎？`)) return;
    setError('');
    try {
      await onDelete(note.id);
      onBack();
    } catch (deleteError) {
      setError(deleteError.message || '刪除字幕筆記失敗');
    }
  };
  const embedOrigin = typeof window === 'undefined' ? '' : `&origin=${encodeURIComponent(window.location.origin)}`;
  const embedUrl = note.videoId ? `${YOUTUBE_EMBED_ORIGIN}/embed/${note.videoId}?enablejsapi=1&rel=0${embedOrigin}` : '';
  const watchUrl = note.videoId ? `${YOUTUBE_EMBED_ORIGIN}/watch?v=${encodeURIComponent(note.videoId)}` : '';
  const showDefinition = (event, words) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setDefinitionBubble({
      words,
      top: Math.max(10, rect.top - 8),
      left: Math.min(Math.max(10, rect.left + (rect.width / 2)), window.innerWidth - 18),
    });
  };
  const showHighlightActions = (event, highlight, entry) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setSelectionAction({
      ko: highlight.text, entry, start: highlight.start, end: highlight.end, highlight,
      top: rect.bottom + 8,
      left: Math.min(Math.max(10, rect.left + (rect.width / 2) - 63), window.innerWidth - 136),
    });
  };
  const saveHighlights = async (nextHighlights, previousHighlights) => {
    setLocalHighlights(nextHighlights);
    setError('');
    try {
      await onSave({ ...note, highlights: nextHighlights });
    } catch (saveError) {
      setLocalHighlights(previousHighlights);
      setError(saveError.message || '儲存劃線失敗');
    }
  };
  const addHighlight = () => {
    if (!selectionAction || !Number.isSafeInteger(selectionAction.start) || !Number.isSafeInteger(selectionAction.end)) return;
    const highlight = {
      id: createId(), entryId: selectionAction.entry.id, text: selectionAction.ko,
      start: selectionAction.start, end: selectionAction.end,
    };
    const alreadyExists = localHighlights.some((current) => (
      current.entryId === highlight.entryId && current.start === highlight.start && current.end === highlight.end
    ));
    const previousHighlights = localHighlights;
    clearSelectionAction({ removeRanges: true });
    if (!alreadyExists) saveHighlights([...localHighlights, highlight], previousHighlights);
  };
  const removeHighlight = () => {
    if (!selectionAction?.highlight) return;
    const previousHighlights = localHighlights;
    saveHighlights(localHighlights.filter((highlight) => highlight.id !== selectionAction.highlight.id), previousHighlights);
    setSelectionAction(null);
  };

  return (
    <section className="page yt-reader-page">
      <div className="topbar yt-reader-topbar">
        <span className="eyebrow">{note.mode === YT_SUBTITLE_MODE_SRT ? 'SRT subtitles' : 'Bilingual subtitles'}</span>
        <div className="yt-reader-title-line">
          <h1>{note.title}</h1>
          <div className="actions">
            {watchUrl && <a className="edit-icon-button" href={watchUrl} target="_blank" rel="noopener noreferrer" title="在 YouTube 開啟影片" aria-label="在 YouTube 開啟影片"><ExternalLink size={15} /></a>}
            <EditIconButton label="編輯字幕筆記" onClick={() => setEditing(note)} />
            <button className="edit-icon-button" onClick={() => setExportHighlights(true)} title="匯出劃線" aria-label="匯出劃線"><Highlighter size={15} /></button>
            <button className="edit-icon-button delete-icon-button" onClick={deleteNote} title="刪除字幕筆記" aria-label="刪除字幕筆記"><Trash2 size={15} /></button>
          </div>
        </div>
      </div>
      {error && <div className="form-error">{error}</div>}
      <SelectionActionPopover
        selection={selectionAction}
        onAdd={() => { pauseVideo(); setQuickAdd(selectionAction); clearSelectionAction({ removeRanges: true }); }}
        onLookup={() => { pauseVideo(); clearSelectionAction({ removeRanges: true }); }}
        onAddHighlight={addHighlight}
        onRemoveHighlight={removeHighlight}
      />
      <WordDefinitionPopover definition={definitionBubble} />
      <div className="yt-reader-floating-actions" aria-label="字幕閱讀控制">
        {embedUrl && <button type="button" className="yt-reader-floating-button" onClick={toggleVideoPlayback} disabled={!playerLoaded} title={isVideoPlaying ? '暫停影片' : '播放影片'} aria-label={isVideoPlaying ? '暫停影片' : '播放影片'}>{isVideoPlaying ? <Pause size={22} /> : <Play size={22} />}</button>}
        <button type="button" className={`yt-reader-floating-button ${showChinese ? 'selected' : ''}`} onClick={() => setShowChinese((current) => !current)} title={showChinese ? '隱藏中文' : '顯示中文'} aria-label={showChinese ? '隱藏中文' : '顯示中文'}>{showChinese ? <Eye size={22} /> : <EyeOff size={22} />}</button>
        {subtitleFolder && <button type="button" className="yt-reader-floating-button" onClick={() => onOpenFolder?.(subtitleFolder.id)} title={`開啟資料夾「${subtitleFolder.name}」`} aria-label={`開啟資料夾「${subtitleFolder.name}」`}><FolderOpen size={22} /></button>}
      </div>
      <div className="yt-reader-content">
        <div className="yt-reader-video">
          {embedUrl ? <div className="yt-video-frame"><iframe ref={iframeRef} src={embedUrl} title={note.title} referrerPolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen /></div> : <div className="yt-video-missing"><Link2 size={22} /><span>這篇字幕筆記沒有 YouTube 影片連結。</span></div>}
        </div>
        <div className="yt-subtitle-list" ref={subtitleListRef} aria-label="字幕列表">
          {note.entries.map((entry, index) => {
            const clickable = note.mode === YT_SUBTITLE_MODE_SRT && entry.startMs !== null && !!embedUrl;
            const content = <><strong><span className="yt-subtitle-entry-index">{index + 1}</span>{entry.startMs !== null && <small className="yt-subtitle-entry-time">{subtitleTimeLabel(entry.startMs)}</small>}<SelectableKoreanText className="yt-subtitle-ko" entry={entry} words={subtitleWords} highlights={localHighlights} onSelectWords={showDefinition} onOpenWords={(words) => { pauseVideo(); clearSelectionAction({ removeRanges: true }); setDefinitionBubble(null); setViewingWords(words); }} onSelectHighlight={showHighlightActions} /></strong><p className={!showChinese ? 'is-hidden' : ''} aria-hidden={!showChinese}>{entry.zh}</p></>;
            const isPlaying = activeSubtitleEntryId === entry.id;
            const className = `yt-subtitle-entry ${clickable ? 'clickable' : ''} ${isPlaying ? 'is-playing' : ''}`;
            const setEntryRef = (element) => {
              if (element) subtitleEntryRefs.current.set(entry.id, element);
              else subtitleEntryRefs.current.delete(entry.id);
            };
            const openWholeEntryQuickAdd = (event) => {
              event.preventDefault();
              event.stopPropagation();
              pauseVideo();
              setQuickAdd({ ko: entry.ko, zh: entry.zh, entry });
              setSelectionAction(null);
              window.getSelection()?.removeAllRanges();
            };
            return <article
              ref={setEntryRef}
              className={className}
              aria-current={isPlaying ? 'true' : undefined}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              onPointerDown={pauseVideo}
              onClick={clickable ? () => seekTo(entry) : undefined}
              onKeyDown={clickable ? (event) => {
                if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) {
                  event.preventDefault();
                  seekTo(entry);
                }
              } : undefined}
              key={entry.id}
            >
              <button type="button" className="yt-subtitle-entry-add" onPointerDown={(event) => { event.stopPropagation(); pauseVideo(); }} onClick={openWholeEntryQuickAdd} title="將整句新增為單字" aria-label={`將第 ${index + 1} 句新增為單字`}><Plus size={16} /></button>
              {content}
            </article>;
          })}
        </div>
      </div>
      {quickAdd && <AddItemsModal
        title="新增單字"
        date={todayString()}
        initialKo={quickAdd.ko}
        initialVariants={[quickAdd.ko]}
        allItems={allItems}
        folders={folders}
        onAddRecords={onAddRecords}
        onUpdateRecord={onUpdateRecord}
        onWriteRecords={onWriteRecords}
        onEditExisting={(item) => { setQuickAdd(null); setEditingWord(item); }}
        onClose={() => setQuickAdd(null)}
      />}
      {editingWord && <AddItemsModal title="編輯單字" date={editingWord.date} lockedDate editItem={editingWord} allItems={allItems} folders={folders} onUpdateRecord={onUpdateRecord} onClose={() => setEditingWord(null)} />}
      {!!viewingWords.length && <WordMatchesModal items={viewingWords} allItems={allItems} onSpeak={onSpeak} onOpenItems={setViewingWords} onEdit={(word) => { setViewingWords([]); setEditingWord(word); }} onDelete={onDeleteRecord} onClose={() => setViewingWords([])} />}
      {exportHighlights && <HighlightExportModal highlights={localHighlights} entries={note.entries} onClose={() => setExportHighlights(false)} />}
      {editing && <YoutubeSubtitleEditorModal note={editing} onSave={async (nextNote) => { await onSave(nextNote); setEditing(null); }} onClose={() => setEditing(null)} />}
    </section>
  );
}
