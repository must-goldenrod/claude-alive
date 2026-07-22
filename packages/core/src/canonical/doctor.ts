/**
 * Runtime detection and doctor report (spec §P0 skeleton, §L.2 Connection Center).
 *
 * Detection is expressed against an injected `CommandRunner` so this module stays
 * pure and deterministically testable; the CLI and server supply a real
 * child-process runner. The report is shared by `claude-alive doctor` and, later,
 * the Connection Center UI.
 *
 * `adapterStatus` is deliberate: a runtime being installed on the machine says
 * nothing about whether Alive has an adapter for it. Reporting a capability
 * matrix for a provider with no implemented adapter would overclaim support
 * (§D.3), so capabilities are omitted until an adapter actually declares them.
 */

import type { ProviderCapabilities, ProviderId } from './capabilities.js';

export interface CommandResult {
  ok: boolean;
  stdout: string;
  error?: string;
  /** Runner error code (e.g. `ENOENT`), used to tell "missing" from "failed". */
  code?: string;
}

/**
 * Why a probe reached its conclusion. `installed` alone conflates "the binary is
 * absent" with "the probe timed out", which are different user actions.
 */
export type ProbeStatus = 'installed' | 'not-found' | 'identity-mismatch' | 'probe-failed';

export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

export type AdapterStatus = 'implemented' | 'planned';

export interface RuntimeProbe {
  provider: ProviderId;
  command: string;
  versionArgs: string[];
  adapterStatus: AdapterStatus;
  /**
   * Output must match this for the binary to count as the expected runtime.
   * Binary names collide across ecosystems — `hermes` is both the Hermes Agent
   * and React Native's Hermes JavaScript engine — so presence on PATH alone is
   * not evidence that the right tool is installed.
   */
  identityPattern?: RegExp;
  /** Only meaningful once an adapter is implemented and declares them. */
  capabilities?: ProviderCapabilities;
}

export interface RuntimeDiagnostic {
  provider: ProviderId;
  command: string;
  installed: boolean;
  status: ProbeStatus;
  version?: string;
  detail?: string;
  adapterStatus: AdapterStatus;
  capabilities?: ProviderCapabilities;
}

export interface DoctorReport {
  runtimes: RuntimeDiagnostic[];
  generatedAt: number;
  summary: { installed: number; total: number };
}

/**
 * Runtimes Alive targets.
 *
 * `adapterStatus` tracks Alive's side, not the binary's: `implemented` means an
 * adapter exists and passes the conformance suite. It does **not** claim a live
 * smoke test — Codex's adapter is fixture-verified only (ADR-0004 Conditionally
 * Accepted), which is why the report shows adapter status separately from
 * installation.
 */
export const DEFAULT_RUNTIME_PROBES: readonly RuntimeProbe[] = [
  {
    provider: 'claude',
    command: 'claude',
    versionArgs: ['--version'],
    adapterStatus: 'planned',
    // Real banner: "2.1.215 (Claude Code)". Requiring the two-word product name
    // rejects same-named third-party wrappers (e.g. `claude-code-router`).
    identityPattern: /claude\s+code/i,
  },
  {
    provider: 'codex',
    command: 'codex',
    versionArgs: ['--version'],
    adapterStatus: 'implemented',
    identityPattern: /\bcodex\b/i,
  },
  {
    provider: 'hermes',
    command: 'hermes',
    versionArgs: ['--version'],
    // `hermes` is also React Native's JavaScript engine; require the agent banner.
    adapterStatus: 'planned',
    identityPattern: /hermes\s+agent/i,
  },
];

// The word boundary must precede the optional `v` — `(v)?\b` would demand a
// boundary between `v` and the first digit, which never exists, silently losing
// every v-prefixed version.
const VERSION_RE = /\b(v)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/g;

/** Four-digit leading segment in a plain dotted triple reads as a build date. */
function looksLikeDate(version: string): boolean {
  return /^\d{4}\./.test(version);
}

