/**
 * Corpus regression test.
 * Runs every sample in docs/corpora/*.jsonl through the rule engine and
 * compares the resulting rule IDs to rule_hits_expected. Missing or extra
 * firings count as failures. Partial tolerance is permitted in "quality:
 * good" samples where we explicitly accept that no rules should fire.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runRules } from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CORPUS_DIR = join(__dirname, '..', '..', '..', 'docs', 'corpora');

interface CorpusRow {
  id: string;
  prompt: string;
  labels: Record<string, boolean>;
  rule_hits_expected: string[];
  language: string;
  source: string;
  quality: 'good' | 'ok' | 'weak' | 'bad';
  notes?: string;
}

function loadCorpus(): CorpusRow[] {
  const files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.jsonl'));
  const rows: CorpusRow[] = [];
  for (const f of files) {
    const text = readFileSync(join(CORPUS_DIR, f), 'utf8');
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      rows.push(JSON.parse(t) as CorpusRow);
    }
  }
  return rows;
}

describe('corpus regression', () => {
  const corpus = loadCorpus();

  it('loads at least 20 samples', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(20);
  });

  it('all samples have unique ids', () => {
    const ids = corpus.map((r) => r.id);
    const set = new Set(ids);
    expect(set.size).toBe(ids.length);
  });

  for (const row of corpus) {
    it(`${row.id} (${row.quality}) · expected rules match`, () => {
      const hits = runRules({
        promptText: row.prompt,
        session: { cwd: '/tmp' },
        meta: {
          charLen: row.prompt.length,
          wordCount: row.prompt.trim().split(/\s+/).filter(Boolean).length,
        },
      });
      const actualIds = hits.map((h) => h.ruleId).sort();
      const expectedIds = [...row.rule_hits_expected].sort();

      // We allow superset results (extra fires) ONLY on non-"good" rows to
      // keep the bar strict for canonical good prompts.
      if (row.quality === 'good') {
        expect(actualIds).toEqual(expectedIds);
      } else {
        // every expected must be present
        for (const id of expectedIds) {
          expect(actualIds).toContain(id);
        }
      }
    });
  }
});
