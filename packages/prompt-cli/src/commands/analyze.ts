/**
 * `think-prompt analyze <id>` — the CLI entry point for deep analysis.
 *
 * Consent-gated per docs/00-decision-log.md D-033. Three gates must ALL
 * pass before any network traffic happens:
 *
 *   1. `llm.enabled` is true in config                        (existing D-015)
 *   2. `ANTHROPIC_API_KEY` env var (or configured name) is set
 *   3. `analysis.deep_consent === 'granted'`                  (new)
 */
import {
  loadConfig,
  openDb,
  runDeepAnalysis,
  saveConfig,
  setConfigValue,
} from '@think-prompt/core';
import pc from 'picocolors';

export interface AnalyzeCmdOptions {
  grantConsent?: boolean;
  revokeConsent?: boolean;
}

export async function analyzeCmd(id: string | undefined, opts: AnalyzeCmdOptions): Promise<void> {
  const config = loadConfig();

  if (opts.grantConsent || opts.revokeConsent) {
    const next = opts.grantConsent ? 'granted' : 'denied';
    let updated = setConfigValue(config, 'analysis.deep_consent', next);
    updated = setConfigValue(updated, 'analysis.deep_consent_at', new Date().toISOString());
    saveConfig(updated);
    console.log(pc.green('✓') + ` deep-analysis consent set to ${pc.bold(next)} in config.json`);
    return;
  }

  if (!id) {
    console.log(pc.red('✗') + ' missing <id> argument (prompt_usages.id or suffix)');
    process.exit(2);
    return;
  }

  if (!config.llm.enabled) {
    console.log(pc.yellow('⚠') + ' LLM is disabled. Enable first:');
    console.log('    think-prompt config set llm.enabled true');
    console.log('    export ' + config.llm.api_key_env + '=...');
    process.exit(1);
    return;
  }

  const apiKey = process.env[config.llm.api_key_env];
  if (!apiKey) {
    console.log(pc.red('✗') + ` ${config.llm.api_key_env} is not set in the environment`);
    process.exit(1);
    return;
  }

  if (config.analysis.deep_consent !== 'granted') {
    console.log(pc.yellow('⚠') + ' deep analysis requires your explicit consent.');
    console.log('');
    console.log('  What it does:');
    console.log('   - Sends the PII-masked prompt text to ' + pc.bold(config.llm.model) + '.');
    console.log('   - Receives back problem categories + step-by-step reasoning + rewrite.');
    console.log('   - Stores the result locally; nothing else leaves your machine.');
    console.log('');
    console.log('  To grant consent:   ' + pc.bold('think-prompt analyze --grant-consent'));
    console.log('  To decline:         ' + pc.bold('think-prompt analyze --revoke-consent'));
    process.exit(1);
    return;
  }

  const db = openDb();
  const usage = db
    .prepare(
      `SELECT id FROM prompt_usages WHERE id=? OR id LIKE ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(id, `%${id}`) as { id: string } | undefined;
  if (!usage) {
    console.log(pc.red('✗') + ` no prompt_usage found matching ${id}`);
    db.close();
    process.exit(1);
    return;
  }

  console.log(pc.dim(`analyzing ${usage.id} with ${config.llm.model} ...`));
  const t0 = Date.now();
  const result = await runDeepAnalysis(db, {
    usage_id: usage.id,
    apiKey,
    model: config.llm.model,
  });
  const ms = Date.now() - t0;

  db.close();

  console.log('');
  if (!result.ok) {
    console.log(pc.red('✗') + ` analysis failed: ${result.error_message ?? 'unknown'}`);
    process.exit(1);
    return;
  }

  console.log(pc.bold(`deep analysis ${pc.dim('(' + (ms / 1000).toFixed(1) + ' s)')}`));
  console.log('');
  if (result.problems.length > 0) {
    console.log(pc.bold('  Problems identified:'));
    for (const p of result.problems) {
      console.log(`    ${sevTag(p.severity)} ${pc.cyan(p.category)} — ${p.explanation}`);
    }
    console.log('');
  }
  if (result.reasoning.length > 0) {
    console.log(pc.bold('  Reasoning:'));
    for (let i = 0; i < result.reasoning.length; i++) {
      console.log(`    ${i + 1}. ${result.reasoning[i]}`);
    }
    console.log('');
  }
  console.log(pc.bold('  Suggested rewrite:'));
  console.log('');
  for (const line of result.after_text.split('\n')) console.log('    ' + line);
  console.log('');
  if (result.applied_fixes.length > 0) {
    console.log(pc.dim('  applied fixes: ' + result.applied_fixes.join(', ')));
  }
  if (result.input_tokens || result.output_tokens) {
    console.log(
      pc.dim(`  tokens: in=${result.input_tokens ?? '-'} out=${result.output_tokens ?? '-'}`)
    );
  }
}

function sevTag(sev: number): string {
  if (sev >= 4) return pc.red(`[sev ${sev}]`);
  if (sev >= 2) return pc.yellow(`[sev ${sev}]`);
  return pc.dim(`[sev ${sev}]`);
}
