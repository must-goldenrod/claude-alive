#!/usr/bin/env node

import { installHooks, uninstallHooks } from '@claude-alive/hooks';
import {
  DEFAULT_RUNTIME_PROBES,
  augmentPath,
  formatDoctorReport,
  runDoctor,
  addDeviceToken,
  listDeviceTokens,
  revokeDeviceToken,
  readEnvValue,
  type CommandRunner,
} from '@claude-alive/core';
import { randomBytes } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  openSync,
  existsSync,
  chmodSync,
} from 'node:fs';
import { homedir } from 'node:os';

const ALIVE_DIR = join(homedir(), '.claude-alive');
const PID_FILE = join(ALIVE_DIR, 'server.pid');
const LOG_FILE = join(ALIVE_DIR, 'server.log');
const ENV_FILE = join(ALIVE_DIR, '.env');

/** Env-file text, or '' when there is no file yet. */
function readEnvFile(): string {
  try {
    return readFileSync(ENV_FILE, 'utf-8');
  } catch {
    return '';
  }
}

/** Write the env file 0600: it holds the tokens that stand in for loopback trust. */
function writeEnvFile(text: string): void {
  mkdirSync(ALIVE_DIR, { recursive: true });
  writeFileSync(ENV_FILE, text, { mode: 0o600 });
  try {
    chmodSync(ENV_FILE, 0o600);
  } catch {
    // Filesystem without POSIX modes; the write above already asked for 0600.
  }
}

/**
 * The server's own token, for CLI calls. Once remote mode is on, `/api/status`
 * needs authentication even from this machine — a tunnelled request would
 * otherwise be indistinguishable from this one.
 */
function localToken(): string | undefined {
  return readEnvValue(readEnvFile(), 'CLAUDE_ALIVE_LOCAL_TOKEN') || undefined;
}

/** Read `--flag value` or `--flag=value` out of argv. */
function flagValue(argv: readonly string[], flag: string): string | undefined {
  const inline = argv.find((a) => a.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = argv.indexOf(flag);
  if (index !== -1 && argv[index + 1] && !argv[index + 1]!.startsWith('-')) return argv[index + 1];
  return undefined;
}

function readPid(): number | null {
  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
    process.kill(pid, 0); // check if process exists
    return pid;
  } catch {
    try { unlinkSync(PID_FILE); } catch {}
    return null;
  }
}

/**
 * Resolve the server entry-point script. This CLI runs in two layouts:
 *
 *   1. **Workspace / `npm link`** — `dist/index.js` sits in `packages/cli/dist/`,
 *      so the sibling server lives at `../../server/dist/index.js`.
 *   2. **Published npm bundle** — `cli.js` and `dist/server.js` are produced by
 *      `scripts/build-npm.sh` and placed in the same package root; the layout is
 *      `<root>/cli.js` + `<root>/dist/server.js`.
 *
 * Probe candidate paths in order and return the first that exists. Doing this
 * at runtime is what lets a single CLI source serve both publish targets —
 * the previous design duplicated the entire CLI in `npm/cli-entry.ts` and
 * drifted on every edit (see PR #21/#22 fallout).
 */
function serverEntryPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // Workspace: packages/cli/dist/index.js → packages/server/dist/index.js
    resolve(currentDir, '..', '..', 'server', 'dist', 'index.js'),
    // npm bundle: <pkg>/cli.js → <pkg>/dist/server.js
    resolve(currentDir, 'dist', 'server.js'),
    // npm bundle alt: <pkg>/dist/cli.js → <pkg>/dist/server.js (sibling)
    resolve(currentDir, 'server.js'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  // Last resort: return the workspace path so the resulting error message
  // points to something a developer can debug.
  return candidates[0]!;
}

// macOS launchd plist for the unified claude-alive server. As of D-048+
// the absorbed think-prompt subsystem (prompt API + worker queue) runs
// inside this same Node process, so one plist covers everything.

