import { useEffect, useRef } from 'react';

export function isTextEntryTarget(target) {
  return target?.tagName === 'INPUT'
    || target?.tagName === 'TEXTAREA'
    || target?.tagName === 'SELECT'
    || target?.isContentEditable;
}

export function sessionKeyboardIntent(event, actions = {}) {
  if (event.isComposing || event.defaultPrevented) return '';
  if (event.key === ' ' && !event.repeat) return actions.space || '';
  if (event.key === 'Enter') return actions.enter || '';
  if (event.key === 'ArrowLeft') return actions.left || '';
  if (event.key === 'ArrowRight') return actions.right || '';
  if (event.key === 'ArrowDown') return actions.down || '';
  return '';
}

export function useSessionKeydown(handler, dependencies = [], enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event) => handler(event);
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, ...dependencies]);
}

export function useCardPointerNavigation({
  cardRef,
  resolveAction,
  onAction,
  onInteraction,
}) {
  const pointerRef = useRef({ start: null, lastTap: null });
  const ignoreClickUntilRef = useRef(0);

  const alignedCardTop = () => {
    const navBottom = document.querySelector('.sidebar')?.getBoundingClientRect().bottom || 0;
    const mobileCardGap = Number.parseFloat(
      window.getComputedStyle(document.querySelector('.app')).getPropertyValue('--mobile-card-edge-gap'),
    ) || 0;
    return navBottom + mobileCardGap;
  };

  const stabilizeAlignedCard = () => {
    window.requestAnimationFrame(() => {
      const cardTop = cardRef.current?.getBoundingClientRect().top;
      if (!Number.isFinite(cardTop)) return;
      const adjustment = cardTop - alignedCardTop();
      if (Math.abs(adjustment) > 1 && Math.abs(adjustment) < 80) {
        window.scrollBy({ top: adjustment, behavior: 'smooth' });
      }
    });
  };

  const onPointerDown = (event) => {
    if (event.pointerType !== 'touch' || !event.isPrimary) return;
    ignoreClickUntilRef.current = Date.now() + 700;
    const cardTop = cardRef.current?.getBoundingClientRect().top;
    pointerRef.current.start = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      aligned: Number.isFinite(cardTop) && Math.abs(cardTop - alignedCardTop()) <= 28,
    };
  };

  const resetPointer = () => {
    pointerRef.current.start = null;
    pointerRef.current.lastTap = null;
  };

  const onPointerUp = (event) => {
    const start = pointerRef.current.start;
    pointerRef.current.start = null;
    if (event.pointerType !== 'touch' || !event.isPrimary || !start || start.pointerId !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (start.aligned && moved <= 24) stabilizeAlignedCard();
    if (moved > 14 || event.target instanceof Element
      && event.target.closest('button, a, input, textarea, select, [contenteditable="true"]')) {
      pointerRef.current.lastTap = null;
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const action = resolveAction(event.clientX, rect.left, rect.width);
    const now = Date.now();
    const lastTap = pointerRef.current.lastTap;
    if (!action || !lastTap || lastTap.action !== action || now - lastTap.time > 380) {
      pointerRef.current.lastTap = { action, time: now };
      return;
    }
    pointerRef.current.lastTap = null;
    onInteraction?.();
    onAction(action);
  };

  return { ignoreClickUntilRef, onPointerDown, onPointerUp, resetPointer };
}
