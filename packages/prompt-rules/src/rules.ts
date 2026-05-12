import {
  ABSTRACT_CODE_REFERENCE,
  AMBIGUOUS_ADVERBS,
  AMBIGUOUS_PRONOUN_STARTS,
  CONTEXT_KEYWORDS,
  DEBUG_INTENT_KEYWORDS,
  ERROR_MESSAGE_PATTERNS,
  EXAMPLE_KEYWORDS,
  FILE_PATH_PATTERNS,
  FORMAT_KEYWORDS,
  IMPERATIVE_KEYWORDS,
  INJECTION_PATTERNS,
  OUTPUT_CONSTRAINT_KEYWORDS,
  PRIOR_ATTEMPT_KEYWORDS,
  QUESTION_MARKERS,
  SUCCESS_CRITERIA_KEYWORDS,
  TASK_SEPARATOR_PATTERNS,
  VERSION_PATTERNS,
  VERSION_SENSITIVE_TECH,
  anyMatch,
} from './keywords.js';
import type { Rule } from './types.js';

// R001 — too short (D-046: severity 2 → 1, structural nudge, not punishment)
export const r001: Rule = {
  id: 'R001',
  name: 'too_short',
  category: 'structure',
  description: 'Word count is extremely small, making intent hard to infer.',
  severity: 1,
  detect: ({ meta }) => {
    if (meta.wordCount >= 4) return null;
    return {
      severity: 1,
      message: '프롬프트가 너무 짧습니다. 목적·대상·기대 결과를 한 줄 더 추가해 보세요.',
      fixHint: 'expand_intent',
    };
  },
};

// R002 — no output format
export const r002: Rule = {
  id: 'R002',
  name: 'no_output_format',
  category: 'output',
  description: 'No hint about desired output format (JSON/table/bullets/etc).',
  severity: 3,
  detect: ({ promptText, meta }) => {
    if (meta.wordCount < 4) return null; // covered by R001
    if (anyMatch(promptText, FORMAT_KEYWORDS)) return null;
    return {
      severity: 3,
      message: '출력 형식이 지정되지 않았습니다. JSON/bullet/길이 등을 명시하면 결과가 일관됩니다.',
      fixHint: 'add_output_format',
    };
  },
};

// R003 — no context
export const r003: Rule = {
  id: 'R003',
  name: 'no_context',
  category: 'context',
  description: 'No domain/project context and prompt is short.',
  severity: 3,
  detect: ({ promptText, meta }) => {
    if (meta.wordCount >= 30) return null;
    if (anyMatch(promptText, CONTEXT_KEYWORDS)) return null;
    return {
      severity: 3,
      message: '대상 도메인·프로젝트 맥락이 빠졌습니다.',
      fixHint: 'add_context',
    };
  },
};

// R004 — multiple tasks (D-046: severity 3 → 4, genuine result pollution)
// Covers two patterns:
//   (a) conjunction-heavy: and/그리고/또한/plus appears 3+ times
//   (b) explicit separators: `요약해줘 // 번역해줘 // 코드로` — 2+ `//` or `/` separators
//       paired with 2+ imperative verb hits means the user is stacking tasks.
export const r004: Rule = {
  id: 'R004',
  name: 'multiple_tasks',
  category: 'structure',
  description: 'Multiple tasks joined with conjunctions or // separators.',
  severity: 4,
  detect: ({ promptText }) => {
    const lower = promptText.toLowerCase();
    const conjunctionPatterns = [/\band\b/gi, /그리고/gu, /또한/gu, /,\s*또/gu, /\bplus\b/gi];
    let conjunctionCount = 0;
    for (const re of conjunctionPatterns) {
      const m = lower.match(re);
      if (m) conjunctionCount += m.length;
    }

    // Count explicit separators in the original (case-insensitive doesn't help here).
    let separatorCount = 0;
    for (const re of TASK_SEPARATOR_PATTERNS) {
      const clone = new RegExp(re.source, re.flags); // fresh lastIndex
      const m = promptText.match(clone);
      if (m) separatorCount += m.length;
    }

    // Count distinct imperative verb hits. A single prompt with one verb is fine;
    // stacked tasks repeat the verb pattern.
    let imperativeCount = 0;
    for (const re of IMPERATIVE_KEYWORDS) {
      const clone = new RegExp(re.source, `${re.flags.replace('g', '')}g`);
      const m = promptText.match(clone);
      if (m) imperativeCount += m.length;
    }

    const triggeredByConjunction = conjunctionCount >= 3;
    const triggeredBySeparator = separatorCount >= 2 && imperativeCount >= 2;

    if (!triggeredByConjunction && !triggeredBySeparator) return null;

    const parts: string[] = [];
    if (conjunctionCount > 0) parts.push(`접속사 ${conjunctionCount}회`);
    if (separatorCount > 0) parts.push(`구분자(/ or //) ${separatorCount}회`);
    if (imperativeCount > 0) parts.push(`명령형 ${imperativeCount}회`);
    return {
      severity: 4,
      message: '여러 태스크가 섞여 있습니다. 하나씩 나누면 결과 품질이 올라갑니다.',
      evidence: parts.join(', '),
      fixHint: 'split_tasks',
    };
  },
};

