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
export type {
  CanonicalEvent,
  CanonicalEventKind,
  EventSource,
  DedupeConfidence,
} from './events.js';

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

export { codexEventToCanonical } from './codexToCanonical.js';
export type { CodexServerMessage, CodexEventContext } from './codexToCanonical.js';

export { createCodexAdapter, CODEX_CAPABILITIES } from './codexAdapter.js';
export type { CodexAdapterOptions } from './codexAdapter.js';

export { claudeHookToCanonical } from './claudeV1ToV2.js';
export type { ClaudeHookContext } from './claudeV1ToV2.js';

export type {
  AgentRuntimeAdapter,
  SessionId,
  RuntimeInstallation,
  StartSessionInput,
  ProviderSessionRef,
  RuntimeSessionHandle,
  UserInput,
  ApprovalDecision,
  AdapterHealth,
} from './adapter.js';

export { runConformanceSuite } from './conformance.js';
export type { ConformanceCheck, ConformanceReport, ConformanceOptions } from './conformance.js';

export { normalizeLegacyState } from './stateMapping.js';
export { ClaudeCanonicalStream } from './claudeSessionReducer.js';

export { buildConversation } from './conversation.js';
export { parseTranscriptToConversation } from './transcriptConversation.js';
export type { ConversationItem, ConversationItemStatus } from './conversation.js';

export { emptyProjection, applyCanonicalEvent, buildProjection } from './projection.js';
export type { SessionProjectionRow, ProjectionState } from './projection.js';

export {
  probeWorkspace,
  normalizeRemoteUrl,
  canonicalizeRootPath,
  basename,
} from './workspaceProbe.js';
export type { WorkspaceProbeInput } from './workspaceProbe.js';

export { migrateLegacyState } from './migration.js';
export type {
  LegacyAgent,
  LegacyManagedSession,
  LegacyOpenTab,
  MigrationInput,
  MigrationResult,
  SkippedEntry,
} from './migration.js';

export { DEFAULT_RUNTIME_PROBES, extractVersion, runDoctor, formatDoctorReport } from './doctor.js';
export type {
  CommandResult,
  CommandRunner,
  AdapterStatus,
  RuntimeProbe,
  RuntimeDiagnostic,
  DoctorReport,
} from './doctor.js';
