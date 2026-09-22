/**
 * One page in, one report out.
 *
 * Deterministic checks run first and cost nothing. Questions — the parts that
 * need judgement — are routed to Claude through an injected `extract`, and a
 * run without a credential degrades to `skip` instead of failing outright.
 */
import {
  checkLinkTargets,
  checkSelectors,
  collectPageFacts,
  summarize,
  type CheckResult,
  type CheckSummary,
  type PageFacts,
  type PageLike,
} from './checks.js';

export interface InspectSpec {
  readonly url: string;
  /** CSS selectors that must match at least one element. */
  readonly selectors?: readonly string[];
  /** Resolve every link on the page and report its HTTP status. */
  readonly checkLinks?: boolean;
  /** Attach a PNG of the viewport to the report. */
  readonly screenshot?: boolean;
  /** Judgement questions answered by Claude, one check each. */
  readonly questions?: readonly string[];
}

export interface QuestionAnswer {
  readonly question: string;
  readonly answer: string;
  readonly ok: boolean;
}

export interface InspectReport {
  readonly url: string;
  readonly facts: PageFacts;
  readonly checks: CheckResult[];
  readonly summary: CheckSummary;
  readonly answers: QuestionAnswer[];
  readonly screenshotBase64?: string;
  readonly accessibilityTree?: string;
}

/** Shape of the Stagehand `extract` call, narrowed to what this module uses. */
export type ExtractFn = (instruction: string) => Promise<{ data?: unknown }>;

export interface InspectDeps {
  readonly fetchImpl?: typeof fetch;
  readonly extract?: ExtractFn;
  readonly navigationTimeoutMs?: number;
}

/**
 * Reject anything that is not http(s) before it reaches the browser — a check
 * spec is data, and `file://` would turn it into a local file read.
 */
export function assertInspectableUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Not a valid URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Only http(s) URLs can be inspected, got: ${parsed.protocol}`);
  }
}

function readAnswer(raw: unknown, question: string): QuestionAnswer {
  const data = (raw ?? {}) as { answer?: unknown; ok?: unknown };
  return {
    question,
    answer: typeof data.answer === 'string' ? data.answer : JSON.stringify(raw),
    ok: data.ok !== false,
  };
}

/** Inspect an already-open page. `inspectUrl` wraps this with a session. */
export async function inspectPage(
  page: PageLike,
  spec: InspectSpec,
  deps: InspectDeps = {},
): Promise<InspectReport> {
  assertInspectableUrl(spec.url);
  await page.goto(spec.url, { waitUntil: 'load', timeout: deps.navigationTimeoutMs ?? 30_000 });

  const facts = await collectPageFacts(page);
  const checks: CheckResult[] = [...(await checkSelectors(page, spec.selectors ?? []))];

  if (spec.checkLinks === true) {
    checks.push(...(await checkLinkTargets(facts.links, deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {})));
  }

  const answers: QuestionAnswer[] = [];
  for (const question of spec.questions ?? []) {
    if (deps.extract === undefined) {
      checks.push({ name: `question ${question}`, status: 'skip', detail: 'no Claude credential configured' });
      continue;
    }
    try {
      const result = await deps.extract(question);
      const answer = readAnswer(result.data, question);
      answers.push(answer);
      checks.push({
        name: `question ${question}`,
        status: answer.ok ? 'pass' : 'fail',
        detail: answer.answer,
      });
    } catch (error) {
      checks.push({
        name: `question ${question}`,
        status: 'error',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const report: InspectReport = {
    url: facts.url,
    facts,
    checks,
    summary: summarize(checks),
    answers,
  };
  if (spec.screenshot !== true) return report;

  const shot = await page.screenshot();
  return { ...report, screenshotBase64: Buffer.from(shot).toString('base64') };
}
