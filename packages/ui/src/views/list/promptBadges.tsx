import { useTranslation } from 'react-i18next';
import { TIER_COLOR } from './promptTypes';

export function TierBadge({ tier }: { tier: string | null }) {
  const color = tier ? TIER_COLOR[tier] : 'var(--text-secondary)';
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.06em',
        padding: '2px 6px',
        borderRadius: 4,
        textTransform: 'uppercase',
        color,
        background: `${color}1a`,
        border: `1px solid ${color}66`,
      }}
    >
      {tier ?? 'n/a'}
    </span>
  );
}

/**
 * Confidence pill — D-046. Low confidence is explicitly marked so the
 * user has a hook to push back on the score; medium is intentionally
 * subtle; high shows when baseline + scoring + judge all agree. Missing
 * confidence renders nothing so older agent versions degrade silently.
 */
export function ConfidenceBadge({
  confidence,
  delta,
}: {
  confidence: string | null | undefined;
  delta: number | null | undefined;
}) {
  const { t } = useTranslation();
  if (!confidence) return null;
  const colors: Record<string, string> = {
    high: 'var(--accent-green)',
    medium: 'var(--text-secondary)',
    low: 'var(--accent-amber)',
  };
  const color = colors[confidence] ?? 'var(--text-secondary)';
  const label = t(`prompt.confidence.${confidence}`, { defaultValue: confidence });
  return (
    <span
      title={
        delta != null
          ? t('prompt.detail.baselineDelta', {
              defaultValue: '대비 {{delta}}',
              delta: delta > 0 ? `+${delta}` : `${delta}`,
            })
          : undefined
      }
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        padding: '2px 6px',
        borderRadius: 4,
        color,
        background: `${color}14`,
        border: `1px solid ${color}55`,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <span style={{ opacity: 0.6 }}>·</span>
      {label}
      {delta != null && (
        <span style={{ opacity: 0.75, fontWeight: 600 }}>
          {delta > 0 ? `+${delta}` : delta}
        </span>
      )}
    </span>
  );
}
