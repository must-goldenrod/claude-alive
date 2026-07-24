import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { CompletedSession } from '@claude-alive/core';

export const ARCHIVE_STATE_COLOR: Record<string, string> = {
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

export function formatArchiveDuration(ms: number | undefined): string {
  if (ms == null || ms < 0) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatFullTimestamp(timestamp: number | undefined): string {
  if (timestamp == null) return '—';
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return String(timestamp);
  }
}

interface ArchiveSessionDetailProps {
  session: CompletedSession;
}

export function ArchiveSessionDetail({ session }: ArchiveSessionDetailProps) {
  const { t } = useTranslation();
  const finalState = session.finalState ?? 'done';
  const stateColor = ARCHIVE_STATE_COLOR[finalState] ?? 'var(--text-secondary)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 820 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span
          aria-hidden="true"
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: stateColor,
          }}
        />
        <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
          {session.displayName || session.projectName || t('agents.generalAgent')}
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: stateColor }}>
          {t(`states.${finalState}`)}
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
        }}
      >
        <Stat
          label={t('archive.detail.completedAt')}
          value={formatFullTimestamp(session.completedAt)}
        />
        <Stat
          label={t('archive.detail.startedAt')}
          value={formatFullTimestamp(session.createdAt)}
        />
        <Stat
          label={t('archive.detail.duration')}
          value={formatArchiveDuration(session.durationMs)}
        />
        <Stat
          label={t('archive.detail.events')}
          value={session.totalEvents != null ? String(session.totalEvents) : '—'}
        />
        <Stat
          label={t('archive.detail.toolCalls')}
          value={session.toolCallCount != null ? String(session.toolCallCount) : '—'}
        />
      </div>

      <Field label={t('archive.detail.project')}>
        <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
          {session.projectName || '—'}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-mono)',
            wordBreak: 'break-all',
          }}
        >
          {session.cwd || '—'}
        </div>
      </Field>

      <Field label={t('archive.detail.session')}>
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-mono)',
            wordBreak: 'break-all',
          }}
        >
          {session.sessionId}
        </div>
      </Field>

      {session.toolsUsed && session.toolsUsed.length > 0 && (
        <Field label={t('archive.detail.tools')}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {session.toolsUsed.map((tool) => (
              <span
                key={tool}
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 6,
                  background: 'var(--bg-card)',
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {tool}
              </span>
            ))}
          </div>
        </Field>
      )}

      {session.tokenUsage && (
        <Field label={t('archive.detail.tokens')}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: 8,
            }}
          >
            <Stat
              label={t('tokens.input')}
              value={session.tokenUsage.inputTokens.toLocaleString()}
              mono
            />
            <Stat
              label={t('tokens.output')}
              value={session.tokenUsage.outputTokens.toLocaleString()}
              mono
            />
            <Stat
              label={`${t('tokens.cacheRead')} / ${t('tokens.cacheCreation')}`}
              value={`${session.tokenUsage.cacheReadTokens.toLocaleString()} / ${session.tokenUsage.cacheCreationTokens.toLocaleString()}`}
              mono
            />
            <Stat
              label={t('tokens.total')}
              value={session.tokenUsage.totalTokens.toLocaleString()}
              mono
            />
            <Stat
              label={t('tokens.apiCalls')}
              value={String(session.tokenUsage.apiCalls)}
              mono
            />
            <Stat
              label={t('tokens.model')}
              value={session.tokenUsage.model || '—'}
              mono
            />
          </div>
        </Field>
      )}

      {session.lastPrompt && (
        <Field label={t('archive.detail.lastPrompt')}>
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
            {session.lastPrompt}
          </pre>
        </Field>
      )}
    </div>
  );
}

interface StatProps {
  label: string;
  value: string;
  mono?: boolean;
}

function Stat({ label, value, mono }: StatProps) {
  return (
    <div
      style={{
        border: '1px solid var(--border-color)',
        borderRadius: 10,
        padding: '10px 12px',
        background: 'var(--bg-secondary)',
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: 'var(--text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--text-primary)',
          fontFamily: mono ? 'var(--font-mono)' : undefined,
          wordBreak: 'break-word',
        }}
      >
        {value}
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  children: ReactNode;
}

function Field({ label, children }: FieldProps) {
  return (
    <div>
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
        {label}
      </div>
      <div
        style={{
          border: '1px solid var(--border-color)',
          borderRadius: 12,
          padding: 14,
          background: 'var(--bg-secondary)',
        }}
      >
        {children}
      </div>
    </div>
  );
}
