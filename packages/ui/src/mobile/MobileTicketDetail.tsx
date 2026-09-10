import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Ticket, TicketEvaluation, EvalLabel, SshTarget } from '@claude-alive/core';
import {
  displayStatus, STATUS_COLOR, projectName, parseDecisionOptions,
  formatStarted, formatTokens, formatCost, formatDuration, reviewPhase,
} from '../views/tickets/ticketDisplay.ts';
import { failureLine } from '../views/tickets/failureLine.ts';
import { AgentExitReport } from '../views/tickets/AgentExitReport.tsx';
import { legacyAgentExit } from '../views/tickets/legacyAgentExit.ts';
import { useNow } from '../views/dashboard/hooks/useNow.ts';
import { formatAge } from '../utils/age.ts';
import { COLORS, screen, topBar, body, primaryButton, secondaryButton, actionBar, input, TYPE, clamp1 } from './styles.ts';
import { Section, Panel, InfoRows, Badge } from './parts.tsx';
import { PullToRefresh } from './PullToRefresh.tsx';
import type { MobileReplyFn } from './types.ts';

export interface MobileTicketDetailProps {
  ticket: Ticket;
  evaluation?: TicketEvaluation | null;
  onBack: () => void;
  onReply: MobileReplyFn;
  onCancel: () => void;
  onRetry: () => void;
  onDelete: () => void;
  onEvaluate: (label: EvalLabel, weight: number) => void;
  /** Refetch this ticket, for the pull gesture. */
  onRefresh?: () => void | Promise<void>;
}

const SETTLED = new Set(['done', 'failed']);

/** `dev@host` / `host:port` — inlined to keep a core runtime import out of the bundle. */
function sshDisplay(target: SshTarget): string {
  const at = target.user ? `${target.user}@${target.host}` : target.host;
  return target.port && target.port !== 22 ? `${at}:${target.port}` : at;
}

/**
 * The desktop review badge, said in words.
 *
 * A coloured dot told you a ticket was "done" but not whether anything had
 * checked it. Verification is the question people actually open a settled
 * ticket to answer, so it gets its own badge with the verdict spelled out.
 */
function verificationBadge(ticket: Ticket, t: (k: string) => string) {
  const phase = reviewPhase(ticket);
  if (phase === 'verifying') return { text: t('mobile.statusBadgeVerifying'), color: '#d29922' };
  const verdict = ticket.verification;
  if (!verdict) return null;
  if (verdict.passed === false || verdict.flagged) return { text: t('mobile.statusBadgeFlagged'), color: '#e5534b' };
  if (verdict.passed) return { text: t('mobile.statusBadgeVerified'), color: '#3fb950' };
  return { text: t('mobile.statusBadgeUnverified'), color: COLORS.muted };
}

/** The run-info table the desktop modal shows, same rows, same order. */
function runRows(ticket: Ticket, t: (k: string) => string): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (ticket.rounds && ticket.rounds > 1) rows.push([t('tickets.runRounds'), String(ticket.rounds)]);
  if (ticket.preset) rows.push([t('tickets.runPreset'), t(`tickets.preset.${ticket.preset}`)]);
  if (ticket.requestedModel) rows.push([t('tickets.runRequestedModel'), ticket.requestedModel]);
  if (ticket.model) rows.push([t('tickets.runModel'), ticket.model]);
  if (ticket.effort) rows.push([t('tickets.runEffort'), ticket.effort]);
  if (ticket.thinking) rows.push([t('tickets.runThinking'), 'on']);
  if (ticket.unsupportedFlags?.length) rows.push([t('tickets.runFlagsDropped'), ticket.unsupportedFlags.join(', ')]);
  const u = ticket.usage;
  if (u) {
    const tok = (n?: number) => formatTokens(n) ?? '';
    if (u.inputTokens !== undefined) rows.push([t('tickets.runInput'), tok(u.inputTokens)]);
    if (u.outputTokens !== undefined) rows.push([t('tickets.runOutput'), tok(u.outputTokens)]);
    if (u.totalTokens !== undefined) rows.push([t('tickets.runTotal'), tok(u.totalTokens)]);
    const cost = formatCost(u.costUsd);
    if (cost) rows.push([t('tickets.runCost'), cost]);
    if (u.numTurns !== undefined) rows.push([t('tickets.runTurns'), String(u.numTurns)]);
    const dur = formatDuration(u.durationMs);
    if (dur) rows.push([t('tickets.runDuration'), dur]);
  }
  if (ticket.claudeSessionId) rows.push([t('tickets.runSessionId'), ticket.claudeSessionId]);
  return rows;
}

