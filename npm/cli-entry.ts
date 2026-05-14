#!/usr/bin/env node

import { installHooks, uninstallHooks } from '../packages/hooks/src/install.js';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, openSync } from 'node:fs';
import { homedir } from 'node:os';

const ALIVE_DIR = join(homedir(), '.claude-alive');
const PID_FILE = join(ALIVE_DIR, 'server.pid');
const LOG_FILE = join(ALIVE_DIR, 'server.log');

function readPid(): number | null {
  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
    process.kill(pid, 0);
    return pid;
  } catch {
    try { unlinkSync(PID_FILE); } catch {}
    return null;
  }
}

const command = process.argv[2];
const args = process.argv.slice(3);

/**
 * Open `url` in the user's default browser. Best-effort: errors are swallowed
 * because failing to launch the browser shouldn't crash `start` — the user
 * still has the URL printed in the console as a fallback.
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
    console.log(`  Hook script: ${result.hookScriptPath}`);
    console.log(`  Settings:    ${result.settingsPath}`);
    console.log('Done! Claude Code will now stream events to claude-alive.');
    break;
  }

  case 'uninstall': {
    console.log('Removing claude-alive hooks...');
    uninstallHooks();
    console.log('Done! Hooks removed from settings.json.');
    break;
  }

  case 'start': {
    // `--no-open` skips auto-launching the browser. Default is to open: most
    // users only run `claude-alive start` to see the dashboard, so requiring
    // an extra copy-paste step is friction. Matches `vite`, `next dev`, etc.
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
    const bundleDir = dirname(fileURLToPath(import.meta.url));
    const serverEntry = resolve(bundleDir, 'server.js');
    const logFd = openSync(LOG_FILE, 'a');
    const child = spawn('node', [serverEntry], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });
    writeFileSync(PID_FILE, String(child.pid));
    child.unref();

    console.log(`claude-alive server started in background (PID: ${child.pid}).`);
    console.log(`  Dashboard: ${url}`);
    console.log(`  Logs:      ${LOG_FILE}`);

    if (!noOpen) {
      // Wait ~800ms for the server to bind :3141 before opening the browser,
      // otherwise the user lands on "site can't be reached" and has to refresh.
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
    try {
      const res = await fetch(`http://localhost:${port}/api/status`);
      const data = await res.json();
      if (pid) console.log(`Server running (PID: ${pid})`);
      console.log(JSON.stringify(data, null, 2));
    } catch {
      console.log('claude-alive server is not running.');
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
claude-alive — Real-time animated UI for Claude Code

Usage:
  claude-alive install     Install hooks into ~/.claude/settings.json
  claude-alive uninstall   Remove hooks from settings.json
  claude-alive start       Start the server (:3141) and open the dashboard
                           (pass --no-open to skip browser launch)
  claude-alive stop        Stop the background server
  claude-alive status      Check if server is running
  claude-alive logs        Show recent server logs
`);
  }
}