// R005 — injection attempt
export const r005: Rule = {
  id: 'R005',
  name: 'injection_attempt',
  category: 'safety',
  description: 'Prompt injection pattern detected.',
  severity: 5,
  detect: ({ promptText }) => {
    const m = anyMatch(promptText, INJECTION_PATTERNS);
    if (!m) return null;
    return {
      severity: 5,
      message: '프롬프트 인젝션 패턴이 감지됐습니다.',
      evidence: m.source,
      fixHint: 'remove_injection',
    };
  },
};

// R006 — no success criteria
export const r006: Rule = {
  id: 'R006',
  name: 'no_success_criteria',
  category: 'output',
  description: 'No explicit success/acceptance criteria.',
  severity: 2,
  detect: ({ promptText, meta }) => {
    if (meta.wordCount < 20) return null; // skip for short prompts
    if (anyMatch(promptText, SUCCESS_CRITERIA_KEYWORDS)) return null;
    return {
      severity: 2,
      message: "무엇이 '좋은 결과'인지 기준이 없습니다. '성공 기준' 한 줄을 추가하세요.",
      fixHint: 'add_success_criteria',
    };
  },
};

// R007 — ambiguous pronoun
export const r007: Rule = {
  id: 'R007',
  name: 'ambiguous_pronoun',
  category: 'structure',
  description: 'Starts with a demonstrative/pronoun with no prior anchor.',
  severity: 2,
  detect: ({ promptText, meta }) => {
    if (meta.wordCount >= 15) return null;
    const m = anyMatch(promptText, AMBIGUOUS_PRONOUN_STARTS);
    if (!m) return null;
    return {
      severity: 2,
      message: '대명사 지칭이 모호합니다. 무엇을 가리키는지 명시하세요.',
      evidence: m.source,
      fixHint: 'clarify_referent',
    };
  },
};

// R008 — no examples when complex
export const r008: Rule = {
  id: 'R008',
  name: 'no_examples_when_complex',
  category: 'style',
  description: 'Long prompt lacks concrete example.',
  severity: 1,
  detect: ({ promptText, meta }) => {
    if (meta.wordCount <= 80) return null;
    if (anyMatch(promptText, EXAMPLE_KEYWORDS)) return null;
    return {
      severity: 1,
      message: '복잡한 요청이면 예시를 1개 포함하는 편이 좋습니다.',
      fixHint: 'add_example',
    };
  },
};

// R009 — imperative verb missing
export const r009: Rule = {
  id: 'R009',
  name: 'imperative_missing',
  category: 'structure',
  description: 'No clear imperative verb / request marker.',
  severity: 2,
  detect: ({ promptText, meta }) => {
    if (meta.wordCount < 4) return null;
    if (anyMatch(promptText, IMPERATIVE_KEYWORDS)) return null;
    if (anyMatch(promptText, QUESTION_MARKERS)) return null; // a question is fine
    return {
      severity: 2,
      message: '무엇을 해달라는지 명확한 동사가 없습니다.',
      fixHint: 'add_imperative',
    };
  },
};

