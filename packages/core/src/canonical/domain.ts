/**
 * Provider-neutral session record (spec §I.1, §I.1.1).
 *
 * A session sits above terminal tabs: a tab can close while the session and its
 * conversation persist, and a dormant session can resume into a fresh terminal.
 * Conversely a plain shell terminal can exist with no agent session at all.
 */

import type { ProviderId } from './capabilities.js';
import type { TitleSource } from './title.js';

export type SessionLifecycle =
  | 'live'
  | 'dormant'
  | 'completed'
  | 'external'
  | 'failed';

/** What conversation history we can actually reconstruct for this session. */
export type HistoryCapability =
  | 'structured'
  | 'transcript'
  | 'scrollback-only'
  | 'none';

/** How, if at all, the session can be resumed after its process is gone. */
export type ResumeCapability =
  | 'available'
  | 'process-only'
  | 'unsupported'
  | 'unknown';

export interface SessionRecord {
  /** Alive stable ULID. */
  sessionId: string;
  provider: ProviderId;
  /** Provider-native session id, preserved verbatim. */
  providerSessionId?: string;
  locationId: string;
  workspaceId: string;
  terminalId?: string;
  parentSessionId?: string;
  title: string;
  titleSource: TitleSource;
  firstPromptPreview?: string;
  lifecycle: SessionLifecycle;
  historyCapability: HistoryCapability;
  resumeCapability: ResumeCapability;
  createdAt: number;
  lastActiveAt: number;
}

/** Conversation item variants (spec §F.7); providers are not flattened together. */
export type ConversationItemKind =
  | 'user'
  | 'assistant'
  | 'reasoning'
  | 'tool-call'
  | 'approval'
  | 'artifact'
  | 'system-event';
