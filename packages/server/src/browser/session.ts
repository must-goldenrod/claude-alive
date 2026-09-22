/**
 * Local Chrome session for Stagehand.
 *
 * Runs entirely on this machine: Stagehand spawns Chrome with a throwaway
 * profile and drives it over a loopback CDP port. No Browserbase account is
 * involved. Claude is attached as the inference backend only when a
 * credential exists — without one the session still serves every
 * deterministic check.
 */
import { spawnSync } from 'node:child_process';
import { Stagehand, localBrowser, type ClientLLM, type StagehandBrowser } from '@browserbasehq/stagehand';
import { z } from 'zod';
import { createClaudeLLM } from './claudeLLM.js';
import { createClaudeCliLLM } from './claudeCliLLM.js';
import type { PageLike } from './checks.js';
import type { ExtractFn } from './inspect.js';

/**
 * Chrome flags Stagehand adds by default that widen the local attack surface
 * and that inspection does not need. Dropped unless a caller opts back in.
 *
 * `--remote-allow-origins=*` is deliberately NOT in this list: Stagehand's own
 * CDP client fails to connect without it ("CDP websocket failed to open"), so
 * it is load-bearing, not optional. The residual exposure is bounded — the
 * debugging port binds to 127.0.0.1 only — but any local process that can
 * reach that port can drive the browser while a session is open. Keep
 * sessions short and never point one at an untrusted page.
 */
export const RELAXED_DEFAULT_FLAGS = ['--enable-unsafe-extension-debugging'] as const;

/** Stagehand answers questions in this shape so a report can grade them. */
export const ANSWER_SCHEMA = z.object({
  answer: z.string().describe('한두 문장으로 된 답'),
  ok: z.boolean().describe('점검 관점에서 문제가 없으면 true'),
});

export interface BrowserSessionOptions {
  readonly headless?: boolean;
  /** Anthropic key; falls back to `ANTHROPIC_API_KEY`. */
  readonly apiKey?: string | undefined;
  readonly model?: string;
  /** Pre-built LLM (tests, or a different backend). Overrides `apiKey`. */
  readonly llm?: ClientLLM;
  /** Override the Anthropic base URL (proxy, or a stub in tests). */
  readonly baseURL?: string;
  /**
   * Which Claude path to use. `auto` prefers the API key and falls back to the
   * local `claude` CLI (the Claude Code subscription login); `none` disables
   * inference and leaves only the deterministic checks.
   */
  readonly backend?: 'auto' | 'api' | 'cli' | 'none';
  /** Keep Stagehand's relaxed Chrome defaults. Off unless explicitly set. */
  readonly allowRelaxedChromeFlags?: boolean;
  readonly viewport?: { width: number; height: number };
}

export interface BrowserSession {
  readonly stagehand: Stagehand;
  readonly page: PageLike;
  /** Undefined when no Claude credential was available. */
  readonly extract: ExtractFn | undefined;
  close(): Promise<void>;
}

export type InferenceBackend = 'api' | 'cli' | 'none';

/**
 * Decide which Claude path a session uses.
 *
 * The API key wins on `auto` because the CLI re-sends its own system prompt
 * and tool definitions on every call (~30k tokens), while the API adapter
 * sends only the page's accessibility tree. An explicit choice is never
 * silently downgraded — asking for `api` without a key yields `none`, not a
 * surprise CLI invocation.
 */
export function chooseBackend(
  options: Pick<BrowserSessionOptions, 'backend' | 'apiKey'>,
  env: NodeJS.ProcessEnv,
  cliAvailable: boolean,
): InferenceBackend {
  const requested = options.backend ?? 'auto';
  if (requested === 'none') return 'none';
  const key = options.apiKey ?? env['ANTHROPIC_API_KEY'];
  const hasKey = key !== undefined && key !== '';

  if (requested === 'api') return hasKey ? 'api' : 'none';
  if (requested === 'cli') return cliAvailable ? 'cli' : 'none';
  if (hasKey) return 'api';
  return cliAvailable ? 'cli' : 'none';
}

