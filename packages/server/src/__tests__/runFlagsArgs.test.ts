import { describe, it, expect } from 'vitest';
import { buildHeadlessArgs } from '../headlessClaude.js';
import { buildRemoteCommand, shellQuote } from '../executors/sshExecutor.js';

describe('buildHeadlessArgs run flags', () => {
  it('is unchanged when no flags are given', () => {
    expect(buildHeadlessArgs('goal', 'bypassPermissions')).toEqual([
      '-p', 'goal', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'bypassPermissions',
    ]);
  });

  it('appends --model and --effort as separate argv entries', () => {
    const args = buildHeadlessArgs('goal', 'bypassPermissions', undefined, { model: 'opus', effort: 'max' });
    expect(args.slice(-4)).toEqual(['--model', 'opus', '--effort', 'max']);
  });

  it('appends only the flag that is set', () => {
    expect(buildHeadlessArgs('g', 'default', undefined, { effort: 'low' })).toContain('--effort');
    expect(buildHeadlessArgs('g', 'default', undefined, { effort: 'low' })).not.toContain('--model');
  });

  it('keeps --resume alongside run flags', () => {
    const args = buildHeadlessArgs('g', 'default', 'sess-1', { model: 'sonnet' });
    expect(args).toContain('--resume');
    expect(args[args.indexOf('--resume') + 1]).toBe('sess-1');
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet');
  });
});

describe('buildRemoteCommand run flags', () => {
  it('is unchanged when no flags are given', () => {
    const cmd = buildRemoteCommand('/srv/app', 'bypassPermissions');
    expect(cmd).not.toContain('--model');
    expect(cmd).not.toContain('--effort');
  });

  it('shell-quotes flag values for the remote shell', () => {
    const cmd = buildRemoteCommand('/srv/app', 'bypassPermissions', undefined, { model: 'opus', effort: 'max' });
    expect(cmd).toContain("--model 'opus'");
    expect(cmd).toContain("--effort 'max'");
  });

  it('neutralises a quote-injection attempt in a flag value', () => {
    const evil = "opus'; rm -rf /; #";
    const cmd = buildRemoteCommand('/srv/app', 'default', undefined, { model: evil });
    // The payload stays inside one shell-quoted token: the embedded quote is
    // escaped as '\'' rather than closing the string and starting a new command.
    expect(cmd).toContain(`--model ${shellQuote(evil)}`);
    expect(cmd).not.toContain("--model opus'; rm");
  });
});
