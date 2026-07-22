import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CompletedSession } from '@claude-alive/core';

const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;

/** Colour per final state — mirrors the sidebar's STATE_COLORS so a ticket reads
 * the same everywhere. Only terminal-ish states realistically appear here. */
const STATE_COLOR: Record<string, string> = {
  done: 'var(--accent-teal)',
  idle: 'var(--text-secondary)',
  error: 'var(--accent-red)',
  waiting: 'var(--accent-amber)',
  active: 'var(--accent-green)',
  listening: 'var(--accent-blue)',
  spawning: 'var(--accent-purple)',
  despawning: 'var(--state-despawning)',
  removed: 'var(--state-removed)',
};

interface ArchiveViewProps {
  active: boolean;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function fmtDuration(ms: number | undefined): string {
  if (ms == null || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtClock(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function fmtFull(ts: number | undefined): string {
  if (ts == null) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export function ArchiveView({ active }: ArchiveViewProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<CompletedSession[] | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [query, setQuery] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/completed?limit=1000`);
      if (!res.ok) {
        setReachable(false);
        return;
      }
      const data = (await res.json()) as { sessions: CompletedSession[] };
      setRows(data.sessions ?? []);
      setReachable(true);
    } catch {
      setReachable(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    refresh();
    const id = setInterval(refresh, 10000);
    return () => clearInterval(id);
  }, [active, refresh]);

  // Filter by project/name/prompt text.
  const filtered = useMemo(() => {
    const all = rows ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) =>
      (r.projectName ?? '').toLowerCase().includes(q) ||
      (r.displayName ?? '').toLowerCase().includes(q) ||
      (r.lastPrompt ?? '').toLowerCase().includes(q) ||
      (r.cwd ?? '').toLowerCase().includes(q),
    );
  }, [rows, query]);

  // Group into time buckets (rows arrive newest-first from the server).
  const groups = useMemo(() => {
    const now = Date.now();
    const today = startOfDay(now);
    const yesterday = today - 86_400_000;
    const weekAgo = today - 6 * 86_400_000;
    const buckets: { key: string; label: string; items: { row: CompletedSession; idx: number }[] }[] = [
      { key: 'today', label: t('archive.bucket.today'), items: [] },
      { key: 'yesterday', label: t('archive.bucket.yesterday'), items: [] },
      { key: 'week', label: t('archive.bucket.week'), items: [] },
      { key: 'earlier', label: t('archive.bucket.earlier'), items: [] },
    ];
    filtered.forEach((row, idx) => {
      const c = row.completedAt;
      if (c >= today) buckets[0]!.items.push({ row, idx });
      else if (c >= yesterday) buckets[1]!.items.push({ row, idx });
      else if (c >= weekAgo) buckets[2]!.items.push({ row, idx });
      else buckets[3]!.items.push({ row, idx });
    });
    return buckets.filter((b) => b.items.length > 0);
  }, [filtered, t]);

  const selected = selectedIdx != null ? filtered[selectedIdx] ?? null : null;

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    height: '100%',
    width: '100%',
    overflow: 'hidden',
  };

  if (reachable === false) {
    return (
      <div style={{ ...containerStyle, alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', flexDirection: 'column', gap: 8, padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{t('archive.unreachable.title')}</div>
        <div style={{ fontSize: 13, maxWidth: 460, lineHeight: 1.5 }}>{t('archive.unreachable.body')}</div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {/* List pane */}
      <div
        style={{
          width: 440,
          minWidth: 300,
          maxWidth: '50%',
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--bg-secondary)',
        }}
      >
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {t('archive.listTitle')}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', opacity: 0.6 }}>{filtered.length}</div>
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('archive.searchPlaceholder')}
            aria-label={t('archive.searchPlaceholder')}
            style={{
              width: '100%',
              padding: '6px 10px',
              fontSize: 12,
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 8,
              outline: 'none',
            }}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
              {rows === null ? t('archive.loading') : t('archive.empty')}
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.key}>
                <div
                  style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 1,
                    padding: '6px 16px',
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--text-secondary)',
                    background: 'var(--bg-secondary)',
                    borderBottom: '1px solid var(--border-color)',
                  }}
                >
                  {g.label} · {g.items.length}
                </div>
                {g.items.map(({ row, idx }) => {
                  const isSel = idx === selectedIdx;
                  const color = STATE_COLOR[row.finalState ?? 'done'] ?? 'var(--text-secondary)';
                  return (
                    <button
                      key={`${row.sessionId}-${row.completedAt}`}
                      onClick={() => setSelectedIdx(idx)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        padding: '10px 16px',
                        borderBottom: '1px solid var(--border-color)',
                        background: isSel ? 'rgba(88, 166, 255, 0.10)' : 'transparent',
                        border: 'none',
                        borderLeft: isSel ? '2px solid var(--accent-blue)' : '2px solid transparent',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.projectName || t('agents.generalAgent')}
                        </span>
                        {row.parentId && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '0 4px', borderRadius: 4, color: 'var(--accent-purple)', border: '1px solid var(--accent-purple)' }}>
                            SUB
                          </span>
                        )}
                        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-secondary)', opacity: 0.7, fontFamily: 'var(--font-mono)' }}>
                          {fmtClock(row.completedAt)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 16 }}>
                        <span style={{ fontSize: 10, color, fontWeight: 600 }}>{t(`states.${row.finalState ?? 'done'}`, { defaultValue: row.finalState ?? '' })}</span>
                        <span style={{ fontSize: 10, color: 'var(--text-secondary)', opacity: 0.5 }}>·</span>
                        <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{fmtDuration(row.durationMs)}</span>
                        {row.tokenUsage && (
                          <>
                            <span style={{ fontSize: 10, color: 'var(--text-secondary)', opacity: 0.5 }}>·</span>
                            <span style={{ fontSize: 10, color: 'var(--accent-blue)', fontFamily: 'var(--font-mono)' }}>
                              {row.tokenUsage.totalTokens.toLocaleString()} {t('archive.tokensShort')}
                            </span>
                          </>
                        )}
                      </div>
                      {row.lastPrompt && (
                        <div style={{ paddingLeft: 16, fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.lastPrompt}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Detail pane */}
      <div style={{ flex: 1, overflow: 'auto', padding: 24, minWidth: 0 }}>
        {!selected ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('archive.detail.empty')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 820 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: STATE_COLOR[selected.finalState ?? 'done'] ?? 'var(--text-secondary)' }} />
              <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
                {selected.displayName || selected.projectName || t('agents.generalAgent')}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: STATE_COLOR[selected.finalState ?? 'done'] ?? 'var(--text-secondary)' }}>
                {t(`states.${selected.finalState ?? 'done'}`, { defaultValue: selected.finalState ?? '' })}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              <Stat label={t('archive.detail.completedAt')} value={fmtFull(selected.completedAt)} />
              <Stat label={t('archive.detail.startedAt')} value={fmtFull(selected.createdAt)} />
              <Stat label={t('archive.detail.duration')} value={fmtDuration(selected.durationMs)} />
              <Stat label={t('archive.detail.events')} value={selected.totalEvents != null ? String(selected.totalEvents) : '—'} />
              <Stat label={t('archive.detail.toolCalls')} value={selected.toolCallCount != null ? String(selected.toolCallCount) : '—'} />
            </div>

            <Field label={t('archive.detail.project')}>
              <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>{selected.projectName || '—'}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{selected.cwd || '—'}</div>
            </Field>

            <Field label={t('archive.detail.session')}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{selected.sessionId}</div>
            </Field>

            {selected.toolsUsed && selected.toolsUsed.length > 0 && (
              <Field label={t('archive.detail.tools')}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {selected.toolsUsed.map((tool) => (
                    <span key={tool} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'var(--bg-card)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                      {tool}
                    </span>
                  ))}
                </div>
              </Field>
            )}

            {selected.tokenUsage && (
              <Field label={t('archive.detail.tokens')}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
                  <Stat label="input" value={selected.tokenUsage.inputTokens.toLocaleString()} mono />
                  <Stat label="output" value={selected.tokenUsage.outputTokens.toLocaleString()} mono />
                  <Stat label="cache r/w" value={`${selected.tokenUsage.cacheReadTokens.toLocaleString()} / ${selected.tokenUsage.cacheCreationTokens.toLocaleString()}`} mono />
                  <Stat label="total" value={selected.tokenUsage.totalTokens.toLocaleString()} mono />
                  <Stat label="api calls" value={String(selected.tokenUsage.apiCalls)} mono />
                  <Stat label="model" value={selected.tokenUsage.model || '—'} mono />
                </div>
              </Field>
            )}

            {selected.lastPrompt && (
              <Field label={t('archive.detail.lastPrompt')}>
                <pre style={{ margin: 0, fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                  {selected.lastPrompt}
                </pre>
              </Field>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ border: '1px solid var(--border-color)', borderRadius: 10, padding: '10px 12px', background: 'var(--bg-secondary)' }}>
      <div style={{ fontSize: 10, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontFamily: mono ? 'var(--font-mono)' : undefined, wordBreak: 'break-word' }}>{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{label}</div>
      <div style={{ border: '1px solid var(--border-color)', borderRadius: 12, padding: 14, background: 'var(--bg-secondary)' }}>{children}</div>
    </div>
  );
}
