import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TierBadge, ConfidenceBadge } from './promptBadges';
import {
  SEVERITY_COLOR,
  fmtTime,
  type PromptDetail,
  type PromptListRow,
} from './promptTypes';

interface PromptListViewProps {
  /** Parent toggles display: 'none' / 'block' instead of unmounting; we only poll while visible. */
  active: boolean;
  /**
   * Deep-link from the dashboard cards. When non-null and present in
   * the current list, we adopt it as the selected id and clear it on
   * the parent via onSelectConsumed so subsequent user clicks aren't
   * overridden.
   */
  requestedSelectId?: string | null;
  onSelectConsumed?: () => void;
}

export function PromptListView({
  active,
  requestedSelectId,
  onSelectConsumed,
}: PromptListViewProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<PromptListRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PromptDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/prompts?limit=100`);
      if (!res.ok) return;
      const data = (await res.json()) as { prompts: PromptListRow[] };
      setRows(data.prompts);
    } catch {
      // network errors handled by parent shell
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [active, refresh]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    fetch(`/api/prompts/${encodeURIComponent(selectedId)}`)
      .then(async (r) => (r.ok ? r.json() : null))
      .then((data: PromptDetail | null) => {
        if (cancelled) return;
        setDetail(data);
      })
      .catch(() => {
        if (cancelled) return;
        setDetail(null);
      })
      .finally(() => {
        if (cancelled) return;
        setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    if (selectedId || !rows || rows.length === 0) return;
    setSelectedId(rows[0]!.id);
  }, [rows, selectedId]);

  // Honor a deep-link request from the dashboard. If the requested id
  // is already in the list, swap to it; otherwise leave the existing
  // selection alone and clear the request so we don't pick it up on a
  // subsequent refresh.
  useEffect(() => {
    if (!requestedSelectId || !rows) return;
    if (rows.some((r) => r.id === requestedSelectId)) {
      setSelectedId(requestedSelectId);
    }
    onSelectConsumed?.();
  }, [requestedSelectId, rows, onSelectConsumed]);

  const grouped = useMemo(() => rows ?? [], [rows]);

  // Sort hits by severity desc, then by rule_id so the most actionable
  // improvements are at the top of the detail pane.
  const sortedHits = useMemo(() => {
    if (!detail) return [];
    return [...detail.hits].sort(
      (a, b) => b.severity - a.severity || a.rule_id.localeCompare(b.rule_id)
    );
  }, [detail]);

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>
      {/* List pane */}
      <div
        style={{
          width: 420,
          minWidth: 280,
          maxWidth: '50%',
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--bg-secondary)',
        }}
      >
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--text-secondary)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            {t('prompt.listTitle')}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', opacity: 0.6 }}>
            {grouped.length}
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {grouped.length === 0 ? (
            <div
              style={{
                padding: '32px 16px',
                textAlign: 'center',
                color: 'var(--text-secondary)',
                fontSize: 13,
              }}
            >
              {t('prompt.empty')}
            </div>
          ) : (
            grouped.map((row) => {
              const isSelected = row.id === selectedId;
              return (
                <button
                  key={row.id}
                  onClick={() => setSelectedId(row.id)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    padding: '10px 16px',
                    borderBottom: '1px solid var(--border-color)',
                    background: isSelected ? 'rgba(88, 166, 255, 0.10)' : 'transparent',
                    border: 'none',
                    borderLeft: isSelected
                      ? '2px solid var(--accent-blue)'
                      : '2px solid transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 13,
                        fontWeight: 700,
                        color: 'var(--text-primary)',
                        minWidth: 26,
                      }}
                    >
                      {row.final_score ?? '—'}
                    </span>
                    <TierBadge tier={row.tier} />
                    <ConfidenceBadge confidence={row.confidence} delta={row.baseline_delta} />
                    <span
                      style={{
                        fontSize: 10,
                        color: 'var(--text-secondary)',
                        opacity: 0.6,
                        marginLeft: 'auto',
                      }}
                    >
                      {fmtTime(row.created_at)}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      lineHeight: 1.4,
                    }}
                  >
                    {row.prompt}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Detail pane */}
      <div style={{ flex: 1, overflow: 'auto', padding: 24, minWidth: 0 }}>
        {!selectedId ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            {t('prompt.detail.empty')}
          </div>
        ) : detailLoading && !detail ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            {t('prompt.loading')}
          </div>
        ) : !detail ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            {t('prompt.detail.notFound')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 900 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 40,
                  fontWeight: 700,
                  lineHeight: 1,
                  color: 'var(--text-primary)',
                }}
              >
                {detail.prompt.final_score ?? '—'}
              </span>
              <TierBadge tier={detail.prompt.tier} />
              <ConfidenceBadge
                confidence={detail.prompt.confidence}
                delta={detail.prompt.baseline_delta}
              />
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  opacity: 0.6,
                  marginLeft: 'auto',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {fmtTime(detail.prompt.created_at)}
              </span>
            </div>

            <div
              style={{
                border: '1px solid var(--border-color)',
                borderRadius: 12,
                padding: 16,
                background: 'var(--bg-secondary)',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  marginBottom: 8,
                }}
              >
                {t('prompt.detail.promptHeader')}
              </div>
              <pre
                style={{
                  margin: 0,
                  fontSize: 13,
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {detail.prompt.prompt}
              </pre>
              <div
                style={{
                  display: 'flex',
                  gap: 16,
                  marginTop: 12,
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                <span>{detail.prompt.char_len} chars</span>
                <span>{detail.prompt.word_count} words</span>
                <span>turn #{detail.prompt.turn_index}</span>
                {detail.prompt.efficiency_score != null && (
                  <span>
                    {t('prompt.detail.efficiencyShort', { defaultValue: 'efficiency' })}{' '}
                    {detail.prompt.efficiency_score}
                  </span>
                )}
              </div>
            </div>

            {/* Improvement suggestions — derived from rule_hits. Each rule
                hit is, by design, an actionable improvement: the rule
                engine emits human-readable `message` text describing
                what is missing or could be tightened. Sorted by severity
                so the most impactful fixes lead. */}
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  {t('prompt.detail.improvementsHeader', {
                    defaultValue: '개선사항',
                    count: sortedHits.length,
                  })}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--text-secondary)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {sortedHits.length}
                </div>
              </div>
              {sortedHits.length === 0 ? (
                <div
                  style={{
                    fontSize: 13,
                    color: 'var(--text-secondary)',
                    padding: '16px',
                    border: '1px dashed var(--border-color)',
                    borderRadius: 8,
                    textAlign: 'center',
                  }}
                >
                  {t('prompt.detail.improvementsEmpty', {
                    defaultValue: '개선사항 없음 — 좋은 프롬프트입니다.',
                  })}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {sortedHits.map((hit) => {
                    const color =
                      SEVERITY_COLOR[hit.severity] ?? 'var(--text-secondary)';
                    return (
                      <div
                        key={hit.rule_id}
                        style={{
                          display: 'flex',
                          gap: 12,
                          padding: '12px 14px',
                          border: '1px solid var(--border-color)',
                          borderLeft: `3px solid ${color}`,
                          borderRadius: 8,
                          background: 'var(--bg-secondary)',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: 4,
                            minWidth: 56,
                          }}
                        >
                          <div
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: 12,
                              fontWeight: 700,
                              color,
                            }}
                          >
                            {hit.rule_id}
                          </div>
                          <div
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: 9,
                              color,
                              opacity: 0.7,
                              letterSpacing: '0.06em',
                            }}
                          >
                            SEV {hit.severity}
                          </div>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 13,
                              color: 'var(--text-primary)',
                              lineHeight: 1.45,
                              fontWeight: 500,
                            }}
                          >
                            {hit.message}
                          </div>
                          {hit.evidence && (
                            <div
                              style={{
                                marginTop: 6,
                                padding: '6px 8px',
                                fontSize: 12,
                                fontFamily: 'var(--font-mono)',
                                color: 'var(--text-secondary)',
                                background: 'rgba(0, 0, 0, 0.25)',
                                borderRadius: 4,
                                wordBreak: 'break-word',
                              }}
                            >
                              {hit.evidence}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {detail.prompt.coach_context && (
              <div
                style={{
                  border: '1px solid var(--accent-amber)',
                  borderRadius: 12,
                  padding: 14,
                  background: 'rgba(210, 153, 34, 0.08)',
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--accent-amber)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    marginBottom: 8,
                  }}
                >
                  {t('prompt.detail.coachHeader')}
                </div>
                <pre
                  style={{
                    margin: 0,
                    fontSize: 12,
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {detail.prompt.coach_context}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
