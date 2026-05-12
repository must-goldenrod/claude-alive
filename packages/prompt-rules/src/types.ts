export type Severity = 1 | 2 | 3 | 4 | 5;

export type RuleCategory = 'structure' | 'context' | 'output' | 'safety' | 'style';

export interface DetectInput {
  promptText: string;
  session: { cwd: string; model?: string };
  meta: {
    charLen: number;
    wordCount: number;
    /** PII mask kinds → counts (populated by agent after maskPii). Absent in unit tests. */
    piiHits?: Record<string, number> | undefined;
  };
}

export interface DetectOutput {
  severity: Severity;
  message: string;
  evidence?: string;
  fixHint?: string;
}

export interface Rule {
  id: string;
  name: string;
  category: RuleCategory;
  description: string;
  severity: Severity;
  detect: (input: DetectInput) => DetectOutput | null;
}

export interface RuleHit extends DetectOutput {
  ruleId: string;
  ruleName: string;
}
