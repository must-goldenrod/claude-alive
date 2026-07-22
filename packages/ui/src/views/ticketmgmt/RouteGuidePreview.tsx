import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RouteGuide } from '@claude-alive/core';
import { fetchGuide } from './api.ts';

interface RouteGuidePreviewProps {
  route: string;
  /** Bumped by the parent after a reflect toggle so the preview refetches. */
  refreshKey: number;
}

/**
 * Shows the route's currently-synthesised bias — the exact guide text that gets
 * prepended to future tickets' prompts. Empty until something is reflected, which
 * is the whole point of the opt-in gate: nothing shapes future runs by accident.
 */
export function RouteGuidePreview({ route, refreshKey }: RouteGuidePreviewProps) {
  const { t } = useTranslation();
  const [guide, setGuide] = useState<RouteGuide | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchGuide(route)
      .then((g) => { if (!cancelled) setGuide(g); })
      .catch(() => { if (!cancelled) setGuide(null); });
    return () => { cancelled = true; };
  }, [route, refreshKey]);

  const hasText = !!guide?.text;

  return (
    <div style={{ border: '1px solid var(--border-color)', borderRadius: 12, padding: 14, background: 'var(--bg-secondary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {t('ticketMgmt.guide.title')}
        </div>
        {guide && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
            {t('ticketMgmt.guide.counts', { good: guide.goodCount, bad: guide.badCount })}
          </div>
        )}
      </div>
      {hasText ? (
        <pre style={{ margin: 0, fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
          {guide!.text}
        </pre>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('ticketMgmt.guide.empty')}</div>
      )}
    </div>
  );
}
