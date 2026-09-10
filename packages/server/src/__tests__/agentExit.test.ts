import { describe, it, expect } from 'vitest';
import { describeAgentExit, formatRanFor } from '../agentExit.js';

describe('formatRanFor', () => {
  it('renders seconds, minutes and hours', () => {
    expect(formatRanFor(0)).toBe('0s');
    expect(formatRanFor(4_200)).toBe('4s');
    expect(formatRanFor(123_000)).toBe('2m 3s');
    expect(formatRanFor(465_872)).toBe('7m 45s');
    expect(formatRanFor(3_780_000)).toBe('1h 3m');
  });
  it('is undefined for an unknown duration', () => {
    expect(formatRanFor(undefined)).toBeUndefined();
  });
});

describe('describeAgentExit', () => {
  it('reads 143 as a SIGTERM the agent handled itself', () => {
    // The `claude` binary installs its own SIGTERM handler and exits 143, so the
    // OS-reported signal is null and 143 is the only trace the kill leaves.
    const { exit, summary } = describeAgentExit({
      exitCode: 143,
      signal: null,
      ranMs: 465_872,
      round: 1,
      resumable: true,
    });
    expect(exit.cause).toBe('terminated');
    expect(exit.signal).toBe('SIGTERM');
    expect(exit.signalInferred).toBe(true);
    expect(exit.code).toBe(143);
    expect(exit.resumable).toBe(true);
    expect(exit.ranMs).toBe(465_872);
    expect(summary).toContain('SIGTERM');
    expect(summary).toContain('143');
    expect(summary).toContain('7m 45s');
  });

  it('reads a SIGKILL the OS reported, with no exit code at all', () => {
    // Node reports {code: null, signal: 'SIGKILL'} here. Before this describer
    // that null read as "failed to spawn claude" — the opposite of the truth.
    const { exit, summary } = describeAgentExit({ exitCode: null, signal: 'SIGKILL', ranMs: 123_000 });
    expect(exit.cause).toBe('killed');
    expect(exit.signal).toBe('SIGKILL');
    expect(exit.signalInferred).toBeUndefined();
    expect(exit.code).toBeUndefined();
    expect(summary).toContain('SIGKILL');
    expect(summary).not.toContain('never started');
  });

  it('infers SIGINT and SIGHUP from their 128+n exit codes', () => {
    expect(describeAgentExit({ exitCode: 130 }).exit.cause).toBe('interrupted');
    expect(describeAgentExit({ exitCode: 130 }).exit.signal).toBe('SIGINT');
    expect(describeAgentExit({ exitCode: 129 }).exit.cause).toBe('hangup');
    expect(describeAgentExit({ exitCode: 137 }).exit.cause).toBe('killed');
  });

  it('calls a missing exit status with no signal a failure to start', () => {
    const { exit, summary } = describeAgentExit({ exitCode: null, signal: null, stderr: 'spawn claude ENOENT' });
    expect(exit.cause).toBe('spawn-failed');
    expect(summary).toContain('never started');
    expect(summary).toContain('ENOENT');
    expect(exit.stderr).toBe('spawn claude ENOENT');
  });

  it('keeps both the exit code and stderr for an ordinary non-zero exit', () => {
    // stderr used to replace the whole message, which threw the exit code away.
    const { exit, summary } = describeAgentExit({ exitCode: 1, ranMs: 4_000, stderr: 'boom' });
    expect(exit.cause).toBe('exited');
    expect(summary).toContain('code 1');
    expect(summary).toContain('boom');
  });

  it('reports a clean exit that produced no final result', () => {
    const { exit, summary } = describeAgentExit({ exitCode: 0, ranMs: 3_000, result: null });
    expect(exit.cause).toBe('no-result');
    expect(summary).toContain('no final result');
  });

  it('names the subtype when the agent reported an error result', () => {
    const { exit, summary } = describeAgentExit({
      exitCode: 0,
      ranMs: 3_000,
      result: { result: null, isError: true, subtype: 'error_max_turns' },
    });
    expect(exit.cause).toBe('no-result');
    expect(exit.resultSubtype).toBe('error_max_turns');
    expect(summary).toContain('error_max_turns');
  });

  it('trims stderr to a storable tail', () => {
    const { exit } = describeAgentExit({ exitCode: 1, stderr: 'x'.repeat(5_000) });
    expect(exit.stderr!.length).toBeLessThanOrEqual(600);
  });

  it('never returns a summary longer than one card line', () => {
    const { summary } = describeAgentExit({ exitCode: 1, stderr: 'y'.repeat(5_000) });
    expect(summary.length).toBeLessThanOrEqual(200);
    expect(summary).not.toContain('\n');
  });
});