/**
 * Extract a version from CLI output.
 *
 * Taking the leftmost dotted triple is wrong: real banners put build dates and
 * addresses ahead of the version ("Codex CLI 2026.07.07 (v1.4.2)"). Candidates
 * are therefore scored — an explicit `v` prefix wins, otherwise date-like and
 * dotted-quad (IP) tokens are skipped before falling back to the first match.
 */
export function extractVersion(output: string): string | undefined {
  const candidates: { version: string; vPrefixed: boolean; ipLike: boolean }[] = [];
  for (const m of output.matchAll(VERSION_RE)) {
    const end = (m.index ?? 0) + m[0].length;
    candidates.push({
      version: m[2],
      vPrefixed: m[1] === 'v',
      // A following ".<digit>" means this triple is part of a longer numeric run.
      ipLike: /^\.\d/.test(output.slice(end)),
    });
  }
  if (candidates.length === 0) return undefined;

  const explicit = candidates.find((c) => c.vPrefixed && !c.ipLike);
  if (explicit) return explicit.version;

  const plausible = candidates.find((c) => !c.ipLike && !looksLikeDate(c.version));
  return (plausible ?? candidates[0]).version;
}

export async function runDoctor(
  probes: readonly RuntimeProbe[],
  runner: CommandRunner,
  now: number,
): Promise<DoctorReport> {
  // Probes are independent; run them concurrently but keep the declared order.
  const runtimes: RuntimeDiagnostic[] = await Promise.all(
    probes.map(async (probe): Promise<RuntimeDiagnostic> => {
      let result: CommandResult;
      try {
        result = await runner(probe.command, probe.versionArgs);
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        result = { ok: false, stdout: '', error: err?.message ?? String(error), code: err?.code };
      }

      // A binary that runs is not necessarily the runtime we want (name collisions).
      const identityOk = !probe.identityPattern || probe.identityPattern.test(result.stdout);
      const installed = result.ok && identityOk;

      let status: ProbeStatus;
      let detail: string | undefined;
      if (installed) {
        status = 'installed';
      } else if (!result.ok) {
        const missing = result.code === 'ENOENT' || /not found|ENOENT/i.test(result.error ?? '');
        status = missing ? 'not-found' : 'probe-failed';
        detail = result.error ?? `\`${probe.command}\` not found on PATH`;
      } else {
        status = 'identity-mismatch';
        detail = `\`${probe.command}\` exists but its output did not match ${probe.provider} — likely a different tool with the same name`;
      }

      return {
        provider: probe.provider,
        command: probe.command,
        installed,
        status,
        version: installed ? extractVersion(result.stdout) : undefined,
        detail,
        adapterStatus: probe.adapterStatus,
        capabilities: probe.adapterStatus === 'implemented' ? probe.capabilities : undefined,
      };
    }),
  );

  return {
    runtimes,
    generatedAt: now,
    summary: { installed: runtimes.filter((r) => r.installed).length, total: runtimes.length },
  };
}

const STATUS_LABEL: Record<ProbeStatus, string> = {
  'installed': 'installed',
  'not-found': 'not installed',
  'identity-mismatch': 'not installed (name collision)',
  'probe-failed': 'probe failed',
};

export function formatDoctorReport(report: DoctorReport): string {
  const width = Math.max(8, ...report.runtimes.map((r) => r.provider.length));
  const lines: string[] = ['Runtimes:'];
  for (const r of report.runtimes) {
    const label = STATUS_LABEL[r.status];
    const state =
      r.status === 'installed'
        ? `${label}${r.version ? ` (${r.version})` : ''}`
        : `${label} — ${r.detail ?? 'unknown'}`;
    lines.push(`  ${r.provider.padEnd(width)} ${state}  [adapter: ${r.adapterStatus}]`);
  }
  lines.push('', `${report.summary.installed}/${report.summary.total} runtimes detected.`);
  return lines.join('\n');
}
