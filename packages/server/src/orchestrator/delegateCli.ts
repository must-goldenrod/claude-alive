/**
 * `ca-delegate` — the sub-agent delegation tool the orchestrator Claude calls
 * (spec §2). Given `--model <id>` and a prompt (arg or stdin), it asks the
 * litellm gateway and prints the sub-agent's answer to stdout (usage JSON to
 * stderr). The orchestrator runs it via Bash (tickets use bypassPermissions).
 *
 * A shell wrapper is written to ~/.claude-alive/bin/ca-delegate at startup
 * (ensureDelegateCli); its absolute path is embedded in the orchestrator prompt.
 */
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createLitellmClient } from './litellmClient.js';

export const DEFAULT_DELEGATE_MODEL = 'gemini/gemini-2.5-flash-lite';

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
}

/**
 * Parse args, resolve the prompt (arg wins over stdin), call the model. Pure
 * enough to test: pass `env`, a `readStdin` thunk, and optional `deps.chat`.
 */
export async function runDelegateCli(
  args: string[],
  env: NodeJS.ProcessEnv,
  readStdin: () => Promise<string>,
  deps: DelegateDeps = {},
): Promise<DelegateResult> {
  let model = DEFAULT_DELEGATE_MODEL;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model') {
      model = args[++i] ?? model;
    } else {
      rest.push(args[i]!);
    }
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
      const r = await client.chat(m, [{ role: 'user', content: p }]);
      return { content: r.content, usage: r.usage };
    });

  try {
    const r = await chat(model, prompt);
    // Record the delegation so the server can attach it to the ticket (which
    // models did what). Keyed by CA_TICKET_ID, set only for orchestrated main runs
    // (not the verifier), so verifier re-delegations don't pollute the ticket.
    const ticketId = env.CA_TICKET_ID;
    if (ticketId) {
      const u = r.usage;
      const record = {
        ticketId,
        model,
        inputTokens: u?.promptTokens,
        outputTokens: u?.completionTokens,
        totalTokens: u?.totalTokens,
        promptPreview: prompt.replace(/\s+/g, ' ').slice(0, 80),
        at: Date.now(),
      };
      const appendLog = deps.appendLog ?? ((line: string) => {
        try {
          mkdirSync(join(homedir(), '.claude-alive'), { recursive: true });
          appendFileSync(env.CA_DELEGATE_LOG ?? DELEGATION_LOG, line + '\n');
        } catch {
          // logging is best-effort; never fail the delegation over it
        }
      });
      appendLog(JSON.stringify(record));
    }
    return { code: 0, stdout: r.content, stderr: JSON.stringify({ model, usage: r.usage }) };
  } catch (e) {
    return { code: 1, stdout: '', stderr: `ca-delegate: ${e instanceof Error ? e.message : 'failed'}` };
  }
}

/**
 * Write the `ca-delegate` wrapper into ~/.claude-alive/bin and return its
 * absolute path. The wrapper execs `node <this-module>` so the orchestrator can
 * call it directly. Idempotent.
 */
export function ensureDelegateCli(): string {
  const binDir = join(homedir(), '.claude-alive', 'bin');
  mkdirSync(binDir, { recursive: true });
  const wrapper = join(binDir, 'ca-delegate');
  const target = fileURLToPath(new URL('./delegateCli.js', import.meta.url));
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

// Direct invocation (the wrapper runs `node delegateCli.js …`).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runDelegateCli(process.argv.slice(2), process.env, readAllStdin).then((r) => {
    if (r.stdout) process.stdout.write(r.stdout.endsWith('\n') ? r.stdout : r.stdout + '\n');
    if (r.stderr) process.stderr.write(r.stderr + '\n');
    process.exit(r.code);
  });
}
