/**
 * `ca-delegate` — the sub-agent delegation tool the orchestrator Claude calls
 * (spec §2). Given `--model <id>` and a prompt (arg or stdin), it asks the
 * litellm gateway and prints the sub-agent's answer to stdout (usage JSON to
 * stderr). The orchestrator runs it via Bash (tickets use bypassPermissions).
 *
 * A shell wrapper is written to ~/.claude-alive/bin/ca-delegate at startup
 * (ensureDelegateCli); its absolute path is embedded in the orchestrator prompt.
 */
import { mkdirSync, writeFileSync, appendFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createLitellmClient } from './litellmClient.js';
import { loadServerEnv } from '../serverEnv.js';
import { buildDelegateChain, DELEGATE_MODELS } from './delegateModels.js';
import { classifyDelegateError } from './delegateErrors.js';
import { createCooldownStore, COOLDOWN_PATH, type CooldownMap, type CooldownStore } from './modelCooldown.js';

/**
 * Fallback delegation model. The gateway's catalogue rotates (a pinned id that
 * is retired answers HTTP 400 "Invalid model name"), so this is only the last
 * resort — `CA_DELEGATE_MODEL` overrides it without a rebuild.
 */
export const DEFAULT_DELEGATE_MODEL = 'gemini/gemini-3.1-flash-lite-preview';

/** Per-attempt ceiling; a hung model must not hold the whole delegation open. */
export const DEFAULT_DELEGATE_TIMEOUT_MS = 180_000;

/** The model ca-delegate uses when the caller passes no `--model`. */
export function resolveDelegateModel(env: NodeJS.ProcessEnv): string {
  return env.CA_DELEGATE_MODEL?.trim() || DEFAULT_DELEGATE_MODEL;
}

/** Where ca-delegate appends one JSON line per delegation (server reads by ticketId). */
export const DELEGATION_LOG = join(homedir(), '.claude-alive', 'delegations.jsonl');

interface DelegateUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface DelegateResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface DelegateDeps {
  /** Override the model call (tests inject; production uses litellm). */
  chat?: (model: string, prompt: string) => Promise<{ content: string; usage?: DelegateUsage }>;
  /** Override the delegation-record append (tests spy; production writes the log). */
  appendLog?: (line: string) => void;
  /** Override the cross-process rate-limit memory (tests inject an in-memory one). */
  cooldowns?: CooldownStore;
  now?: () => number;
}

/** One failed try in the fallback chain, reported on stderr for legibility. */
interface DelegateAttempt {
  model: string;
  status?: number;
  error: string;
}

interface ParsedArgs {
  model: string;
  noFallback: boolean;
  listModels: boolean;
  rest: string[];
}

function parseArgs(args: string[], env: NodeJS.ProcessEnv): ParsedArgs {
  let model = resolveDelegateModel(env);
  let noFallback = false;
  let listModels = false;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--model' || a === '-m') model = args[++i] ?? model;
    else if (a === '--no-fallback') noFallback = true;
    else if (a === '--list-models' || a === '--models') listModels = true;
    else rest.push(a!);
  }
  return { model, noFallback, listModels, rest };
}

/**
 * Order the chain against what we already know is rate-limited.
 *
 * Cooling models are dropped rather than tried-and-failed. When every candidate
 * is cooling there is nothing to be gained by walking all of them, so only the
 * one that recovers soonest is attempted — the stored window is a hint and may
 * be stale, but four guaranteed 429s are not worth the wall-clock.
 */
export function orderChainByCooldown(
  chain: readonly string[],
  cooldowns: CooldownMap,
  now: number,
): { order: string[]; skipped: string[] } {
  const cold = (m: string) => (cooldowns[m] ?? 0) > now;
  const ready = chain.filter((m) => !cold(m));
  if (ready.length > 0) return { order: ready, skipped: chain.filter(cold) };
  const soonest = [...chain].sort((a, b) => (cooldowns[a] ?? 0) - (cooldowns[b] ?? 0))[0];
  return { order: soonest ? [soonest] : [], skipped: chain.filter((m) => m !== soonest) };
}

/** `--list-models` output: the catalogue plus live cooldown state. */
function renderCatalogue(cooldowns: CooldownMap, now: number): string {
  const rows = DELEGATE_MODELS.map((m) => {
    const until = cooldowns[m.id];
    const mins = until && until > now ? Math.ceil((until - now) / 60_000) : 0;
    const state = mins > 0 ? `cooling ${mins}m` : 'ready';
    return `${m.id}\t${m.aliases.join(',')}\t${m.kind}\t${state}\t${m.note}`;
  });
  return [
    'id\taliases\tkind\tstate\tnote',
    ...rows,
    '',
    'usage: ca-delegate [--model <id|alias|a,b,c>] [--no-fallback] "<prompt>"',
    'A failed model falls back to the next in its chain; --no-fallback pins one model.',
  ].join('\n');
}

/**
 * Parse args, resolve the prompt (arg wins over stdin), then walk the fallback
 * chain until one model answers. Pure enough to test: pass `env`, a `readStdin`
 * thunk, and optional `deps.chat`.
 */
