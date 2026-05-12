/**
 * Daemon lifecycle helpers: spawn detached agent & worker, read/write pidfile,
 * stop by SIGTERM, basic self-healing.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPaths } from '@think-prompt/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Absorbed into claude-alive (D-048): the `dashboard` role is gone — the
 * React-based Prompt tab in claude-alive replaces the eta+Alpine dashboard.
 * Only `agent` (hook ingest + JSON API) and `worker` (transcript parsing,
 * deep analysis, baseline rolls) survive as background daemons.
 */
export type Role = 'agent' | 'worker';

function readPid(path: string): number | null {
  if (!existsSync(path)) return null;
  try {
    const n = Number.parseInt(readFileSync(path, 'utf8').trim(), 10);
    if (Number.isNaN(n)) return null;
    return n;
  } catch {
    return null;
  }
}

export function isRunning(pid: number | null): boolean {
  if (pid == null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function resolveEntry(role: Role): string {
  // Production (bundled): cli/dist/index.js + cli/dist/daemons/<role>.js
  const bundled = join(__dirname, 'daemons', `${role}.js`);
  if (existsSync(bundled)) return bundled;

  // Dev fallback: monorepo workspace path
  const require = createRequire(import.meta.url);
  try {
    return require.resolve(`@think-prompt/${role}`);
  } catch {
    return require.resolve(`../../${role}/dist/index.js`);
  }
}

export interface DaemonStatus {
  role: Role;
  pid: number | null;
  running: boolean;
}

function pidPathFor(role: Role): string {
  const paths = getPaths();
  switch (role) {
    case 'agent':
      return paths.agentPid;
    case 'worker':
      return paths.workerPid;
  }
}

export function status(role: Role): DaemonStatus {
  const pid = readPid(pidPathFor(role));
  return { role, pid, running: isRunning(pid) };
}

export function start(role: Role): DaemonStatus {
  const cur = status(role);
  if (cur.running) return cur;
  // Clean stale pidfile
  const pidPath = pidPathFor(role);
  if (existsSync(pidPath)) {
    try {
      unlinkSync(pidPath);
    } catch {
      // ignore
    }
  }
  const entry = resolveEntry(role);
  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
  // Give it a moment to write its pidfile
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (existsSync(pidPath)) break;
    // busy wait fallback
  }
  return status(role);
}

export function stop(role: Role): DaemonStatus {
  const cur = status(role);
  if (!cur.running || cur.pid == null) return cur;
  try {
    process.kill(cur.pid, 'SIGTERM');
  } catch {
    // ignore
  }
  // Wait for exit
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (!isRunning(cur.pid)) break;
  }
  const pidPath = pidPathFor(role);
  if (existsSync(pidPath)) {
    try {
      unlinkSync(pidPath);
    } catch {
      // ignore
    }
  }
  return status(role);
}

export function restart(role: Role): DaemonStatus {
  stop(role);
  return start(role);
}
