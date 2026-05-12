#!/usr/bin/env node

import { installHooks, uninstallHooks } from '@claude-alive/hooks';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, openSync, existsSync } from 'node:fs';
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

/**
 * Best-effort think-prompt install in embed mode. If `--no-dashboard` is not
 * supported (older think-prompt versions), fall back to the plain `install`
 * which starts dashboard too — that just means the user can also visit
 * :47824 directly. Both modes feed the same DB the claude-alive UI reads.
 */
function thinkPromptInstall(): { ok: boolean; mode: 'embed' | 'standalone' | 'missing'; output: string } {
  const probe = runThinkPrompt(['--help']);
  if (!probe.ok && /not found|ENOENT/.test(probe.stderr)) {
    return { ok: false, mode: 'missing', output: probe.stderr };
  }
  const embed = runThinkPrompt(['install', '--no-dashboard']);
  if (embed.ok) return { ok: true, mode: 'embed', output: embed.stdout };
  const standalone = runThinkPrompt(['install']);
  return { ok: standalone.ok, mode: 'standalone', output: standalone.stdout || standalone.stderr };
}

const command = process.argv[2];

switch (command) {
  case 'install': {
    console.log('Installing claude-alive hooks...');
    const result = installHooks();
    console.log(`  ✓ hook script: ${result.hookScriptPath}`);
    console.log(`  ✓ settings:    ${result.settingsPath}`);

    console.log('\nSetting up think-prompt (agent + worker in background)...');
    const tp = thinkPromptInstall();
    if (tp.mode === 'missing') {
      console.warn(
        '  ⚠ think-prompt binary not found — Prompt tab will be inactive.\n' +
        '    Install with: npm i -g think-prompt && think-prompt install',
      );
    } else if (tp.mode === 'embed') {
      console.log('  ✓ think-prompt installed in embed mode (no dashboard daemon)');
    } else {
      console.log('  ✓ think-prompt installed (with dashboard — older version without --no-dashboard support)');
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
    console.log('\nDone.');
    break;
  }

  case 'start': {
    const existingPid = readPid();
    if (existingPid) {
      console.log(`claude-alive server is already running (PID: ${existingPid}).`);
    } else {
      mkdirSync(ALIVE_DIR, { recursive: true });
      const currentDir = dirname(fileURLToPath(import.meta.url));
      const serverEntry = resolve(currentDir, '..', '..', 'server', 'dist', 'index.js');
      const logFd = openSync(LOG_FILE, 'a');
      const child = spawn('node', [serverEntry], {
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
    // Delegate the OS-level launchd/systemd unit management to think-prompt
    // (its `autostart` implementation already covers agent + worker on both
    // macOS and Linux). claude-alive's own server is intentionally NOT in an
    // autostart unit yet — the WebSocket dashboard is interactive, not a
    // background capture surface like the think-prompt daemons. Users keep
    // launching it with `claude-alive start` when they want the UI.
    const tp = runThinkPrompt(['autostart', sub]);
    process.stdout.write(tp.stdout);
    if (!tp.ok) {
      process.stderr.write(tp.stderr);
      process.exit(1);
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
claude-alive — Real-time animated UI for Claude Code + prompt quality coach (via think-prompt)

Usage:
  claude-alive install      Install hooks + think-prompt agent/worker
  claude-alive uninstall    Remove hooks + stop think-prompt daemons (data preserved)
  claude-alive start        Start the dashboard server (:3141) + think-prompt daemons
  claude-alive stop         Stop everything (data preserved)
  claude-alive status       Show status of both surfaces
  claude-alive autostart    enable|disable|status — OS-level autostart (delegates to think-prompt)
  claude-alive logs         Show recent server logs
`);
  }
}
