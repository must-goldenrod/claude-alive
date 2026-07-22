/**
 * Standing i18n guards (spec §P0 "EN/KO parity/raw-text checker", §R.3).
 *
 * These run against the real locale files and the real UI source, so a missing
 * translation or a newly hardcoded string fails the suite instead of shipping.
 */

import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLocaleParity, findRawText, flattenKeys } from '../checker.js';

// Resolve from this file, not the cwd: the suite runs both from the package
// directory and from the repo root, and a cwd-relative path breaks in one of them.
const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES = resolve(HERE, '..', 'locales');
const UI_SRC = resolve(HERE, '..', '..', '..', 'ui', 'src');

const en = JSON.parse(readFileSync(join(LOCALES, 'en.json'), 'utf8'));
const ko = JSON.parse(readFileSync(join(LOCALES, 'ko.json'), 'utf8'));

describe('locale parity', () => {
  test('EN and KO expose exactly the same keys, none blank', () => {
    const r = checkLocaleParity(en, ko);
    expect({
      missingInKo: r.missingInTarget,
      missingInEn: r.missingInBase,
      blankInKo: r.emptyInTarget,
    }).toEqual({ missingInKo: [], missingInEn: [], blankInKo: [] });
  });

  test('the locale set is non-trivial (guards against an empty file passing parity)', () => {
    expect(flattenKeys(en).length).toBeGreaterThan(100);
  });
});

/**
 * Raw-text is a ratchet, not a clean-room rule: the UI predates the checker and
 * some findings are legitimately untranslated (brand name, `CPU`/`RAM`, token
 * metric labels in the archive view). The ceiling stops it getting worse; lower
 * it as strings are migrated to `t()`. Raised from 13 to 20 when the archive
 * view (input/output/cache/total/api calls/model/SUB labels) merged in.
 */
const RAW_TEXT_CEILING = 20;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return ['node_modules', 'dist', '__tests__'].includes(entry) ? [] : tsxFiles(path);
    }
    return entry.endsWith('.tsx') ? [path] : [];
  });
}

describe('raw text in the UI', () => {
  test(`does not exceed the agreed ceiling of ${RAW_TEXT_CEILING} findings`, () => {
    const findings = tsxFiles(UI_SRC).flatMap((file) =>
      findRawText(readFileSync(file, 'utf8')).map((f) => `${file}:${f.line} ${f.text}`),
    );
    // Print them so a failure names the new string rather than just a count.
    if (findings.length > RAW_TEXT_CEILING) console.error(findings.join('\n'));
    expect(findings.length).toBeLessThanOrEqual(RAW_TEXT_CEILING);
  });
});
