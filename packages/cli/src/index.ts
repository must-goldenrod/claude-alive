#!/usr/bin/env node

import { installHooks, uninstallHooks } from '@claude-alive/hooks';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  openSync,
  existsSync,
} from 'node:fs';
import { homedir } from 'node:os';

const ALIVE_DIR = join(homedir(), '.claude-alive');
const PID_FILE = join(ALIVE_DIR, 'server.pid');
const LOG_FILE = join(ALIVE_DIR, 'server.log');

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
    });
    writeFileSync(PID_FILE, String(child.pid));
    child.unref();

    console.log(`claude-alive server started in background (PID: ${child.pid}).`);
    console.log(`  Dashboard: ${url}`);
    console.log(`  Logs:      ${LOG_FILE}`);

    if (!noOpen) {
      // Wait briefly for the server to bind :3141 before opening the browser —
      // otherwise the user sees a Chrome "site can't be reached" page and has
      // to refresh. 800ms is enough for the bundled server on cold start.
      setTimeout(() => openBrowser(url), 800);
    }
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
      const res = await fetch(`http://localhost:${port}/api/status`);
      aliveStatus = await res.json();
    } catch {
      aliveStatus = { running: false };
    }
    console.log(JSON.stringify({ pid, ...((aliveStatus as Record<string, unknown>) ?? {}) }, null, 2));
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
  claude-alive stop         Stop the server
  claude-alive status       Show server status
  claude-alive autostart    enable|disable|status — macOS launchd plist
  claude-alive logs         Show recent server logs
`);
  }
}
