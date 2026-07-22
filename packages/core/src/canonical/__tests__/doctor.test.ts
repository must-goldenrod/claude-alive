import { describe, expect, test } from 'vitest';
import {
  DEFAULT_RUNTIME_PROBES,
  runDoctor,
  formatDoctorReport,
  extractVersion,
  type CommandRunner,
  type RuntimeProbe,
} from '../doctor.js';

const NOW = 1_700_000_000_000;

const PROBES: RuntimeProbe[] = [
  { provider: 'claude', command: 'claude', versionArgs: ['--version'], adapterStatus: 'planned' },
  { provider: 'codex', command: 'codex', versionArgs: ['--version'], adapterStatus: 'planned' },
];

function runnerFor(
  map: Record<string, { ok: boolean; stdout?: string; error?: string; code?: string }>,
): CommandRunner {
  return async (command) => {
    const r = map[command];
    if (!r) return { ok: false, stdout: '', error: 'not found', code: 'ENOENT' };
    if (r.error !== undefined && !r.ok) return { ok: false, stdout: '', error: r.error, code: r.code };
    return { ok: r.ok, stdout: r.stdout ?? '' };
  };
}

describe('extractVersion', () => {
  test('pulls a semver out of noisy output', () => {
    expect(extractVersion('claude version 1.2.3 (build abc)')).toBe('1.2.3');
    expect(extractVersion('codex-cli 0.11.0')).toBe('0.11.0');
    expect(extractVersion('v2.0.0-beta.1\n')).toBe('2.0.0-beta.1');
  });

  test('returns undefined when there is no version-like token', () => {
    expect(extractVersion('command not found')).toBeUndefined();
    expect(extractVersion('')).toBeUndefined();
  });

  test('prefers a v-prefixed version over an earlier build date', () => {
    expect(extractVersion('Codex CLI 2026.07.07 (v1.4.2)')).toBe('1.4.2');
  });

  test('does not mistake a dotted-quad IP for a version', () => {
    expect(extractVersion('reachable at 192.168.1.1 - claude 1.2.3')).toBe('1.2.3');
  });

  test('skips a leading date-like token when no v-prefixed version exists', () => {
    expect(extractVersion('build 2026.07.07 tool 3.1.0')).toBe('3.1.0');
  });

  test('still handles the real Hermes banner', () => {
    expect(extractVersion('Hermes Agent v0.18.2 (2026.7.7.2)')).toBe('0.18.2');
  });

  test('picks the agent version, not an unrelated version further down the banner', () => {
    // Verbatim `hermes --version` output: the Python and SDK versions must not win.
    const real = [
      'Hermes Agent v0.18.2 (2026.7.7.2) · upstream 26480e6c',
      'Install directory: /Users/x/.hermes/hermes-agent',
      'Install method: git',
      'Python: 3.11.15',
      'OpenAI SDK: 2.24.0',
    ].join('\n');
    expect(extractVersion(real)).toBe('0.18.2');
  });
});

describe('runDoctor', () => {
  test('reports an installed runtime with its version', async () => {
    const report = await runDoctor(PROBES, runnerFor({ claude: { ok: true, stdout: 'claude 1.2.3' } }), NOW);
    const claude = report.runtimes.find((r) => r.provider === 'claude')!;
    expect(claude.installed).toBe(true);
    expect(claude.version).toBe('1.2.3');
  });

  test('reports a missing runtime as not installed with a detail', async () => {
    const report = await runDoctor(PROBES, runnerFor({ claude: { ok: true, stdout: 'claude 1.2.3' } }), NOW);
    const codex = report.runtimes.find((r) => r.provider === 'codex')!;
    expect(codex.installed).toBe(false);
    expect(codex.version).toBeUndefined();
    expect(codex.detail).toBeTruthy();
  });

  test('a runner that throws is reported as not installed, not a crash', async () => {
    const throwing: CommandRunner = async () => {
      throw new Error('spawn EACCES');
    };
    const report = await runDoctor(PROBES, throwing, NOW);
    expect(report.runtimes.every((r) => r.installed === false)).toBe(true);
    expect(report.runtimes[0].detail).toContain('EACCES');
  });

  test('summarises how many of the probed runtimes are installed', async () => {
    const report = await runDoctor(PROBES, runnerFor({ claude: { ok: true, stdout: '1.0.0' } }), NOW);
    expect(report.summary).toEqual({ installed: 1, total: 2 });
    expect(report.generatedAt).toBe(NOW);
  });

  test('carries adapter status so unimplemented adapters are not overclaimed', async () => {
    const report = await runDoctor(PROBES, runnerFor({ claude: { ok: true, stdout: '1.0.0' } }), NOW);
    expect(report.runtimes.every((r) => r.adapterStatus === 'planned')).toBe(true);
    expect(report.runtimes[0].capabilities).toBeUndefined();
  });
});

describe('formatDoctorReport', () => {
  test('renders installed and missing runtimes distinctly', async () => {
    const report = await runDoctor(PROBES, runnerFor({ claude: { ok: true, stdout: 'claude 1.2.3' } }), NOW);
    const text = formatDoctorReport(report);
    expect(text).toContain('claude');
    expect(text).toContain('1.2.3');
    expect(text).toContain('codex');
    expect(text).toMatch(/not installed/i);
  });

  test('marks planned adapters explicitly rather than implying support', async () => {
    const report = await runDoctor(PROBES, runnerFor({ claude: { ok: true, stdout: '1.0.0' } }), NOW);
    expect(formatDoctorReport(report)).toMatch(/adapter: planned/i);
  });
});