export async function runDelegateCli(
  args: string[],
  env: NodeJS.ProcessEnv,
  readStdin: () => Promise<string>,
  deps: DelegateDeps = {},
): Promise<DelegateResult> {
  const now = deps.now ?? Date.now;
  const cooldowns = deps.cooldowns ?? createCooldownStore(env.CA_DELEGATE_COOLDOWNS || COOLDOWN_PATH);
  const { model: requested, noFallback, listModels, rest } = parseArgs(args, env);

  if (listModels) {
    return { code: 0, stdout: renderCatalogue(cooldowns.read(), now()), stderr: '' };
  }

  const prompt = (rest.join(' ').trim() || (await readStdin()).trim()).trim();
  if (!prompt) return { code: 2, stdout: '', stderr: 'ca-delegate: no prompt (pass as arg or stdin)' };

  const chat =
    deps.chat ??
    (async (m: string, p: string) => {
      const key = env.LITELLM_KEY;
      if (!key) throw new Error('LITELLM_KEY not set');
      const client = createLitellmClient({
        baseUrl: env.LITELLM_BASE_URL ?? 'https://litellm.must.codes',
        apiKey: key,
      });
      const timeoutMs = Number(env.CA_DELEGATE_TIMEOUT_MS) || DEFAULT_DELEGATE_TIMEOUT_MS;
      const r = await client.chat(m, [{ role: 'user', content: p }], { timeoutMs });
      return { content: r.content, usage: r.usage };
    });

  const chain = buildDelegateChain(requested, {
    noFallback,
    ...(env.CA_DELEGATE_FALLBACKS ? { fallbackOverride: env.CA_DELEGATE_FALLBACKS } : {}),
  });
  const { order, skipped } = orderChainByCooldown(chain, cooldowns.read(), now());
  const attempts: DelegateAttempt[] = [];

  for (const model of order) {
    try {
      const r = await chat(model, prompt);
      const first = chain[0];
      logDelegation({ env, deps, model, requested: first !== model ? first : undefined, prompt, usage: r.usage });
      return {
        code: 0,
        stdout: r.content,
        stderr: JSON.stringify({
          model,
          usage: r.usage,
          ...(attempts.length ? { attempts } : {}),
          ...(skipped.length ? { skippedCooling: skipped } : {}),
        }),
      };
    } catch (e) {
      const v = classifyDelegateError(e);
      attempts.push({ model, ...(v.status ? { status: v.status } : {}), error: v.message });
      if (v.cooldownMs) cooldowns.record(model, v.cooldownMs);
      if (!v.retryable) break;
    }
  }

  const last = attempts[attempts.length - 1];
  return {
    code: 1,
    stdout: '',
    stderr: `ca-delegate: ${last?.error ?? 'no model available'} ${JSON.stringify({ attempts, ...(skipped.length ? { skippedCooling: skipped } : {}) })}`,
  };
}

/**
 * Record the delegation so the server can attach it to the ticket (which models
 * did what). Keyed by CA_TICKET_ID, set only for orchestrated main runs (not the
 * verifier), so verifier re-delegations don't pollute the ticket.
 */
function logDelegation(o: {
  env: NodeJS.ProcessEnv;
  deps: DelegateDeps;
  model: string;
  requested?: string;
  prompt: string;
  usage?: DelegateUsage;
}): void {
  const ticketId = o.env.CA_TICKET_ID;
  if (!ticketId) return;
  const record = {
    ticketId,
    model: o.model,
    ...(o.requested ? { requestedModel: o.requested } : {}),
    inputTokens: o.usage?.promptTokens,
    outputTokens: o.usage?.completionTokens,
    totalTokens: o.usage?.totalTokens,
    promptPreview: o.prompt.replace(/\s+/g, ' ').slice(0, 80),
    at: Date.now(),
  };
  const appendLog =
    o.deps.appendLog ??
    ((line: string) => {
      try {
        mkdirSync(join(homedir(), '.claude-alive'), { recursive: true });
        appendFileSync(o.env.CA_DELEGATE_LOG ?? DELEGATION_LOG, line + '\n');
      } catch {
        // logging is best-effort; never fail the delegation over it
      }
    });
  appendLog(JSON.stringify(record));
}

/**
 * Write the `ca-delegate` wrapper into ~/.claude-alive/bin and return its
 * absolute path, or `null` when the CLI module it would exec is absent.
 *
 * The null case is real: this module is bundled INTO dist/server.js, so the
 * sibling `dist/delegateCli.js` only exists when the packaging step emits it as
 * its own entry. Writing the wrapper anyway produced a tool that every
 * orchestrated ticket called and that always died with "Cannot find module" —
 * so a missing target now removes the stale wrapper and disables orchestration
 * instead of advertising a broken tool.
 */
export function ensureDelegateCli(): string | null {
  const binDir = join(homedir(), '.claude-alive', 'bin');
  const wrapper = join(binDir, 'ca-delegate');
  const target = fileURLToPath(new URL('./delegateCli.js', import.meta.url));
  if (!existsSync(target)) {
    try {
      rmSync(wrapper, { force: true });
    } catch {
      // best-effort cleanup; a leftover wrapper must not stop the server booting
    }
    return null;
  }
  mkdirSync(binDir, { recursive: true });
  writeFileSync(wrapper, `#!/bin/sh\nexec node ${JSON.stringify(target)} "$@"\n`, { mode: 0o755 });
  return wrapper;
}

/** Read all of stdin as a string (empty if none is piped). */
function readAllStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

// Direct invocation (the wrapper runs `node delegateCli.js …`). The extra
// filename check keeps this from firing when this module is esbuild-bundled
// INTO the server (dist/server.js), where `import.meta.url` would otherwise
// equal `process.argv[1]` and run the CLI at server startup (exit 2).
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1] &&
  import.meta.url.endsWith('delegateCli.js')
) {
  // The agent that runs this tool inherits the server's env, which is a detached
  // daemon's — so LITELLM_KEY may only exist in ~/.claude-alive/.env. Read it
  // here too, so a delegation works even when the server booted without the key.
  loadServerEnv();
  runDelegateCli(process.argv.slice(2), process.env, readAllStdin).then((r) => {
    if (r.stdout) process.stdout.write(r.stdout.endsWith('\n') ? r.stdout : r.stdout + '\n');
    if (r.stderr) process.stderr.write(r.stderr + '\n');
    process.exit(r.code);
  });
}