// R010 — no output constraint (D-046: severity 2 → 1, structural nudge)
export const r010: Rule = {
  id: 'R010',
  name: 'no_constraint',
  category: 'output',
  description: 'No output constraint (length/language/scope).',
  severity: 1,
  detect: ({ promptText, meta }) => {
    if (meta.wordCount < 15) return null;
    if (anyMatch(promptText, OUTPUT_CONSTRAINT_KEYWORDS)) return null;
    return {
      severity: 1,
      message: '출력 제약(길이/언어/범위)이 없습니다.',
      fixHint: 'add_output_constraint',
    };
  },
};

// R011 — question without context (D-046: severity 2 → 1, brevity not always a problem)
export const r011: Rule = {
  id: 'R011',
  name: 'question_without_context',
  category: 'context',
  description: 'Short standalone question with no background.',
  severity: 1,
  detect: ({ promptText, meta }) => {
    if (meta.wordCount >= 15) return null;
    if (!anyMatch(promptText, QUESTION_MARKERS)) return null;
    if (anyMatch(promptText, CONTEXT_KEYWORDS)) return null;
    return {
      severity: 1,
      message: '배경 없이 단문 질문입니다. 이전에 무엇을 했는지 1줄 덧붙이면 좋습니다.',
      fixHint: 'add_background_to_question',
    };
  },
};

// R012 — code dump without instruction (D-046: severity 3 → 4, major result pollution)
// Threshold lowered 0.8 → 0.65 after dogfooding surfaced the "300 lines of
// code + one short question" pattern that slipped through at 0.8.
export const r012: Rule = {
  id: 'R012',
  name: 'code_dump_no_instruction',
  category: 'structure',
  description: 'Prompt is mostly code (≥65%) with no clear instruction.',
  severity: 4,
  detect: ({ promptText }) => {
    const codeBlocks = promptText.match(/```[\s\S]*?```/g) ?? [];
    if (codeBlocks.length === 0) return null;
    const codeLen = codeBlocks.reduce((acc, b) => acc + b.length, 0);
    const ratio = codeLen / promptText.length;
    if (ratio < 0.65) return null;
    if (anyMatch(promptText, IMPERATIVE_KEYWORDS)) return null;
    return {
      severity: 4,
      message: '코드만 붙여넣으셨습니다. 원하는 동작(디버그/리뷰/설명)을 지시어로 추가하세요.',
      evidence: `코드 비율 ${(ratio * 100).toFixed(0)}%`,
      fixHint: 'add_code_action',
    };
  },
};

// R013 — PII detected in prompt (C-036)
// Warns the user that sensitive data leaked into a prompt. The masking in
// packages/core/src/pii.ts will still run regardless; this rule surfaces the
// hit to the scoreboard so it doesn't go unnoticed.
export const r013: Rule = {
  id: 'R013',
  name: 'pii_detected',
  category: 'safety',
  description: 'PII (email / phone / RRN / API key / JWT / IP) detected in the prompt.',
  severity: 2,
  detect: ({ meta }) => {
    const hits = meta.piiHits;
    if (!hits) return null;
    const kinds = Object.keys(hits).filter((k) => (hits[k] ?? 0) > 0);
    if (kinds.length === 0) return null;
    const total = kinds.reduce((s, k) => s + (hits[k] ?? 0), 0);
    // Severity escalates with the number of distinct PII categories.
    const severity: 1 | 2 | 3 = kinds.length >= 3 ? 3 : kinds.length >= 2 ? 2 : 1;
    return {
      severity,
      message: `프롬프트에 민감정보(${kinds.join(', ')})가 포함돼 있습니다. 원문은 로컬에만 저장되지만, LLM 리라이트 등 외부 호출에도 포함되지 않도록 주의하세요.`,
      evidence: `총 ${total}건, 카테고리 ${kinds.length}종`,
      fixHint: 'redact_pii',
    };
  },
};

