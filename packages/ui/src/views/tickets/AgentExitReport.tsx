import type { TicketAgentExit, TicketAgentExitCause } from '@claude-alive/core';

/**
 * The failure section's explanation of a dead agent process.
 *
 * A ticket that says "main agent exited (code 143)" tells a reader nothing they
 * can act on — not whether the agent crashed or was stopped, not how far it got,
 * not whether the work is recoverable. This renders the recorded facts as four
 * answers: what happened, what that means, what to look at, and what to do next.
 *
 * The suspect lists live here rather than in `@claude-alive/core` on purpose:
 * the UI may only import *types* from core (a runtime import pulls node builtins
 * into the browser bundle), and these are display copy anyway.
 */
const SUSPECTS: Readonly<Record<TicketAgentExitCause, readonly string[]>> = {
  terminated: ['cancel', 'serverStop', 'otherTool', 'manualKill'],
  interrupted: ['ctrlC', 'processGroup'],
  hangup: ['terminalClosed', 'sshDropped'],
  killed: ['memoryPressure', 'kill9', 'supervisor'],
  'spawn-failed': ['notOnPath', 'cwdUnreadable', 'sshUnreachable'],
  exited: ['usageError', 'authOrQuota', 'agentError'],
  'no-result': ['maxTurns', 'streamCutOff'],
};

/** "465872" → "7m 45s". Mirrors the server's own formatting of the same field. */
function formatRan(ms: number | undefined): string | null {
  if (ms === undefined) return null;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function AgentExitReport({ exit, t }: { exit: TicketAgentExit; t: (key: string) => string }) {
  const facts: [string, string][] = [];
  if (exit.code !== undefined) facts.push([t('tickets.agentExit.fieldCode'), String(exit.code)]);
  if (exit.signal) {
    facts.push([
      t('tickets.agentExit.fieldSignal'),
      exit.signalInferred ? `${exit.signal} (${t('tickets.agentExit.inferred')})` : exit.signal,
    ]);
  }
  const ran = formatRan(exit.ranMs);
  if (ran) facts.push([t('tickets.agentExit.fieldRanFor'), ran]);
  if (exit.round !== undefined) facts.push([t('tickets.agentExit.fieldRound'), String(exit.round)]);
  if (exit.resultSubtype) facts.push([t('tickets.agentExit.fieldSubtype'), exit.resultSubtype]);
  facts.push([
    t('tickets.agentExit.fieldResumable'),
    exit.resumable ? t('tickets.agentExit.resumableYes') : t('tickets.agentExit.resumableNo'),
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent-red, #f85149)', lineHeight: 1.4 }}>
        {t(`tickets.agentExit.cause.${exit.cause}`)}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary, #e6edf3)' }}>
        {t(`tickets.agentExit.meaning.${exit.cause}`)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 16, rowGap: 4 }}>
        {facts.map(([k, v]) => (
          <div key={k} style={{ display: 'contents' }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary, #8b949e)' }}>{k}</span>
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono, monospace)', color: 'var(--text-primary, #e6edf3)' }}>
              {v}
            </span>
          </div>
        ))}
      </div>

      <div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary, #8b949e)', marginBottom: 4 }}>
          {t('tickets.agentExit.suspectsLabel')}
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary, #e6edf3)' }}>
          {SUSPECTS[exit.cause].map((key) => (
            <li key={key}>{t(`tickets.agentExit.suspect.${key}`)}</li>
          ))}
        </ul>
      </div>

      <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary, #e6edf3)' }}>
        <span style={{ color: 'var(--text-secondary, #8b949e)' }}>{t('tickets.agentExit.nextLabel')} </span>
        {t(`tickets.agentExit.next.${exit.cause}`)}
        {exit.resumable ? ` ${t('tickets.agentExit.resumeHint')}` : ''}
      </div>

      {exit.stderr && (
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary, #8b949e)', marginBottom: 4 }}>
            {t('tickets.agentExit.stderrLabel')}
          </div>
          <pre
            style={{
              margin: 0,
              padding: '8px 10px',
              borderRadius: 8,
              background: 'var(--bg-tertiary, #161b22)',
              fontSize: 12,
              fontFamily: 'var(--font-mono, monospace)',
              color: 'var(--text-secondary, #8b949e)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {exit.stderr}
          </pre>
        </div>
      )}
    </div>
  );
}