/** Whether a `claude` binary is on PATH. Cached per process — PATH is stable. */
let cliAvailableCache: boolean | undefined;
function isCliAvailable(binary = 'claude'): boolean {
  if (cliAvailableCache !== undefined) return cliAvailableCache;
  const probe = spawnSync(binary, ['--version'], { stdio: 'ignore' });
  cliAvailableCache = probe.status === 0;
  return cliAvailableCache;
}

/** Build the Claude LLM for the chosen backend, or undefined when disabled. */
function resolveLlm(options: BrowserSessionOptions): ClientLLM | undefined {
  if (options.llm !== undefined) return options.llm;
  const backend = chooseBackend(options, process.env, isCliAvailable());
  if (backend === 'none') return undefined;
  if (backend === 'cli') {
    return createClaudeCliLLM({ ...(options.model === undefined ? {} : { model: options.model }) });
  }
  return createClaudeLLM({
    apiKey: options.apiKey ?? process.env['ANTHROPIC_API_KEY'],
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
  });
}

/**
 * Seams for tests: the two things a session owns that cannot be faked from the
 * outside. Production passes neither.
 */
export interface BrowserSessionDeps {
  launch?: (options: Parameters<typeof localBrowser.launch>[0]) => Promise<StagehandBrowser>;
  createStagehand?: (options: Parameters<typeof Stagehand.create>[0]) => Promise<Stagehand>;
}

/** Launch Chrome and initialise Stagehand. The caller must `close()`. */
export async function openBrowserSession(
  options: BrowserSessionOptions = {},
  deps: BrowserSessionDeps = {},
): Promise<BrowserSession> {
  const launch = deps.launch ?? ((o) => localBrowser.launch(o));
  const createStagehand = deps.createStagehand ?? ((o) => Stagehand.create(o));
  const browser = await launch({
    headless: options.headless ?? true,
    ...(options.allowRelaxedChromeFlags === true ? {} : { ignoreDefaultArgs: [...RELAXED_DEFAULT_FLAGS] }),
    ...(options.viewport === undefined ? {} : { viewport: options.viewport }),
  });

  const llm = resolveLlm(options);
  const stagehand = await createStagehand({
    browser,
    ...(llm === undefined ? {} : { model: llm }),
    logging: { level: 'error' },
  });

  const page = (await stagehand.browser.context.newPage()) as unknown as PageLike;
  const extract: ExtractFn | undefined =
    llm === undefined
      ? undefined
      : async (instruction: string) => stagehand.extract(instruction, ANSWER_SCHEMA);

  /**
   * Close BOTH halves, in order, and never throw.
   *
   * `stagehand.close()` alone was the original teardown, and it is not enough:
   * this session launches Chrome itself, so the browser handle owns the child
   * process and the CDP socket. Leaving it open kept two handles alive
   * (`ProcessWrap`, `TCPSocketWrap`), which meant a script using this module
   * finished its work and then never exited — and every run left a headless
   * Chrome behind. Nineteen of them were found running on one machine, the
   * oldest for over a day, holding ~12 GB.
   *
   * Errors are swallowed because teardown runs in a `finally`: a browser that
   * is already gone must not replace the caller's real error with its own, and
   * a failure here leaves nothing the caller can do differently.
   */
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    try {
      await stagehand.close();
    } catch {
      // The client may already be detached; the browser still has to go.
    }
    try {
      if (!browser.closed) await browser.close();
    } catch {
      // Chrome may have died on its own. Nothing left to reap.
    }
  };

  return { stagehand, page, extract, close };
}

/** Run `fn` against a session and always close the browser afterwards. */
export async function withBrowserSession<T>(
  options: BrowserSessionOptions,
  fn: (session: BrowserSession) => Promise<T>,
  deps: BrowserSessionDeps = {},
): Promise<T> {
  const session = await openBrowserSession(options, deps);
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}
