import { describe, it, expect, afterEach } from 'vitest';
import { PtyManager } from '../ptyManager.js';

describe('PtyManager', () => {
  let manager: PtyManager;

  afterEach(() => {
    manager?.destroyAll();
  });

  it('creates a session', () => {
    manager = new PtyManager({ maxSessions: 5 });
    const session = manager.createSession('/tmp');
    expect(session).not.toBeNull();
    expect(session!.id).toBeTruthy();
  });

  it('enforces max sessions limit', () => {
    manager = new PtyManager({ maxSessions: 2 });
    manager.createSession('/tmp');
    manager.createSession('/tmp');
    const third = manager.createSession('/tmp');
    expect(third).toBeNull();
  });

  it('destroys a session', () => {
    manager = new PtyManager({ maxSessions: 5 });
    const session = manager.createSession('/tmp');
    expect(manager.destroySession(session!.id)).toBe(true);
    expect(manager.destroySession(session!.id)).toBe(false);
  });

  it('lists active sessions', () => {
    manager = new PtyManager({ maxSessions: 5 });
    manager.createSession('/tmp');
    manager.createSession('/tmp');
    expect(manager.listSessions().length).toBe(2);
  });

  it('writes input to session', () => {
    manager = new PtyManager({ maxSessions: 5 });
    const session = manager.createSession('/tmp');
    expect(manager.writeInput(session!.id, 'echo hello\n')).toBe(true);
    expect(manager.writeInput('nonexistent', 'data')).toBe(false);
  });

  it('resizes session', () => {
    manager = new PtyManager({ maxSessions: 5 });
    const session = manager.createSession('/tmp');
    expect(manager.resize(session!.id, 120, 40)).toBe(true);
    expect(manager.resize('nonexistent', 80, 24)).toBe(false);
  });
});
