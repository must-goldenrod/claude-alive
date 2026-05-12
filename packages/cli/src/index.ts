#!/usr/bin/env node

import { installHooks, uninstallHooks } from '@claude-alive/hooks';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
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
    // PID file missing or process not running
    try { unlinkSync(PID_FILE); } catch {}
    return null;
  }
}

function serverEntryPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return resolve(currentDir, '..', '..', 'server', 'dist', 'index.js');
}

/**
 * Locate and shell out to the `think-prompt` binary. We prefer the binary
 * installed alongside claude-alive (as a runtime dep, via `node_modules/.bin`)
 * but fall back to a `PATH` lookup so users who already had think-prompt
 * installed globally are not surprised.
 *
 * Returns { ok, stdout, stderr } so the caller can decide whether to display
 * the output, fall back to a different sub-command, or fail-open.
 */
function runThinkPrompt(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const localBin = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'node_modules',
    '.bin',
    'think-prompt',
  );
  const bin = existsSync(localBin) ? localBin : 'think-prompt';
  const res = spawnSync(bin, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  return {
    ok: res.status === 0,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}

// ──────────────────────────────────────────────────────────────────────────
// macOS launchd plist for the claude-alive dashboard server. Mirrors the
// crash-only respawn / 10s back-off / combined log policy that think-prompt's
// autostart uses (think-prompt D-031) so both surfaces feel the same. We do
// NOT ship a systemd unit yet — Linux GUIs that benefit from auto-starting a
// local dashboard server are uncommon, and adding a `--user` unit means
// every Linux quirk (lingering, getty, headless servers) becomes our problem.
// Linux users wanting autostart should drop their own systemd unit or run
// `claude-alive start` from their shell rc.
// ──────────────────────────────────────────────────────────────────────────

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
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
</dict>
</plist>
`;
}

function uid(): string {
  return execFileSync('id', ['-u']).toString().trim();
}

function tryRun(cmd: string, args: string[]): { ok: boolean; stdout: string } {
  try {
    const out = execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return { ok: true, stdout: out };
  } catch {
    return { ok: false, stdout: '' };
  }
}

function claudeAliveAutostart(sub: 'enable' | 'disable' | 'status'): void {
  if (process.platform !== 'darwin') {
    // No-op on non-macOS; the delegated think-prompt autostart still runs.
    console.log(`  • claude-alive autostart plist: skipped (macOS only)`);
    return;
  }
  mkdirSync(`${homedir()}/Library/LaunchAgents`, { recursive: true });
  if (sub === 'enable') {
    writeFileSync(LAUNCHD_FILE, buildClaudeAlivePlist(), 'utf-8');
    // `bootstrap` is the modern launchctl verb. If it fails (e.g. already loaded),
    // try the legacy `load` for older macOS versions.
    const boot = tryRun('launchctl', ['bootstrap', `gui/${uid()}`, LAUNCHD_FILE]);
    if (!boot.ok) tryRun('launchctl', ['load', '-w', LAUNCHD_FILE]);
    console.log(`  ✓ claude-alive autostart plist installed at ${LAUNCHD_FILE}`);
  } else if (sub === 'disable') {
    if (existsSync(LAUNCHD_FILE)) {
      tryRun('launchctl', ['bootout', `gui/${uid()}/${LAUNCHD_LABEL}`]);
      tryRun('launchctl', ['unload', '-w', LAUNCHD_FILE]);
      try { unlinkSync(LAUNCHD_FILE); } catch {}
      console.log(`  ✓ claude-alive autostart plist removed`);
    } else {
      console.log(`  • claude-alive autostart plist not installed`);
    }
  } else {
    const installed = existsSync(LAUNCHD_FILE);
    const loaded = tryRun('launchctl', ['print', `gui/${uid()}/${LAUNCHD_LABEL}`]).ok;
    console.log(`  claude-alive autostart: installed=${installed}, loaded=${loaded}`);
  }
}

const command = process.argv[2];

switch (command) {
  case 'install': {
    console.log('Installing claude-alive hooks...');
    const result = installHooks();
    console.log(`  ✓ hook script: ${result.hookScriptPath}`);
    console.log(`  ✓ settings:    ${result.settingsPath}`);

    console.log('\nSetting up think-prompt (agent + worker in background)...');
    const probe = runThinkPrompt(['--help']);
    if (!probe.ok && /not found|ENOENT/.test(probe.stderr)) {
      console.warn(
        '  ⚠ think-prompt binary not found — Prompt tab will be inactive.\n' +
        '    Install with: npm i -g think-prompt && think-prompt install --no-dashboard',
      );
    } else {
      // `--no-dashboard` is supported from think-prompt 0.6.0+. Older releases
      // (0.3.0 on npm) don't know the flag, so we fall back to the plain
      // install — the Prompt tab still works because both modes serve the
      // same agent JSON API. The extra dashboard daemon on :47824 is benign.
      const embed = runThinkPrompt(['install', '--no-dashboard']);
      if (embed.ok) {
        console.log('  ✓ think-prompt installed in embed mode (no dashboard daemon)');
      } else if (/unknown option|invalid flag|unrecognized/i.test(embed.stderr + embed.stdout)) {
        const standalone = runThinkPrompt(['install']);
        if (standalone.ok) {
          console.log('  ✓ think-prompt installed (older version — dashboard also running on :47824)');
        } else {
          console.warn('  ⚠ think-prompt install failed:\n' + (standalone.stderr || standalone.stdout));
        }
      } else {
        console.warn('  ⚠ think-prompt install reported errors:\n' + (embed.stderr || embed.stdout));
      }
    }

    console.log('\nDone! Claude Code will now stream events to claude-alive + think-prompt.');
    console.log(`Run "claude-alive start" to launch the dashboard on :3141.`);
    break;
  }

  case 'uninstall': {
    console.log('Removing claude-alive hooks...');
    uninstallHooks();
    console.log('  ✓ hooks removed from settings.json');

    console.log('\nStopping think-prompt daemons...');
    const tp = runThinkPrompt(['uninstall']);
    if (tp.ok) {
      console.log('  ✓ think-prompt uninstalled (data preserved — use `think-prompt uninstall --purge` for full removal)');
    } else if (/not found|ENOENT/.test(tp.stderr)) {
      console.log('  • think-prompt not installed, skipping');
    } else {
      console.warn('  ⚠ think-prompt uninstall reported errors:\n' + tp.stderr);
    }

    // Best-effort cleanup of our own autostart plist if it exists.
    if (process.platform === 'darwin' && existsSync(LAUNCHD_FILE)) {
      claudeAliveAutostart('disable');
    }
    console.log('\nDone.');
    break;
  }

  case 'start': {
    const existingPid = readPid();
    if (existingPid) {
      console.log(`claude-alive server is already running (PID: ${existingPid}).`);
    } else {
      mkdirSync(ALIVE_DIR, { recursive: true });
      const logFd = openSync(LOG_FILE, 'a');
      const child = spawn('node', [serverEntryPath()], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
      });
      writeFileSync(PID_FILE, String(child.pid));
      child.unref();

      const port = process.env.CLAUDE_ALIVE_PORT ?? '3141';
      console.log(`claude-alive server started in background (PID: ${child.pid}).`);
      console.log(`  Dashboard: http://localhost:${port}`);
      console.log(`  Logs:      ${LOG_FILE}`);
    }

    // Also (re)start think-prompt's agent + worker so the Prompt tab has fresh data.
    // No-op if already running. Failure is non-fatal — the Prompt tab degrades to empty.
    const tp = runThinkPrompt(['start']);
    if (tp.ok) {
      console.log('  ✓ think-prompt agent + worker ensured running');
    } else if (/not found|ENOENT/.test(tp.stderr)) {
      console.log('  • think-prompt not installed — Prompt tab will be inactive');
    } else {
      console.warn('  ⚠ think-prompt start reported errors:\n' + tp.stderr);
    }
    break;
  }

  case 'stop': {
    const pid = readPid();
    if (!pid) {
      console.log('claude-alive server is not running.');
    } else {
      process.kill(pid, 'SIGINT');
      try { unlinkSync(PID_FILE); } catch {}
      console.log(`claude-alive server stopped (PID: ${pid}).`);
    }

    const tp = runThinkPrompt(['stop']);
    if (tp.ok) {
      console.log('  ✓ think-prompt agent + worker stopped');
    } else if (!/not found|ENOENT/.test(tp.stderr)) {
      console.warn('  ⚠ think-prompt stop reported errors:\n' + tp.stderr);
    }
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
    const tp = runThinkPrompt(['status']);
    console.log(JSON.stringify({
      'claude-alive': { pid, ...((aliveStatus as Record<string, unknown>) ?? {}) },
      'think-prompt': tp.ok ? tp.stdout.trim() : (tp.stderr.trim() || 'not installed'),
    }, null, 2));
    break;
  }

  case 'autostart': {
    const sub = process.argv[3] ?? 'status';
    if (!['enable', 'disable', 'status'].includes(sub)) {
      console.error(`Unknown autostart subcommand "${sub}". Use enable|disable|status.`);
      process.exit(1);
    }
    const action = sub as 'enable' | 'disable' | 'status';

    // 1. Manage think-prompt's daemons via its own autostart implementation.
    console.log(`think-prompt autostart ${action}:`);
    const tp = runThinkPrompt(['autostart', action]);
    process.stdout.write(tp.stdout);
    if (!tp.ok) process.stderr.write(tp.stderr);

    // 2. Manage our own dashboard server plist on macOS.
    console.log(`\nclaude-alive server autostart ${action}:`);
    claudeAliveAutostart(action);

    if (!tp.ok) process.exit(1);
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
claude-alive — Real-time animated UI for Claude Code + prompt quality coach (via think-prompt)

Usage:
  claude-alive install      Install hooks + think-prompt agent/worker
  claude-alive uninstall    Remove hooks + stop think-prompt daemons (data preserved)
  claude-alive start        Start the dashboard server (:3141) + think-prompt daemons
  claude-alive stop         Stop everything (data preserved)
  claude-alive status       Show status of both surfaces
  claude-alive autostart    enable|disable|status — OS-level autostart for both surfaces
  claude-alive logs         Show recent server logs
`);
  }
}
