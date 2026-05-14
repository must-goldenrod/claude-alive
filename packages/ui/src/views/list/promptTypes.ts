/**
 * Shared types and visual tokens for the Prompt tab and its sub-views.
 * Kept separate from the components so PromptView (shell), the dashboard,
 * and the list view can import without circular references.
 */

export const TIER_COLOR: Record<string, string> = {
  good: 'var(--accent-green)',
  ok: 'var(--accent-blue)',
  weak: 'var(--accent-amber)',
  bad: 'var(--accent-red)',
};

export const SEVERITY_COLOR: Record<number, string> = {
  1: 'var(--accent-blue)',
  2: 'var(--accent-blue)',
  3: 'var(--accent-amber)',
  4: 'var(--accent-amber)',
  5: 'var(--accent-red)',
};

export interface PromptListRow {
  id: string;
  session_id: string;
  prompt: string;
  char_len: number;
  word_count: number;
  created_at: string;
  turn_index: number;
  final_score: number | null;
  rule_score: number | null;
  usage_score: number | null;
  tier: string | null;
  efficiency_score?: number | null;
  confidence?: string | null;
  baseline_delta?: number | null;
}

export interface PromptDetail {
  prompt: PromptListRow & {
    coach_context: string | null;
    judge_score: number | null;
    computed_at: string | null;
    rules_version: number | null;
  };
  hits: Array<{
    rule_id: string;
    severity: number;
    message: string;
    evidence: string | null;
  }>;
}

export interface PromptStats {
  total: number;
  avg_score: number | null;
  tier_distribution: Record<string, number>;
  daily: Array<{ day: string; count: number; avg_score: number | null }>;
  top_rules: Array<{
    rule_id: string;
    hits: number;
    max_severity: number;
    avg_severity: number;
    sample_message: string;
  }>;
}

export function fmtTime(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}