describe('DEFAULT_RUNTIME_PROBES', () => {
  test('covers the three target providers', () => {
    expect(DEFAULT_RUNTIME_PROBES.map((p) => p.provider)).toEqual(['claude', 'codex', 'hermes']);
  });

  test('marks codex as implemented and the untouched providers as planned', () => {
    const byProvider = Object.fromEntries(DEFAULT_RUNTIME_PROBES.map((p) => [p.provider, p.adapterStatus]));
    expect(byProvider).toEqual({ claude: 'planned', codex: 'implemented', hermes: 'planned' });
  });

  test('every probe carries an identity pattern so name collisions are rejected', () => {
    expect(DEFAULT_RUNTIME_PROBES.every((p) => p.identityPattern instanceof RegExp)).toBe(true);
  });

  test('the hermes probe distinguishes Hermes Agent from the Hermes JS engine', () => {
    const hermes = DEFAULT_RUNTIME_PROBES.find((p) => p.provider === 'hermes')!;
    // Real Hermes Agent banner
    expect(hermes.identityPattern!.test('Hermes Agent v0.18.2 (2026.7.7.2)')).toBe(true);
    // React Native's Hermes JavaScript engine — a different tool with the same binary name
    expect(hermes.identityPattern!.test('Hermes 0.12.0\nHermes JavaScript engine')).toBe(false);
  });

  test('the claude probe requires the Claude Code banner, not a bare name match', () => {
    const claude = DEFAULT_RUNTIME_PROBES.find((p) => p.provider === 'claude')!;
    expect(claude.identityPattern!.test('2.1.215 (Claude Code)')).toBe(true);
    // Third-party wrapper that merely has "claude" in its name
    expect(claude.identityPattern!.test('claude-code-router 1.0.0')).toBe(false);
  });

  test('the codex probe requires a whole-word match', () => {
    const codex = DEFAULT_RUNTIME_PROBES.find((p) => p.provider === 'codex')!;
    expect(codex.identityPattern!.test('codex-cli 0.11.0')).toBe(true);
    expect(codex.identityPattern!.test('supercodexer 1.0.0')).toBe(false);
  });
});

describe('probe status', () => {
  test('a missing binary (ENOENT) is reported as not-found', async () => {
    const report = await runDoctor(PROBES, runnerFor({}), NOW);
    expect(report.runtimes[0].status).toBe('not-found');
  });

  test('a probe timeout is distinguished from a missing binary', async () => {
    const report = await runDoctor(
      PROBES,
      runnerFor({ claude: { ok: false, error: 'Command failed: timeout', code: 'ETIMEDOUT' } }),
      NOW,
    );
    const claude = report.runtimes.find((r) => r.provider === 'claude')!;
    expect(claude.status).toBe('probe-failed');
    expect(claude.installed).toBe(false);
  });

  test('an identity mismatch has its own status', async () => {
    const probes: RuntimeProbe[] = [
      { provider: 'hermes', command: 'hermes', versionArgs: ['-v'], adapterStatus: 'planned', identityPattern: /hermes\s+agent/i },
    ];
    const report = await runDoctor(probes, runnerFor({ hermes: { ok: true, stdout: 'Hermes 0.12.0 JS engine' } }), NOW);
    expect(report.runtimes[0].status).toBe('identity-mismatch');
  });

  test('a healthy runtime is reported as installed', async () => {
    const report = await runDoctor(PROBES, runnerFor({ claude: { ok: true, stdout: 'claude 1.2.3' } }), NOW);
    expect(report.runtimes.find((r) => r.provider === 'claude')!.status).toBe('installed');
  });
});

describe('probe execution', () => {
  test('preserves probe order even when probes resolve out of order', async () => {
    const slowFirst: CommandRunner = async (command) => {
      if (command === 'claude') await new Promise((r) => setTimeout(r, 20));
      return { ok: true, stdout: `${command} 1.0.0` };
    };
    const report = await runDoctor(PROBES, slowFirst, NOW);
    expect(report.runtimes.map((r) => r.provider)).toEqual(['claude', 'codex']);
  });
});

describe('identity verification', () => {
  const probes: RuntimeProbe[] = [
    {
      provider: 'hermes',
      command: 'hermes',
      versionArgs: ['--version'],
      adapterStatus: 'planned',
      identityPattern: /hermes\s+agent/i,
    },
  ];

  test('a binary whose output does not match the identity is not counted as installed', async () => {
    const report = await runDoctor(probes, runnerFor({ hermes: { ok: true, stdout: 'Hermes 0.12.0 JS engine' } }), NOW);
    const hermes = report.runtimes[0];
    expect(hermes.installed).toBe(false);
    expect(hermes.detail).toMatch(/different tool|did not match/i);
    expect(report.summary.installed).toBe(0);
  });

  test('a binary matching the identity is counted as installed', async () => {
    const report = await runDoctor(probes, runnerFor({ hermes: { ok: true, stdout: 'Hermes Agent v0.18.2' } }), NOW);
    expect(report.runtimes[0].installed).toBe(true);
    expect(report.runtimes[0].version).toBe('0.18.2');
  });
});
