/**
 * PII masking v0 — regex-based. Decision D-016.
 * Returns both masked text and a count of hits by kind.
 */

export interface PiiMaskResult {
  masked: string;
  hits: Record<string, number>;
}

const PATTERNS: Array<{ kind: string; re: RegExp; token: string }> = [
  { kind: 'email', re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, token: '<EMAIL>' },
  // Korean resident registration number (주민번호) e.g. 901231-1234567
  { kind: 'rrn', re: /\b\d{6}-?[1-4]\d{6}\b/g, token: '<RRN>' },
  // Credit card (rough, 13-19 digits possibly separated). Avoid matching long hex.
  { kind: 'credit_card', re: /\b(?:\d[ -]?){13,19}\b/g, token: '<CARD>' },
  // Phone: Korean (010-1234-5678) / International (+82) / generic 7+ digit sequences with dashes
  { kind: 'phone_kr', re: /\b0\d{1,2}[- .]?\d{3,4}[- .]?\d{4}\b/g, token: '<PHONE>' },
  { kind: 'phone_intl', re: /\+\d{1,3}[- .]?\d{2,4}[- .]?\d{3,4}[- .]?\d{3,4}/g, token: '<PHONE>' },
  // AWS
  { kind: 'aws_akid', re: /\bAKIA[0-9A-Z]{16}\b/g, token: '<AWS_KEY>' },
  { kind: 'aws_asia', re: /\bASIA[0-9A-Z]{16}\b/g, token: '<AWS_KEY>' },
  // Generic API key-ish: sk-... (OpenAI) / sk-ant-... (Anthropic) / ghp_/github
  { kind: 'openai_key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g, token: '<OPENAI_KEY>' },
  { kind: 'anthropic_key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, token: '<ANTHROPIC_KEY>' },
  { kind: 'github_token', re: /\bghp_[A-Za-z0-9]{36}\b/g, token: '<GITHUB_TOKEN>' },
  { kind: 'github_token_fine', re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g, token: '<GITHUB_TOKEN>' },
  // JWT
  {
    kind: 'jwt',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    token: '<JWT>',
  },
  // IPv4
  {
    kind: 'ipv4',
    re: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g,
    token: '<IP>',
  },
];

export function maskPii(input: string): PiiMaskResult {
  let out = input;
  const hits: Record<string, number> = {};
  // Anthropic key pattern must apply before generic sk- pattern (order matters).
  const ordered = [...PATTERNS].sort((a, b) => {
    if (a.kind === 'anthropic_key' && b.kind === 'openai_key') return -1;
    if (a.kind === 'openai_key' && b.kind === 'anthropic_key') return 1;
    return 0;
  });
  for (const { kind, re, token } of ordered) {
    re.lastIndex = 0;
    const matches = out.match(re);
    if (matches && matches.length > 0) {
      hits[kind] = (hits[kind] ?? 0) + matches.length;
      out = out.replace(re, token);
    }
  }
  return { masked: out, hits };
}
