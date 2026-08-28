/**
 * The delegation model catalogue (spec §2, extended 2026-08-10).
 *
 * The gateway exposes a dozen models from four families; the orchestrator used
 * to be told about exactly one. This table names them, gives each a short alias
 * the orchestrator can type, and — the point of the file — an ordered fallback
 * list, so a model that is rate-limited or retired hands the subtask to a peer
 * instead of failing the delegation.
 *
 * Fallback order per entry is "closest capability first": a `-go2` twin (same
 * upstream model on a second route) before a same-tier model from another
 * vendor, and a Gemini flash as the always-cheap last resort.
 *
 * Unknown ids are NOT rejected anywhere — the gateway's catalogue rotates, so an
 * id absent from this table is passed through to the API as-is.
 */

/** Rough role of a model, shown in the orchestrator's menu. */
export type DelegateModelKind = 'reasoning' | 'fast' | 'code' | 'utility';

export interface DelegateModelSpec {
  /** Gateway model id, exactly as `/v1/models` reports it. */
  readonly id: string;
  /** Short names accepted by `--model` (case-insensitive). */
  readonly aliases: readonly string[];
  readonly kind: DelegateModelKind;
  /** One-line capability hint (Korean; goes into the orchestrator prompt). */
  readonly note: string;
  /** Ordered alternates tried when this model fails with a retryable error. */
  readonly fallbacks: readonly string[];
}

const GEMINI_LITE = 'gemini/gemini-3.1-flash-lite-preview';
const GEMINI_FLASH = 'gemini/gemini-3.6-flash';
const GEMINI_FLASH_35 = 'gemini/gemini-3.5-flash';
const GEMINI_PRO = 'gemini/gemini-3.1-pro-preview';

export const DELEGATE_MODELS: readonly DelegateModelSpec[] = Object.freeze([
  {
    id: GEMINI_LITE,
    aliases: ['lite', 'flash-lite', 'fast'],
    kind: 'fast',
    note: '가장 싸고 빠름 — 대량 분류·요약·추출',
    fallbacks: [GEMINI_FLASH_35, GEMINI_FLASH, 'glm-5.2'],
  },
  {
    id: GEMINI_FLASH,
    aliases: ['flash', 'gemini'],
    kind: 'fast',
    note: '범용 빠름 + 롱컨텍스트',
    fallbacks: [GEMINI_FLASH_35, GEMINI_LITE, 'glm-5.2'],
  },
  {
    id: GEMINI_FLASH_35,
    aliases: ['flash-3.5'],
    kind: 'fast',
    note: '이전 세대 flash (flash 대체용)',
    fallbacks: [GEMINI_FLASH, GEMINI_LITE, 'glm-5.2'],
  },
  {
    id: GEMINI_PRO,
    aliases: ['pro', 'gemini-pro'],
    kind: 'reasoning',
    note: '고난도 추론·긴 분석',
    fallbacks: ['grok-4.5', 'glm-5.2', GEMINI_FLASH],
  },
  {
    id: 'grok-4.5',
    aliases: ['grok'],
    kind: 'reasoning',
    note: '범용 추론 — 다른 관점의 2차 의견',
    fallbacks: ['grok-4.5-go2', 'glm-5.2', GEMINI_PRO],
  },
  {
    id: 'grok-4.5-go2',
    aliases: ['grok-go2'],
    kind: 'reasoning',
    note: 'grok-4.5의 보조 경로',
    fallbacks: ['grok-4.5', 'glm-5.2', GEMINI_PRO],
  },
  {
    id: 'kimi-k3',
    aliases: ['kimi', 'k3'],
    kind: 'code',
    note: '코드·에이전틱 작업',
    fallbacks: ['kimi-k3-go2', 'kimi-k2.7-code', 'glm-5.2', GEMINI_PRO],
  },
  {
    id: 'kimi-k3-go2',
    aliases: ['kimi-go2', 'k3-go2'],
    kind: 'code',
    note: 'kimi-k3의 보조 경로',
    fallbacks: ['kimi-k3', 'kimi-k2.7-code', 'glm-5.2', GEMINI_PRO],
  },
  {
    id: 'kimi-k2.7-code',
    aliases: ['kimi-code', 'k2-code'],
    kind: 'code',
    note: '코드 특화 (이전 세대)',
    fallbacks: ['kimi-k3', 'glm-5.2', GEMINI_PRO],
  },
  {
    id: 'glm-5.2',
    aliases: ['glm'],
    kind: 'reasoning',
    note: '범용 추론 + 긴 컨텍스트',
    fallbacks: [GEMINI_PRO, 'grok-4.5', GEMINI_FLASH],
  },
  {
    id: 'gemma4',
    aliases: ['gemma'],
    kind: 'utility',
    note: '로컬 소형 모델 (ollama)',
    fallbacks: [GEMINI_LITE],
  },
  {
    id: 'translategemma',
    aliases: ['translate'],
    kind: 'utility',
    note: '번역 특화',
    fallbacks: [GEMINI_FLASH, GEMINI_LITE],
  },
]);

/**
 * Tail used when the requested model is not in the table (a fresh gateway id).
 * Deliberately cross-vendor: whatever went wrong with the unknown id, these are
 * unlikely to share the cause.
 */
export const DEFAULT_FALLBACK_TAIL: readonly string[] = Object.freeze([
  GEMINI_FLASH,
  'glm-5.2',
  GEMINI_LITE,
]);

/** Look a model up by id or alias. Returns undefined for ids not in the table. */
export function findDelegateModel(input: string): DelegateModelSpec | undefined {
  const key = input.trim().toLowerCase();
  if (!key) return undefined;
  return DELEGATE_MODELS.find(
    (m) => m.id.toLowerCase() === key || m.aliases.some((a) => a.toLowerCase() === key),
  );
}

/** Alias → gateway id. Unknown input passes through trimmed (see file header). */
export function resolveModelId(input: string): string {
  return findDelegateModel(input)?.id ?? input.trim();
}

export interface ChainOptions {
  /** `--no-fallback`: use the requested model only. */
  readonly noFallback?: boolean;
  /** `CA_DELEGATE_FALLBACKS` — replaces the table's tail for every model. */
  readonly fallbackOverride?: string;
}

function splitList(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function dedupe(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Build the ordered list of models to try for one delegation.
 *
 * - `requested` may itself be a comma/space separated chain — an explicit chain
 *   is taken literally (no table tail appended); the caller said what it wants.
 * - a single known model contributes its table fallbacks;
 * - a single unknown model gets {@link DEFAULT_FALLBACK_TAIL}.
 */
export function buildDelegateChain(requested: string, opts: ChainOptions = {}): string[] {
  const asked = splitList(requested).map(resolveModelId);
  if (asked.length === 0) return [];
  if (opts.noFallback) return [asked[0]!];
  if (asked.length > 1) return dedupe(asked);

  const primary = asked[0]!;
  const override = opts.fallbackOverride?.trim();
  const tail = override
    ? splitList(override).map(resolveModelId)
    : (findDelegateModel(primary)?.fallbacks ?? DEFAULT_FALLBACK_TAIL);
  return dedupe([primary, ...tail]).filter((id) => id.length > 0);
}

/** The model menu embedded in the orchestrator prompt (one line per model). */
export function describeDelegateModels(): string {
  const label: Record<DelegateModelKind, string> = {
    reasoning: '추론',
    fast: '고속',
    code: '코드',
    utility: '보조',
  };
  return DELEGATE_MODELS.map(
    (m) => `  - ${m.aliases[0] ?? m.id} (${m.id}) [${label[m.kind]}] — ${m.note}`,
  ).join('\n');
}
