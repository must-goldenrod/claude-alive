import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createEfficioReader } from '../efficioReader.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createDatabase(): string {
  const directory = mkdtempSync(join(tmpdir(), 'claude-alive-efficio-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'efficio.db');
  const database = new BetterSqlite3(path);
  database.exec(`
    CREATE TABLE reference_model (id INTEGER PRIMARY KEY, n INTEGER NOT NULL);
    CREATE TABLE work_units (
      session_id TEXT PRIMARY KEY,
      ai_title TEXT,
      project TEXT,
      ts_first INTEGER NOT NULL,
      turns INTEGER NOT NULL,
      total_tokens INTEGER NOT NULL,
      cache_creation INTEGER,
      cache_read INTEGER,
      top_bash TEXT,
      top_edits TEXT
    );
    CREATE TABLE scores (
      session_id TEXT NOT NULL,
      model_version INTEGER NOT NULL,
      axis TEXT NOT NULL,
      actual REAL,
      baseline REAL,
      residual REAL,
      waste_percentile REAL,
      is_zero INTEGER,
      scored_at INTEGER
    );
    INSERT INTO reference_model (id, n) VALUES (1, 1);
  `);

  const insertUnit = database.prepare(`
    INSERT INTO work_units (
      session_id, ai_title, project, ts_first, turns, total_tokens,
      cache_creation, cache_read, top_bash, top_edits
    ) VALUES (?, ?, ?, ?, 1, 10, 0, 0, '[]', '[]')
  `);
  const insertScore = database.prepare(`
    INSERT INTO scores (
      session_id, model_version, axis, actual, baseline, residual,
      waste_percentile, is_zero, scored_at
    ) VALUES (?, 1, ?, 1, 1, 0, 50, 0, 1)
  `);
  const axes = ['w2', 'wc', 'bash', 'w3'];
  const insertSession = database.transaction(
    (sessionId: string, timestamp: number, title: string) => {
      insertUnit.run(sessionId, title, 'project', timestamp);
      for (const axis of axes) {
        insertScore.run(sessionId, axis);
      }
    },
  );

  insertSession('historical/session', 0, 'Historical target');
  for (let index = 1; index <= 205; index += 1) {
    insertSession(`recent-${index}`, index, `Recent ${index}`);
  }
  database.close();
  return path;
}

describe('EfficioReader exact session profiles', () => {
  it('finds a historical session outside the capped latest profiles', () => {
    const reader = createEfficioReader(createDatabase());

    expect(
      reader.profiles(200).sessions.some(
        (session) => session.sessionId === 'historical/session',
      ),
    ).toBe(false);

    const exact = reader.profile('historical/session');
    expect(exact.sessions).toHaveLength(1);
    expect(exact.sessions[0]?.title).toBe('Historical target');
  });

  it('returns an empty profile envelope for an unknown exact session', () => {
    const reader = createEfficioReader(createDatabase());

    expect(reader.profile('missing')).toEqual({
      modelVersion: 1,
      sessions: [],
    });
  });
});
