import { useCallback, useEffect, useRef, useState } from 'react';

const SELECTABLE_SELECTOR = '[data-selectable-entry-id]';

function selectionElement(node) {
  return node?.nodeType === 1 ? node : node?.parentElement;
}

export function useTextSelectionActions({ entries = [], trackOffsets = false, onValidSelection } = {}) {
  const [selectionAction, setSelectionAction] = useState(null);
  const selectionActionRef = useRef(null);
  const updateFrameRef = useRef(null);
  const clearTimerRef = useRef(null);
  const entriesRef = useRef(entries);
  const onValidSelectionRef = useRef(onValidSelection);
  entriesRef.current = entries;
  onValidSelectionRef.current = onValidSelection;

  const clearSelectionAction = useCallback(({ removeRanges = false } = {}) => {
    if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
    clearTimerRef.current = null;
    selectionActionRef.current = null;
    setSelectionAction(null);
    if (removeRanges) window.getSelection()?.removeAllRanges();
  }, []);

  const showSelectionAction = useCallback((next) => {
    if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
    clearTimerRef.current = null;
    selectionActionRef.current = next;
    setSelectionAction(next);
  }, []);

  const scheduleClear = useCallback(() => {
    if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
    clearTimerRef.current = window.setTimeout(() => {
      clearTimerRef.current = null;
      selectionActionRef.current = null;
      setSelectionAction(null);
    }, 120);
  }, []);

  const updateSelectionAction = useCallback(() => {
    if (updateFrameRef.current !== null) window.cancelAnimationFrame(updateFrameRef.current);
    updateFrameRef.current = window.requestAnimationFrame(() => {
      updateFrameRef.current = null;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) {
        if (selectionActionRef.current?.highlight) return;
        scheduleClear();
        return;
      }
      const range = selection.getRangeAt(0);
      const startSource = selectionElement(range.startContainer)?.closest?.(SELECTABLE_SELECTOR);
      const endSource = selectionElement(range.endContainer)?.closest?.(SELECTABLE_SELECTOR);
      const entryId = startSource?.dataset.selectableEntryId;
      const entry = entriesRef.current.find((candidate) => String(candidate.id) === entryId);
      const rawSelection = selection.toString();
      const selectedKo = (trackOffsets ? rawSelection.trim() : rawSelection.replace(/\s+/g, ' ').trim());
      const rect = range.getBoundingClientRect();
      if (!entry || startSource !== endSource || !selectedKo || (!rect.width && !rect.height)) {
        scheduleClear();
        return;
      }

      let start;
      let end;
      if (trackOffsets) {
        const leadingWhitespace = rawSelection.length - rawSelection.trimStart().length;
        const precedingRange = range.cloneRange();
        precedingRange.selectNodeContents(startSource);
        precedingRange.setEnd(range.startContainer, range.startOffset);
        start = precedingRange.toString().length + leadingWhitespace;
        end = start + selectedKo.length;
        if (entry.ko.slice(start, end) !== selectedKo) {
          scheduleClear();
          return;
        }
      } else if (!String(entry.ko || '').replace(/\s+/g, ' ').includes(selectedKo)) {
        scheduleClear();
        return;
      }

      if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
      const next = {
        ko: selectedKo,
        entry,
        start,
        end,
        top: rect.bottom + 8,
        left: Math.min(Math.max(10, rect.left + (rect.width / 2) - 63), window.innerWidth - 136),
      };
      onValidSelectionRef.current?.(next);
      showSelectionAction(next);
    });
  }, [scheduleClear, showSelectionAction, trackOffsets]);

  useEffect(() => {
    document.addEventListener('selectionchange', updateSelectionAction);
    window.addEventListener('scroll', updateSelectionAction, true);
    window.addEventListener('resize', updateSelectionAction);
    return () => {
      document.removeEventListener('selectionchange', updateSelectionAction);
      window.removeEventListener('scroll', updateSelectionAction, true);
      window.removeEventListener('resize', updateSelectionAction);
      if (updateFrameRef.current !== null) window.cancelAnimationFrame(updateFrameRef.current);
      if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
    };
  }, [updateSelectionAction]);

  return { selectionAction, setSelectionAction: showSelectionAction, clearSelectionAction };
}

export function useDismissibleWordDefinition() {
  const [definition, setDefinition] = useState(null);
  useEffect(() => {
    const dismiss = (event) => {
      if (!event.target?.closest?.('.subtitle-known-word, .subtitle-word-definition')) setDefinition(null);
    };
    const dismissOnScroll = () => setDefinition(null);
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('scroll', dismissOnScroll, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('scroll', dismissOnScroll, true);
    };
  }, []);
  return [definition, setDefinition];
}
