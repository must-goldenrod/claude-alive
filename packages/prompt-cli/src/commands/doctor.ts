import { existsSync, readFileSync } from 'node:fs';
import { getMeta, getPaths, loadConfig, openDb } from '@think-prompt/core';
import pc from 'picocolors';
import { status } from '../daemon.js';
import { hooksPresent } from '../settings-merge.js';

export async function doctorCmd(): Promise<void> {
  const paths = getPaths();
  const config = loadConfig();
  console.log(pc.bold('Think-Prompt Doctor'));
  console.log('─────────────────');

  // Settings
  if (hooksPresent(paths.claudeSettings)) {
    console.log(pc.green('✓') + ` hooks installed in ${paths.claudeSettings}`);
  } else if (existsSync(paths.claudeSettings)) {
    console.log(pc.yellow('⚠') + ' hooks NOT present — run `think-prompt install`');
  } else {
    console.log(pc.yellow('⚠') + ` ${paths.claudeSettings} does not exist yet`);
  }

  // Daemons
  const a = status('agent');
  console.log(
    (a.running ? pc.green('✓') : pc.red('✗')) +
      ` agent ${a.running ? `running (pid ${a.pid}, :${config.agent.port})` : 'NOT running'}`
  );
  const w = status('worker');
  console.log(
    (w.running ? pc.green('✓') : pc.red('✗')) +
      ` worker ${w.running ? `running (pid ${w.pid})` : 'NOT running'}`
  );

  // DB
  if (existsSync(paths.dbFile)) {
    const db = openDb();
    const schema = getMeta(db, 'schema_version');
    console.log(pc.green('✓') + ` database schema_version=${schema}`);
    const count = db.prepare(`SELECT COUNT(*) AS c FROM prompt_usages`).get() as { c: number };
    if (count.c === 0) {
      console.log(pc.yellow('⚠') + ' no prompt_usages yet — open Claude Code and type something');
    } else {
      const recent = db
        .prepare(
          `SELECT COUNT(*) AS c FROM prompt_usages WHERE created_at > datetime('now','-1 day')`
        )
        .get() as { c: number };
      if (recent.c === 0) {
        console.log(
          pc.yellow('⚠') +
            ` prompt_usages total=${count.c} but none in last 24h — hooks may not be firing`
        );
      } else {
        console.log(pc.green('✓') + ` prompt_usages total=${count.c}, recent_24h=${recent.c}`);
      }
    }
    db.close();
  } else {
    console.log(pc.red('✗') + ` database missing at ${paths.dbFile}`);
  }

  // Config + LLM
  if (config.llm.enabled) {
    const key = process.env[config.llm.api_key_env];
    if (key) console.log(pc.green('✓') + ` LLM enabled (model=${config.llm.model})`);
    else console.log(pc.red('✗') + ` LLM enabled but ${config.llm.api_key_env} is not set`);
  } else {
    console.log(pc.dim('⊘ LLM disabled (judge & deep-analysis skipped)'));
  }

  // Recent log errors
  if (existsSync(paths.agentLog)) {
    try {
      const tail = readFileSync(paths.agentLog, 'utf8').split('\n').slice(-30);
      const errors = tail.filter((l) => l.includes('"level":50') || l.includes('error'));
      if (errors.length > 0) {
        console.log('');
        console.log(pc.bold('Recent agent errors (last 30 log lines):'));
        for (const e of errors.slice(-5)) console.log('  ' + pc.dim(e.slice(0, 200)));
      }
    } catch {
      // ignore
    }
  }
}
