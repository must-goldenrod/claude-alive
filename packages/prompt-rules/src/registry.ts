import { ALL_RULES } from './rules.js';
import type { DetectInput, Rule, RuleHit } from './types.js';

export interface RunOptions {
  disabled?: Set<string>;
}

export function runRules(input: DetectInput, opts: RunOptions = {}): RuleHit[] {
  const hits: RuleHit[] = [];
  for (const r of ALL_RULES) {
    if (opts.disabled?.has(r.id)) continue;
    try {
      const out = r.detect(input);
      if (out) {
        hits.push({ ...out, ruleId: r.id, ruleName: r.name });
      }
    } catch {
      // rule execution error → skip silently; fail-open.
    }
  }
  return hits;
}

export function getRulesCatalog(): Array<
  Pick<Rule, 'id' | 'name' | 'category' | 'description' | 'severity'>
> {
  return ALL_RULES.map(({ id, name, category, description, severity }) => ({
    id,
    name,
    category,
    description,
    severity,
  }));
}