const RATINGS: ReadonlyArray<{ label: EvalLabel; weight: number; textKey: string }> = [
  { label: 'bad', weight: 5, textKey: 'tickets.evalVeryBad' },
  { label: 'bad', weight: 1, textKey: 'tickets.evalBad' },
  { label: 'unrated', weight: 1, textKey: 'tickets.evalNeutral' },
  { label: 'good', weight: 1, textKey: 'tickets.evalGood' },
  { label: 'good', weight: 5, textKey: 'tickets.evalVeryGood' },
];

/**
 * One ticket, with the desktop modal's sections in the desktop modal's order.
 *
 * The parked question stays above the result — when a ticket is in `decision`
 * the agent has stopped and the answer is the only thing that matters — but
 * everything else (run info, verification report, rating, delete) is here too,
 * because a phone that shows less than the desktop makes you go find a laptop.
 */
export function MobileTicketDetail({
  ticket, evaluation, onBack, onReply, onCancel, onRetry, onDelete, onEvaluate, onRefresh,
}: MobileTicketDetailProps) {
  const { t } = useTranslation();
  const now = useNow();
  const [answer, setAnswer] = useState('');
  const [sending, setSending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const status = displayStatus(ticket.state, evaluation);
  const waiting = ticket.state === 'decision';
  const settled = SETTLED.has(ticket.state);
  const decision = waiting && ticket.decisionQuestion ? parseDecisionOptions(ticket.decisionQuestion) : null;
  const review = verificationBadge(ticket, t);
  const remote = ticket.location?.kind === 'ssh' ? ticket.location.ssh : undefined;
  const rows = runRows(ticket, t);
  // Same fallback as the desktop modal: an old ticket's one-line message is
  // parsed back into the exit facts so it gets the explanation too.
  const agentExit = ticket.agentExit ?? legacyAgentExit(ticket);
  const age = formatAge(now - (ticket.endedAt ?? ticket.startedAt ?? ticket.createdAt));

  const send = async () => {
    const text = answer.trim();
    if (!text || sending) return;
    setSending(true);
    const ok = await onReply(text);
    setSending(false);
    if (ok) setAnswer('');
  };

  return (
    <div style={screen}>
      {/* Two deliberate rows, always.
          The header carries six things — back, project, number, state, review
          verdict, where it ran, how long ago — and wrapping them into one flex
          row produced a block that was one line for a short project and two for
          a long one, with the badges landing somewhere different each time.
          Row one identifies the ticket, row two says what state it is in; the
          badge row scrolls sideways so a long ssh target cannot reflow it. */}
      <div style={{ ...topBar, flexDirection: 'column', alignItems: 'stretch', gap: 8, paddingBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <button
            onClick={onBack}
            aria-label={t('mobile.back')}
            style={{ background: 'none', border: 'none', color: COLORS.text, fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: '0 4px 0 0', flexShrink: 0 }}
          >
            ‹
          </button>
          {/* The checkout is what tells two identical goals apart, so it is read
              at full contrast and gets whatever width is left. */}
          <span style={{ ...TYPE.title, ...clamp1, color: COLORS.text, flex: 1 }} title={ticket.cwd}>
            {projectName(ticket.cwd)}
          </span>
          <span style={{ ...TYPE.meta, color: COLORS.muted, flexShrink: 0 }}>#{ticket.seq}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto', minWidth: 0 }}>
          <Badge text={t(`tickets.status.${ticket.state}`)} color={STATUS_COLOR[status]} filled />
          {review && <Badge text={review.text} color={review.color} />}
          {remote ? (
            <Badge text={`${t('mobile.locationSsh')} ${sshDisplay(remote)}`} color="#a371f7" />
          ) : (
            <Badge text={t('mobile.locationLocal')} color={COLORS.muted} />
          )}
          <span style={{ ...TYPE.meta, color: COLORS.muted, marginLeft: 'auto', paddingLeft: 8, whiteSpace: 'nowrap' }}>
            {age} · {formatStarted(ticket)}
          </span>
        </div>
      </div>

      <PullToRefresh onRefresh={onRefresh} style={{ ...body, paddingBottom: 96 }}>
        <Section label={t('tickets.goalLabel')}>
          <div style={{ ...TYPE.body, whiteSpace: 'pre-wrap' }}>{ticket.goal}</div>
        </Section>

        {waiting && (
          <Section label={t('tickets.decisionLabel')}>
            <Panel accent={COLORS.accent}>
              <p style={{ margin: '0 0 12px', whiteSpace: 'pre-wrap' }}>{decision?.prompt ?? ticket.decisionQuestion}</p>
              {decision?.options.map((option) => (
                <button
                  key={option.key}
                  // Filling the box rather than sending: the answer is usually
                  // "B, but only for the API", which a tap-to-send would lose.
                  onClick={() => setAnswer(`${option.key}. ${option.text}`)}
                  style={{ ...secondaryButton, display: 'block', width: '100%', textAlign: 'left', marginBottom: 6, padding: '10px 12px', minHeight: 44, lineHeight: 1.4 }}
                >
                  <b>{option.key}.</b> {option.text}
                </button>
              ))}
              <textarea
                value={answer}
                rows={3}
                placeholder={t('tickets.decisionAnswer')}
                onChange={(e) => setAnswer(e.target.value)}
                style={{ ...input, marginTop: 8, resize: 'vertical' }}
              />
              <button style={{ ...primaryButton, marginTop: 8, opacity: answer.trim() && !sending ? 1 : 0.4 }} onClick={send}>
                {sending ? t('mobile.sending') : t('mobile.send')}
              </button>
            </Panel>
          </Section>
        )}

        {ticket.headline && (
          <Section label={t('tickets.headlineLabel')}>
            <div style={{ ...TYPE.title }}>{ticket.headline}</div>
          </Section>
        )}

        {ticket.state === 'failed' && (
          <Section label={t('tickets.failureLabel')}>
            <Panel accent="#e5534b">
              {failureLine(ticket, t)}
              {/* The phone gets the same explanation as the desktop: a bare exit
                  code is least readable exactly where the reader is furthest
                  from a terminal. */}
              {agentExit && (
                <div style={{ marginTop: 10 }}>
                  <AgentExitReport exit={agentExit} t={t} />
                </div>
              )}
            </Panel>
          </Section>
        )}

        <Section label={t('tickets.resultLabel')}>
          <Panel>
            {ticket.result ? (
              <pre style={{ ...TYPE.body, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {ticket.result}
              </pre>
            ) : (
              <span style={{ color: COLORS.muted }}>{t('tickets.noResult')}</span>
            )}
          </Panel>
        </Section>

        {rows.length > 0 && (
          <Section label={t('tickets.runInfoLabel')}>
            <InfoRows rows={rows} />
          </Section>
        )}

        {ticket.verification && (
          <Section label={t('tickets.verificationReportLabel')}>
            <Panel>
              <div style={{ marginBottom: 6 }}>
                {review && <Badge text={review.text} color={review.color} />}
                {ticket.verification.consensus && (
                  <span style={{ ...TYPE.meta, marginLeft: 8, color: COLORS.muted }}>
                    {t('tickets.consensusLabel')} {ticket.verification.consensus.agree}/{ticket.verification.consensus.total}
                  </span>
                )}
              </div>
              {ticket.verification.reason && (
                <div style={{ whiteSpace: 'pre-wrap' }}>{ticket.verification.reason}</div>
              )}
              {ticket.verification.gate?.coverage && (
                <div style={{ ...TYPE.body, marginTop: 6, color: COLORS.muted, whiteSpace: 'pre-wrap' }}>
                  {ticket.verification.gate.coverage}
                </div>
              )}
            </Panel>
          </Section>
        )}

        {settled && (
          <Section label={t('mobile.ratingLabel')}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {RATINGS.map((rating) => {
                const active = evaluation?.label === rating.label && (evaluation?.weight ?? 1) === rating.weight;
                return (
                  <button
                    key={rating.textKey}
                    onClick={() => onEvaluate(rating.label, rating.weight)}
                    style={{
                      ...secondaryButton, ...TYPE.button, minHeight: 40, padding: '0 12px',
                      borderColor: active ? COLORS.accent : COLORS.border,
                      background: active ? COLORS.accent : 'transparent',
                      color: active ? '#0d1117' : COLORS.text,
                    }}
                  >
                    {t(rating.textKey)}
                  </button>
                );
              })}
            </div>
            {evaluation?.autoLabel && (
              <div style={{ ...TYPE.label, marginTop: 6, color: COLORS.muted }}>
                {t('tickets.evalAuto')}: {evaluation.autoLabel}
              </div>
            )}
          </Section>
        )}
      </PullToRefresh>

      <div style={actionBar}>
        {settled ? (
          <button style={{ ...secondaryButton, flex: 1 }} onClick={onRetry}>{t('tickets.retry')}</button>
        ) : (
          <button style={{ ...secondaryButton, flex: 1 }} onClick={onCancel}>{t('tickets.cancel')}</button>
        )}
        <button
          onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
          style={{ ...secondaryButton, flex: 1, borderColor: '#e5534b', color: '#e5534b' }}
        >
          {confirmDelete ? t('mobile.deleteConfirm') : t('mobile.deleteTicket')}
        </button>
      </div>
    </div>
  );
}
