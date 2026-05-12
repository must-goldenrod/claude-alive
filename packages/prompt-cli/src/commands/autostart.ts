/**
 * Autostart helper — register OS-level auto-start so the 2 background
 * daemons (agent, worker) survive reboots and respawn on crash. After
 * D-048 (think-prompt absorbed into claude-alive) the dashboard role
 * is gone; the React Prompt tab inside claude-alive's UI replaces it.
 *
 *   macOS  → ~/Library/LaunchAgents/com.thinkprompt.<role>.plist (launchd)
 *   Linux  → ~/.config/systemd/user/think-prompt-<role>.service (systemd --user)
 *
 * Sub-commands:
 *   enable   write unit files + load
 *   disable  unload + remove unit files (preserves data + hooks)
 *   status   show installed/active per role
 *
 * Design note: this is OPT-IN. `think-prompt install` does NOT auto-enable
 * autostart — explicit consent (D-028 fail-open spirit + D-004 local-first).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import pc from 'picocolors';
import { type Role, resolveEntry } from '../daemon.js';

const ROLES: Role[] = ['agent', 'worker'];

type Platform = 'darwin' | 'linux';

function detectPlatform(): Platform {
  if (process.platform === 'darwin') return 'darwin';
  if (process.platform === 'linux') return 'linux';
  throw new Error(`autostart: unsupported platform "${process.platform}" (macOS/Linux only)`);
}

function unitDir(p: Platform): string {
  return p === 'darwin' ? `${homedir()}/Library/LaunchAgents` : `${homedir()}/.config/systemd/user`;
}

function unitFileName(p: Platform, role: Role): string {
  return p === 'darwin' ? `com.thinkprompt.${role}.plist` : `think-prompt-${role}.service`;
}

function unitPath(p: Platform, role: Role): string {
  return `${unitDir(p)}/${unitFileName(p, role)}`;
}

function uid(): string {
  return execFileSync('id', ['-u']).toString().trim();
}

function tryRun(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch {
    return '';
  }
}

/* ────────────────────────────────────────────────────────────────────────── *
 * POLICY — decisions finalized in docs/00-decision-log.md D-031.
 *
 *   1. Start on login             — YES (RunAtLoad true / WantedBy=default.target)
 *   2. Respawn policy             — CRASH-ONLY (respect explicit stop / exit 0)
 *                                   launchd: KeepAlive.SuccessfulExit=false
 *                                   systemd: Restart=on-failure
 *   3. Back-off between restarts  — 10 seconds (ThrottleInterval / RestartSec)
 *   4. Log destination            — combined stdout+stderr into
 *                                   <root>/autostart-<role>.log (append)
 *   5. Working directory + env    — cwd=<root>, minimal PATH for node binary
 *                                   discovery, NODE_ENV=production
 *
 * Rationale: aligns with D-028 (fail-open) — if a daemon dies unexpectedly
 * we revive it, but we never override a user's explicit stop.
 * ────────────────────────────────────────────────────────────────────────── */

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildLaunchdPlist(
  role: Role,
  nodePath: string,
  entry: string,
  root: string
): string {
  const logFile = `${root}/autostart-${role}.log`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.thinkprompt.${role}</string>
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
  <string>${xmlEscape(root)}</string>
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

export function buildSystemdUnit(
  role: Role,
  nodePath: string,
  entry: string,
  root: string
): string {
  const logFile = `${root}/autostart-${role}.log`;
  return `[Unit]
Description=think-prompt ${role} daemon
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${entry}
WorkingDirectory=${root}
Restart=on-failure
RestartSec=10
StandardOutput=append:${logFile}
StandardError=append:${logFile}
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;
}

/* ────────────────────────────────────────────────────────────────────────── */

function buildContent(p: Platform, role: Role): string {
  const nodePath = process.execPath;
  const entry = resolveEntry(role);
  const root = `${homedir()}/.think-prompt`;
  return p === 'darwin'
    ? buildLaunchdPlist(role, nodePath, entry, root)
    : buildSystemdUnit(role, nodePath, entry, root);
}

function loadUnit(p: Platform, file: string, role: Role): void {
  if (p === 'darwin') {
    execFileSync('launchctl', ['bootstrap', `gui/${uid()}`, file], { stdio: 'inherit' });
  } else {
    execFileSync('systemctl', ['--user', 'enable', '--now', `think-prompt-${role}.service`], {
      stdio: 'inherit',
    });
  }
}

function unloadUnit(p: Platform, file: string, role: Role): void {
  if (p === 'darwin') {
    try {
      execFileSync('launchctl', ['bootout', `gui/${uid()}`, file], { stdio: 'inherit' });
    } catch {
      // already unloaded
    }
  } else {
    try {
      execFileSync('systemctl', ['--user', 'disable', '--now', `think-prompt-${role}.service`], {
        stdio: 'inherit',
      });
    } catch {
      // already disabled
    }
  }
}

function isActive(p: Platform, role: Role): boolean {
  if (p === 'darwin') {
    const out = tryRun('launchctl', ['list']);
    const line = out.split('\n').find((l) => l.includes(`com.thinkprompt.${role}`));
    if (!line) return false;
    const pid = line.split(/\s+/)[0];
    return /^\d+$/.test(pid ?? '') && pid !== '0';
  }
  const out = tryRun('systemctl', ['--user', 'is-active', `think-prompt-${role}.service`]).trim();
  return out === 'active';
}

export function autostartEnableCmd(): void {
  const p = detectPlatform();
  mkdirSync(unitDir(p), { recursive: true });
  console.log(pc.bold(`autostart enable (${p})`));
  for (const role of ROLES) {
    const file = unitPath(p, role);
    writeFileSync(file, buildContent(p, role), 'utf8');
    loadUnit(p, file, role);
    console.log(`${pc.green('✓')} ${role.padEnd(10)} ${file}`);
  }
  console.log(pc.dim('\nVerify: think-prompt autostart status'));
}

export function autostartDisableCmd(): void {
  const p = detectPlatform();
  console.log(pc.bold(`autostart disable (${p})`));
  for (const role of ROLES) {
    const file = unitPath(p, role);
    if (!existsSync(file)) {
      console.log(`${pc.dim('—')} ${role.padEnd(10)} not installed`);
      continue;
    }
    unloadUnit(p, file, role);
    unlinkSync(file);
    console.log(`${pc.green('✓')} ${role.padEnd(10)} unloaded & removed`);
  }
}

export function autostartStatusCmd(): void {
  const p = detectPlatform();
  console.log(pc.bold(`autostart status (${p})`));
  for (const role of ROLES) {
    const file = unitPath(p, role);
    const installed = existsSync(file);
    const active = installed && isActive(p, role);
    const mark = !installed ? pc.dim('—') : active ? pc.green('✓') : pc.yellow('•');
    const state = !installed
      ? 'not installed'
      : active
        ? 'installed / running'
        : 'installed / inactive';
    console.log(`${mark} ${role.padEnd(10)} ${state}`);
    if (installed) console.log(`  ${pc.dim(file)}`);
  }
}
