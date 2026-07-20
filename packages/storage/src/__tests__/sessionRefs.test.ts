import { beforeEach, describe, expect, test } from 'vitest';
import { openDatabase } from '../db.js';
import { runMigrations } from '../migrator.js';
import { SessionRefStore } from '../sessionRefs.js';

let refs: SessionRefStore;
let minted: number;

beforeEach(() => {
  const db = openDatabase(':memory:');
  runMigrations(db);
  minted = 0;
  refs = new SessionRefStore(db, () => `ULID${++minted}`);
});

describe('resolve', () => {
  test('mints a stable Alive id the first time a provider session is seen', () => {
    const id = refs.resolve('claude', 'claude-abc');
    expect(id).toBe('ULID1');
    expect(refs.count()).toBe(1);
  });

  test('returns the same Alive id for the same provider session', () => {
    const first = refs.resolve('claude', 'claude-abc');
    const second = refs.resolve('claude', 'claude-abc');
    expect(second).toBe(first);
    expect(refs.count()).toBe(1);
  });

  test('the same native id under different providers is a different session', () => {
    const a = refs.resolve('claude', 'shared-id');
    const b = refs.resolve('codex', 'shared-id');
    expect(a).not.toBe(b);
    expect(refs.count()).toBe(2);
  });

  test('distinct provider sessions get distinct ids', () => {
    expect(refs.resolve('claude', 'a')).not.toBe(refs.resolve('claude', 'b'));
  });
});

describe('lookups', () => {
  test('finds the Alive id without minting a new one', () => {
    refs.resolve('claude', 'claude-abc');
    expect(refs.findAliveId('claude', 'claude-abc')).toBe('ULID1');
    expect(refs.count()).toBe(1);
  });

  test('returns undefined for an unknown provider session and mints nothing', () => {
    expect(refs.findAliveId('claude', 'nope')).toBeUndefined();
    expect(refs.count()).toBe(0);
  });

  test('resolves back from the Alive id to the provider reference', () => {
    const id = refs.resolve('codex', 'thread-77');
    expect(refs.findProviderRef(id)).toEqual({ provider: 'codex', providerSessionId: 'thread-77' });
  });

  test('returns undefined when the Alive id is unknown', () => {
    expect(refs.findProviderRef('ULID-nope')).toBeUndefined();
  });
});

describe('persistence', () => {
  test('mappings survive a new store over the same database', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const first = new SessionRefStore(db, () => 'ULID_X');
    const id = first.resolve('claude', 'claude-abc');

    // A fresh store object over the same connection must see the same mapping
    // and must not mint a second id.
    const second = new SessionRefStore(db, () => 'ULID_SHOULD_NOT_BE_USED');
    expect(second.resolve('claude', 'claude-abc')).toBe(id);
    expect(second.count()).toBe(1);
  });
});
