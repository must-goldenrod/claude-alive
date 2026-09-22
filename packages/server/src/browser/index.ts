/**
 * Browser automation for claude-alive: local Chrome driven by Stagehand,
 * with Claude answering the parts that need judgement.
 */
export {
  createClaudeLLM,
  toAnthropicRequest,
  fromAnthropicResponse,
  DEFAULT_BROWSER_MODEL,
  DEFAULT_MAX_TOKENS,
  type ClaudeLLMOptions,
  type GenerateInput,
  type GenerateOutput,
} from './claudeLLM.js';

export {
  collectPageFacts,
  checkSelectors,
  checkLinkTargets,
  summarize,
  type CheckResult,
  type CheckStatus,
  type CheckSummary,
  type PageFacts,
  type PageLike,
} from './checks.js';

export {
  inspectPage,
  assertInspectableUrl,
  type ExtractFn,
  type InspectDeps,
  type InspectReport,
  type InspectSpec,
  type QuestionAnswer,
} from './inspect.js';

export {
  createClaudeCliLLM,
  buildCliArgs,
  flattenPrompt,
  parseCliResult,
  DEFAULT_CLI_MODEL,
  type ClaudeCliLLMOptions,
} from './claudeCliLLM.js';

export {
  chooseBackend,
  openBrowserSession,
  withBrowserSession,
  ANSWER_SCHEMA,
  RELAXED_DEFAULT_FLAGS,
  type BrowserSession,
  type BrowserSessionOptions,
  type InferenceBackend,
} from './session.js';

export { inspectUrl } from './inspectUrl.js';
