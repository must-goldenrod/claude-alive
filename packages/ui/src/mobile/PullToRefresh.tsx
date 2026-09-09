import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { COLORS, TYPE } from './styles.ts';

/** How far the finger travels before the release commits to a refresh. */
export const PULL_THRESHOLD = 64;
/** The pull stops following the finger past this, so the header cannot be dragged away. */
const MAX_PULL = 96;
/** Below this the gesture is a scroll that changed direction, not a pull. */
const MIN_INTENT = 6;

export interface PullToRefreshProps {
  /** Absent = the screen has nothing to refetch, and the gesture does nothing. */
  onRefresh?: () => void | Promise<void>;
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * Pull down at the top of a list to refetch it.
 *
 * The browser's own pull-to-refresh never fires here: every phone screen is a
 * fixed-position shell with its own scrolling pane, so the document never
 * scrolls and Chrome has nothing to overscroll. That leaves the most reflexive
 * gesture on a phone doing nothing at all, which is why this exists.
 *
 * Reloading the page would be the easy implementation and the wrong one — it
 * drops the WebSocket, re-runs authentication and, on the terminal, detaches
 * the pty. Each screen hands in what its own refresh means instead.
 */
export function PullToRefresh({ onRefresh, style, children }: PullToRefreshProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (!onRefresh || busy) return;
    // Only a drag that begins at the top is a pull; anywhere else it is a scroll.
    if ((scrollRef.current?.scrollTop ?? 0) > 0) {
      startY.current = null;
      return;
    }
    startY.current = e.touches[0]?.clientY ?? null;
  }, [onRefresh, busy]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (startY.current === null || !onRefresh || busy) return;
    const delta = (e.touches[0]?.clientY ?? 0) - startY.current;
    if (delta < MIN_INTENT) {
      setPull(0);
      return;
    }
    // Resist as it goes: the last pixels of travel cost more than the first, so
    // the gesture has a felt end rather than sliding forever.
    setPull(Math.min(MAX_PULL, delta * 0.5));
  }, [onRefresh, busy]);

  const onTouchEnd = useCallback(async () => {
    const travelled = pull;
    startY.current = null;
    setPull(0);
    if (!onRefresh || busy || travelled < PULL_THRESHOLD * 0.5) return;
    setBusy(true);
    try {
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }, [pull, onRefresh, busy]);

  const armed = pull >= PULL_THRESHOLD * 0.5;
  const showing = busy || pull > 0;

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {showing && (
        <div
          style={{
            ...TYPE.label,
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2,
            height: Math.max(28, pull), display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: armed || busy ? COLORS.accent : COLORS.muted,
            pointerEvents: 'none',
          }}
        >
          {busy ? t('mobile.refreshing') : armed ? t('mobile.releaseToRefresh') : t('mobile.pullToRefresh')}
        </div>
      )}
      <div
        ref={scrollRef}
        data-testid="pull-scroll"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        style={{
          ...style,
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          // Keep the browser's own overscroll out of it; this pane owns the gesture.
          overscrollBehaviorY: 'contain',
          transform: pull > 0 ? `translateY(${pull}px)` : undefined,
          transition: pull > 0 ? 'none' : 'transform 160ms ease-out',
        }}
      >
        {children}
      </div>
    </div>
  );
}
