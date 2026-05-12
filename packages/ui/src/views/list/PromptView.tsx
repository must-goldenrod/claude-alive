import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Prompt tab — surfaces think-prompt data (prompt quality coach) inside the
 * claude-alive UI. We talk to the think-prompt agent's JSON API on the same
 * machine (default :47823). The agent is the source of truth and the only
 * writer for the underlying SQLite DB — we never open it directly.
 *
 * If the agent isn't reachable (think-prompt not installed / not running),
 * we render an inline install hint instead of an error. The rest of the UI
 * keeps working — Prompt is an optional surface.
 */

const TP_AGENT_BASE = `http://127.0.0.1:${(typeof window !== 'undefined' && (window as unknown as { THINK_PROMPT_PORT?: number }).THINK_PROMPT_PORT) || 47823}`;

const TIER_COLOR: Record<string, string> = {
  good: 'var(--accent-green)',
  ok: 'var(--accent-blue)',
  weak: 'var(--accent-amber)',
  bad: 'var(--accent-red)',
};

const SEVERITY_COLOR: Record<number, string> = {
  1: 'var(--accent-blue)',
  2: 'var(--accent-blue)',
  3: 'var(--accent-amber)',
  4: 'var(--accent-amber)',
  5: 'var(--accent-red)',
};

interface PromptListRow {
  id: string;
  session_id: string;
  prompt: string;
  char_len: number;
  word_count: number;
  created_at: string;
  turn_index: number;
  final_score: number | null;
  rule_score: number | null;
  usage_score: number | null;
  tier: string | null;
}

interface PromptDetail {
  prompt: PromptListRow & {
    coach_context: string | null;
    judge_score: number | null;
    computed_at: string | null;
    rules_version: number | null;
  };
  hits: Array<{ rule_id: string; severity: number; message: string; evidence: string | null }>;
}

interface PromptViewProps {
  /** Parent toggles display: 'none' / 'block' instead of unmounting; we only poll while visible. */
  active: boolean;
}

function fmtTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return ts;
  }
}

function TierBadge({ tier }: { tier: string | null }) {
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

export function PromptView({ active }: PromptViewProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<PromptListRow[] | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PromptDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${TP_AGENT_BASE}/api/prompts?limit=100`);
      if (!res.ok) {
        setReachable(false);
        return;
      }
      const data = (await res.json()) as { prompts: PromptListRow[] };
      setRows(data.prompts);
      setReachable(true);
    } catch {
      setReachable(false);
    }
  }, []);

  // Poll while the tab is visible. 5s cadence keeps server load negligible
  // (the agent is on the same machine) while feeling live.
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
    fetch(`${TP_AGENT_BASE}/api/prompts/${encodeURIComponent(selectedId)}`)
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

  // Auto-select the first row when none is chosen yet, so the right pane isn't empty on first paint.
  useEffect(() => {
    if (selectedId || !rows || rows.length === 0) return;
    setSelectedId(rows[0]!.id);
  }, [rows, selectedId]);

  const grouped = useMemo(() => {
    if (!rows) return [];
    return rows;
  }, [rows]);

  if (reachable === false) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          flexDirection: 'column',
          gap: 16,
          color: 'var(--text-secondary)',
          padding: 40,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
          {t('prompt.unreachable.title')}
        </div>
        <div style={{ fontSize: 13, maxWidth: 480, lineHeight: 1.5 }}>
          {t('prompt.unreachable.body')}
        </div>
        <pre
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            color: 'var(--accent-blue)',
          }}
        >
          claude-alive install
        </pre>
      </div>
    );
  }

  if (reachable === null) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'var(--text-secondary)',
          fontSize: 13,
        }}
      >
        {t('prompt.loading')}
      </div>
    );
  }

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
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {t('prompt.listTitle')}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', opacity: 0.6 }}>
            {grouped.length}
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {grouped.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
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
                    borderLeft: isSelected ? '2px solid var(--accent-blue)' : '2px solid transparent',
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
                    <span style={{ fontSize: 10, color: 'var(--text-secondary)', opacity: 0.6, marginLeft: 'auto' }}>
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
          <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('prompt.loading')}</div>
        ) : !detail ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('prompt.detail.notFound')}</div>
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
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', opacity: 0.6, marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>
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
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
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
              <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                <span>{detail.prompt.char_len} chars</span>
                <span>{detail.prompt.word_count} words</span>
                <span>turn #{detail.prompt.turn_index}</span>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                {t('prompt.detail.hitsHeader', { count: detail.hits.length })}
              </div>
              {detail.hits.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '12px 0' }}>
                  {t('prompt.detail.hitsEmpty')}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {detail.hits.map((hit) => (
                    <div
                      key={hit.rule_id}
                      style={{
                        display: 'flex',
                        gap: 12,
                        padding: '10px 14px',
                        border: '1px solid var(--border-color)',
                        borderLeft: `3px solid ${SEVERITY_COLOR[hit.severity] ?? 'var(--text-secondary)'}`,
                        borderRadius: 8,
                        background: 'var(--bg-secondary)',
                      }}
                    >
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: SEVERITY_COLOR[hit.severity] ?? 'var(--text-secondary)', minWidth: 56 }}>
                        {hit.rule_id}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.45 }}>
                          {hit.message}
                        </div>
                        {hit.evidence && (
                          <div style={{ marginTop: 4, fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', opacity: 0.7, wordBreak: 'break-word' }}>
                            {hit.evidence}
                          </div>
                        )}
                      </div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: SEVERITY_COLOR[hit.severity] ?? 'var(--text-secondary)' }}>
                        SEV {hit.severity}
                      </div>
                    </div>
                  ))}
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
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-amber)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                  {t('prompt.detail.coachHeader')}
                </div>
                <pre style={{ margin: 0, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
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
