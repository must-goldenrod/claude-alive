import { describe, it, expect } from 'vitest';
import { parseEnvFile, loadServerEnv } from '../serverEnv.js';

describe('parseEnvFile', () => {
  it('reads KEY=VALUE pairs and skips comments and blanks', () => {
    const out = parseEnvFile('# comment\n\nLITELLM_KEY=sk-abc\nCA_DELEGATE_MODEL=glm-5.2\n');
    expect(out).toEqual({ LITELLM_KEY: 'sk-abc', CA_DELEGATE_MODEL: 'glm-5.2' });
  });

  it('tolerates `export ` and strips one layer of matching quotes', () => {
    const out = parseEnvFile('export LITELLM_BASE_URL="https://litellm.must.codes"\nNOTE=\'two words\'\n');
    expect(out).toEqual({ LITELLM_BASE_URL: 'https://litellm.must.codes', NOTE: 'two words' });
  });

  it('keeps `=` inside the value', () => {
    expect(parseEnvFile('K=a=b')).toEqual({ K: 'a=b' });
  });

  it('ignores malformed lines instead of throwing', () => {
    expect(parseEnvFile('novalue\n=orphan\n1BAD=x\nOK=1')).toEqual({ OK: '1' });
  });
});

describe('loadServerEnv', () => {
  it('applies file values that are missing from the env', () => {
    const env: NodeJS.ProcessEnv = {};
    const applied = loadServerEnv('/x/.env', { read: () => 'LITELLM_KEY=sk-file', env });
    expect(env.LITELLM_KEY).toBe('sk-file');
    expect(applied).toEqual(['LITELLM_KEY']);
  });

  // An explicit `LITELLM_KEY=… claude-alive start` must beat the file, so a
  // one-off override never needs the file edited first.
  it('never overwrites a value already set in the env', () => {
    const env: NodeJS.ProcessEnv = { LITELLM_KEY: 'sk-shell' };
    const applied = loadServerEnv('/x/.env', { read: () => 'LITELLM_KEY=sk-file', env });
    expect(env.LITELLM_KEY).toBe('sk-shell');
    expect(applied).toEqual([]);
  });

  it('treats an empty existing value as unset', () => {
    const env: NodeJS.ProcessEnv = { LITELLM_KEY: '' };
    loadServerEnv('/x/.env', { read: () => 'LITELLM_KEY=sk-file', env });
    expect(env.LITELLM_KEY).toBe('sk-file');
  });

  it('is a no-op when the file does not exist', () => {
    const env: NodeJS.ProcessEnv = {};
    const applied = loadServerEnv('/nope/.env', {
      read: () => { throw new Error('ENOENT'); },
      env,
    });
    expect(applied).toEqual([]);
    expect(env).toEqual({});
  });
});
