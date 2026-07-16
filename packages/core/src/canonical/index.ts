/**
 * Canonical provider-neutral contracts (spec §G–§I).
 *
 * This is the v2 foundation every adapter and projection depends on. It is pure
 * (no I/O) so it can be imported by any package and tested deterministically.
 */

export {
  PROVIDER_IDS,
  TERMINAL_CAPABILITIES,
} from './capabilities.js';
export type { ProviderId, ProviderCapabilities } from './capabilities.js';

export { COMMON_AGENT_STATES } from './state.js';
export type { CommonAgentState, StateConfidence, NormalizedState } from './state.js';

export { CANONICAL_EVENT_KINDS } from './events.js';
export type { CanonicalEvent, CanonicalEventKind, EventSource } from './events.js';

export type {
  LocationKind,
  LocationStatus,
  LocationSummary,
  RepositoryIdentity,
  WorkspaceIdentity,
} from './workspace.js';

export type {
  SessionRecord,
  SessionLifecycle,
  HistoryCapability,
  ResumeCapability,
  ConversationItemKind,
} from './domain.js';

export {
  TITLE_MAX_GRAPHEMES,
  PREVIEW_MAX_GRAPHEMES,
  isMeaningfulPrompt,
  redactSecrets,
  generateTitleFromPrompt,
  pickTitleSource,
} from './title.js';
export type {
  TitleSource,
  SessionTitle,
  TitleGenerationResult,
  PickTitleSourceInput,
} from './title.js';

export {
  createUlidFactory,
  ulid,
  isUlid,
  decodeUlidTime,
} from './ids.js';
export type { UlidClockOptions, UlidFactory } from './ids.js';