// R014 — vague adverbs (C-023)
// "좀/대충/kinda/maybe" 같은 모호 표현은 결과 품질을 떨어뜨립니다.
export const r014: Rule = {
  id: 'R014',
  name: 'vague_adverb',
  category: 'style',
  description: 'Prompt contains vague qualifiers like 좀/대충/kinda/probably.',
  severity: 2,
  detect: ({ promptText, meta }) => {
    if (meta.wordCount < 4) return null;
    const m = anyMatch(promptText, AMBIGUOUS_ADVERBS);
    if (!m) return null;
    // Try to extract the actual match for evidence.
    const re = new RegExp(m.source, m.flags);
    const match = promptText.match(re);
    return {
      severity: 2,
      message:
        '모호한 부사(좀/대충/kinda 등)가 있습니다. 구체적 기준(숫자·예시·범위)으로 바꾸면 결과가 일관됩니다.',
      evidence: match ? match[0].trim() : m.source,
      fixHint: 'replace_vague',
    };
  },
};

// R015 — missing "what I already tried" for debugging asks (C-011)
export const r015: Rule = {
  id: 'R015',
  name: 'no_prior_attempt',
  category: 'context',
  description: 'Debug-intent prompt lacks description of what was already tried.',
  severity: 2,
  detect: ({ promptText, meta }) => {
    // Korean prompts naturally tokenize to fewer whitespace-separated words,
    // so the threshold is lower than it would be for English.
    if (meta.wordCount < 8) return null;
    if (!anyMatch(promptText, DEBUG_INTENT_KEYWORDS)) return null;
    if (anyMatch(promptText, PRIOR_ATTEMPT_KEYWORDS)) return null;
    return {
      severity: 2,
      message:
        '디버깅 요청 같은데 "이미 시도한 것" 설명이 없습니다. "X 해봤는데 Y 에러" 식으로 한 줄 추가하면 모델이 같은 경로를 반복하지 않습니다.',
      fixHint: 'add_prior_attempt',
    };
  },
};

// R016 — tech stack mentioned without a version (C-013)
export const r016: Rule = {
  id: 'R016',
  name: 'no_version_spec',
  category: 'context',
  description: 'Version-sensitive tech mentioned but no version number.',
  severity: 2,
  detect: ({ promptText, meta }) => {
    if (meta.wordCount < 10) return null;
    if (!anyMatch(promptText, VERSION_SENSITIVE_TECH)) return null;
    if (anyMatch(promptText, VERSION_PATTERNS)) return null;
    return {
      severity: 2,
      message:
        '버전 정보가 없습니다. Node 20 / Python 3.12 / React 19 같이 버전을 명시하면 API 차이로 인한 오답이 줄어듭니다.',
      fixHint: 'add_version',
    };
  },
};

// R017 — debug intent but no error message included (C-015)
export const r017: Rule = {
  id: 'R017',
  name: 'missing_error_message',
  category: 'context',
  description: 'Debug-intent prompt without an actual error message / stack trace.',
  severity: 2,
  detect: ({ promptText, meta }) => {
    if (meta.wordCount < 6) return null;
    if (!anyMatch(promptText, DEBUG_INTENT_KEYWORDS)) return null;
    if (anyMatch(promptText, ERROR_MESSAGE_PATTERNS)) return null;
    return {
      severity: 2,
      message:
        '에러 메시지나 스택 트레이스가 없습니다. 실제 출력을 그대로 붙여넣으면 추측 대신 원인 기반 답을 얻을 수 있습니다.',
      fixHint: 'paste_error',
    };
  },
};

// R018 — code reference without a concrete path (C-040)
export const r018: Rule = {
  id: 'R018',
  name: 'no_file_path',
  category: 'context',
  description: 'Prompt references code abstractly ("이 함수/this class") without a path.',
  severity: 1,
  detect: ({ promptText, meta }) => {
    if (meta.wordCount < 4) return null;
    if (!anyMatch(promptText, ABSTRACT_CODE_REFERENCE)) return null;
    if (anyMatch(promptText, FILE_PATH_PATTERNS)) return null;
    return {
      severity: 1,
      message:
        '"이 함수/this class" 같은 추상 지칭이 있는데 파일 경로가 없습니다. `src/db.ts` 같이 경로를 달면 모델이 Read 도구로 바로 확인할 수 있습니다.',
      fixHint: 'add_file_path',
    };
  },
};

export const ALL_RULES: Rule[] = [
  r001,
  r002,
  r003,
  r004,
  r005,
  r006,
  r007,
  r008,
  r009,
  r010,
  r011,
  r012,
  r013,
  r014,
  r015,
  r016,
  r017,
  r018,
];