const LAUNCHD_LABEL = 'com.claudealive.server';
const LAUNCHD_FILE = `${homedir()}/Library/LaunchAgents/${LAUNCHD_LABEL}.plist`;

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildClaudeAlivePlist(): string {
  const nodePath = process.execPath;
  const entry = serverEntryPath();
  const logFile = join(ALIVE_DIR, 'autostart-server.log');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodePath)}</string>
    <string>${xmlEscape(entry)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(ALIVE_DIR)}</string>
  <key>StandardOutPath</key>
  <string>${xmlEscape(logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(logFile)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xmlEscape(`${homedir()}/.local/bin:${homedir()}/.npm-global/bin:${homedir()}/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`)}</string>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
</dict>
</plist>
`;
}

function uidShell(): string {
  return execFileSync('id', ['-u']).toString().trim();
}

function tryRun(cmd: string, args: string[]): boolean {
  try {
    execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

function claudeAliveAutostart(sub: 'enable' | 'disable' | 'status'): void {
  if (process.platform !== 'darwin') {
    console.log('  • claude-alive autostart plist: skipped (macOS only)');
    return;
  }
  mkdirSync(`${homedir()}/Library/LaunchAgents`, { recursive: true });
  if (sub === 'enable') {
    writeFileSync(LAUNCHD_FILE, buildClaudeAlivePlist(), 'utf-8');
    if (!tryRun('launchctl', ['bootstrap', `gui/${uidShell()}`, LAUNCHD_FILE])) {
      tryRun('launchctl', ['load', '-w', LAUNCHD_FILE]);
    }
    console.log(`  ✓ claude-alive autostart plist installed at ${LAUNCHD_FILE}`);
  } else if (sub === 'disable') {
    if (existsSync(LAUNCHD_FILE)) {
      tryRun('launchctl', ['bootout', `gui/${uidShell()}/${LAUNCHD_LABEL}`]);
      tryRun('launchctl', ['unload', '-w', LAUNCHD_FILE]);
      try { unlinkSync(LAUNCHD_FILE); } catch {}
      console.log('  ✓ claude-alive autostart plist removed');
    } else {
      console.log('  • claude-alive autostart plist not installed');
    }
  } else {
    const installed = existsSync(LAUNCHD_FILE);
    const loaded = tryRun('launchctl', ['print', `gui/${uidShell()}/${LAUNCHD_LABEL}`]);
    console.log(`  claude-alive autostart: installed=${installed}, loaded=${loaded}`);
  }
}

const command = process.argv[2];
const args = process.argv.slice(3);

/**
 * Open `url` in the user's default browser. Best-effort: errors are swallowed
 * because failing to launch the browser shouldn't crash `start` — the user
 * still has the URL printed in the console as a fallback.
 *
 * Per-platform invocations:
 *   macOS   → `open <url>`
 *   Linux   → `xdg-open <url>` (most distros)
 *   Windows → `cmd /c start "" "<url>"` (quoted to handle URLs with &)
 */
function openBrowser(url: string): void {
  try {
    const platform = process.platform;
    if (platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else if (platform === 'win32') {
      spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // Headless box or missing opener — user can copy the URL from stdout.
  }
}

switch (command) {
  case 'install': {
    console.log('Installing claude-alive hooks...');
    const result = installHooks();
    console.log(`  ✓ hook script: ${result.hookScriptPath}`);
    console.log(`  ✓ settings:    ${result.settingsPath}`);
    console.log('\nDone! Claude Code will stream events to the unified claude-alive server.');
    console.log('Run "claude-alive start" to launch the dashboard on :3141.');
    break;
  }

  case 'uninstall': {
    console.log('Removing claude-alive hooks...');
    uninstallHooks();
    console.log('  ✓ hooks removed from settings.json');

    if (process.platform === 'darwin' && existsSync(LAUNCHD_FILE)) {
      claudeAliveAutostart('disable');
    }
    console.log('\nDone. Prompt data is preserved at ~/.think-prompt/.');
    break;
  }

  case 'start': {
    // `--no-open` skips auto-launching the browser. Default is to open: most
    // users only run `claude-alive start` to see the dashboard, so requiring
    // an extra copy-paste step is friction. Power users / CI / headless boxes
    // pass --no-open. Matches the convention of `vite`, `next dev`, etc.
    const noOpen = args.includes('--no-open');
    const port = process.env.CLAUDE_ALIVE_PORT ?? '3141';
    const url = `http://localhost:${port}`;
    // Remote mode is opt-in on the command line as well as in the env file, so
    // "expose this server" is always something someone typed.
    const remote = args.includes('--remote');
    const host = flagValue(args, '--host');

    const existingPid = readPid();
    if (existingPid) {
      console.log(`claude-alive server is already running (PID: ${existingPid}).`);
      console.log(`  Dashboard: ${url}`);
      if (!noOpen) openBrowser(url);
      break;
    }
    mkdirSync(ALIVE_DIR, { recursive: true });
    const logFd = openSync(LOG_FILE, 'a');
    const child = spawn('node', [serverEntryPath()], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: {
        ...process.env,
        ...(remote ? { CLAUDE_ALIVE_REMOTE: '1' } : {}),
        ...(host ? { CLAUDE_ALIVE_HOST: host } : {}),
      },
    });
    writeFileSync(PID_FILE, String(child.pid));
    child.unref();

    console.log(`claude-alive server started in background (PID: ${child.pid}).`);
    console.log(`  Dashboard: ${url}`);
    console.log(`  Logs:      ${LOG_FILE}`);

    // The server refuses to boot on an unsafe remote configuration, and a
    // detached child's exit is invisible — so check, and show why.
    setTimeout(() => {
      if (!readPid()) {
        console.error('\nThe server exited immediately. Last log lines:');
        try {
          console.error(readFileSync(LOG_FILE, 'utf-8').split('\n').slice(-12).join('\n'));
        } catch {
          console.error('  (no log file)');
        }
        process.exit(1);
      }
      if (!noOpen) {
        // In remote mode the dashboard needs the local token to get past the
        // gate, and a browser cannot set a header — hand it over in the URL
        // once; the page moves it into localStorage and strips it.
        const token = localToken();
        openBrowser(remote && token ? `${url}/?token=${encodeURIComponent(token)}` : url);
      }
    }, 900);
    break;
  }

  case 'stop': {
    const pid = readPid();
    if (!pid) {
      console.log('claude-alive server is not running.');
      break;
    }
    process.kill(pid, 'SIGINT');
    try { unlinkSync(PID_FILE); } catch {}
    console.log(`claude-alive server stopped (PID: ${pid}).`);
    break;
  }

  case 'status': {
    const port = process.env.CLAUDE_ALIVE_PORT ?? '3141';
    const pid = readPid();
    let aliveStatus: unknown = null;
    try {
      // With remote mode on this call needs the token like any other caller.
      const token = localToken();
      const res = await fetch(`http://localhost:${port}/api/status`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      aliveStatus = res.ok ? await res.json() : { running: false, status: res.status };
    } catch {
      aliveStatus = { running: false };
    }
    console.log(JSON.stringify({ pid, ...((aliveStatus as Record<string, unknown>) ?? {}) }, null, 2));
    break;
  }

  case 'token': {
    const sub = process.argv[3] ?? 'list';
    const text = readEnvFile();
    if (sub === 'list') {
      const tokens = listDeviceTokens(text);
      // Labels only. Printing a value on `list` would put it in scrollback and
      // shell history for every later session.
      console.log(tokens.length === 0 ? 'No device tokens.' : tokens.map((t) => `  ${t.label}`).join('\n'));
      console.log(localToken() ? '\nLocal token: present (used by hooks, CLI and the dashboard).' : '\nLocal token: not yet generated (created on the first remote start).');
      break;
    }
    if (sub === 'new') {
      const label = process.argv[4] ?? 'device';
      const value = randomBytes(32).toString('base64url');
      try {
        writeEnvFile(addDeviceToken(text, label, value));
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
      console.log(`Device token for "${label}":\n\n  ${value}\n`);
      console.log('Shown once — store it in the app now. It is saved in ~/.claude-alive/.env.');
      console.log('Restart the server for it to take effect: claude-alive stop && claude-alive start --remote');
      break;
    }
    if (sub === 'revoke') {
      const label = process.argv[4];
      if (!label) {
        console.error('Usage: claude-alive token revoke <label>');
        process.exit(1);
      }
      const next = revokeDeviceToken(text, label);
      if (next === text) {
        console.error(`No device token labelled "${label}".`);
        process.exit(1);
      }
      writeEnvFile(next);
      console.log(`Revoked "${label}". Restart the server to drop it: claude-alive stop && claude-alive start --remote`);
      break;
    }
    console.error(`Unknown token subcommand "${sub}". Use new|list|revoke.`);
    process.exit(1);
    break;
  }

  case 'autostart': {
    const sub = process.argv[3] ?? 'status';
    if (!['enable', 'disable', 'status'].includes(sub)) {
      console.error(`Unknown autostart subcommand "${sub}". Use enable|disable|status.`);
      process.exit(1);
    }
    claudeAliveAutostart(sub as 'enable' | 'disable' | 'status');
    break;
  }

  case 'doctor': {
    const execFileAsync = promisify(execFile);
    // Probe with the same augmented PATH the server uses to spawn runtimes;
    // under launchd the inherited PATH is minimal and would yield false ENOENTs.
    const probeEnv = { ...process.env, PATH: augmentPath(process.env.PATH) };
    /** Probe a runtime binary; a missing binary rejects with ENOENT → not installed. */
    const runner: CommandRunner = async (cmd, args) => {
      try {
        const { stdout } = await execFileAsync(cmd, args, { timeout: 5_000, env: probeEnv });
        return { ok: true, stdout };
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        return { ok: false, stdout: '', error: err?.message ?? String(error), code: err?.code };
      }
    };
    const report = await runDoctor(DEFAULT_RUNTIME_PROBES, runner, Date.now());
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatDoctorReport(report));
    }
    break;
  }

  case 'logs': {
    try {
      const logs = readFileSync(LOG_FILE, 'utf-8');
      const lines = logs.split('\n');
      const tail = lines.slice(-50).join('\n');
      console.log(tail);
    } catch {
      console.log('No log file found.');
    }
    break;
  }

  default: {
    console.log(`
claude-alive — Unified Claude Code dashboard + prompt quality coach

Usage:
  claude-alive install      Install Claude Code hooks (single-entry per event)
  claude-alive uninstall    Remove hooks (prompt data preserved at ~/.think-prompt/)
  claude-alive start        Start the dashboard server (:3141) and open the UI
                            (pass --no-open to skip browser launch)
                            (--remote opens it to other devices; --host <addr> to pick
                             the interface. Remote mode needs a device token and
                             CLAUDE_ALIVE_TICKET_ROOTS, or the server refuses to boot.)
  claude-alive stop         Stop the server
  claude-alive status       Show server status
  claude-alive token        new <label>|list|revoke <label> — device tokens for
                            remote access from the app
  claude-alive autostart    enable|disable|status — macOS launchd plist
  claude-alive doctor       Detect installed agent runtimes and adapter status
                            (pass --json for machine-readable output)
  claude-alive logs         Show recent server logs
`);
  }
}
