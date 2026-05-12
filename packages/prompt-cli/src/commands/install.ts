import { getPaths, loadConfig, openDb } from '@think-prompt/core';
import pc from 'picocolors';
import { type Role, start } from '../daemon.js';
import { mergeHooksIntoSettings } from '../settings-merge.js';

export interface InstallOptions {
  /**
   * Backwards-compat shim for the now-removed dashboard daemon (D-048):
   * once think-prompt was absorbed into claude-alive, the standalone
   * dashboard daemon was retired in favour of the React Prompt tab.
   * The flag is still accepted so callers and existing CLI scripts don't
   * break, but it has no effect — agent + worker are the only daemons.
   */
  dashboard?: boolean;
}

/**
 * Programmatic install entry — initializes the DB, merges hooks into
 * `~/.claude/settings.json`, and starts the agent + worker daemons.
 *
 * Invoked by `claude-alive install` (which imports this directly from the
 * `@think-prompt/cli-internal` workspace package after the D-048 absorption)
 * and exposed via the same name to keep call sites simple.
 */
export async function installCmd(_opts: InstallOptions = {}): Promise<void> {
  const paths = getPaths();
  const config = loadConfig();
  // Initialize DB & config
  const db = openDb();
  db.close();
  const result = mergeHooksIntoSettings(paths.claudeSettings, config.agent.port);
  if (result.changed) {
    console.log(pc.green('✓') + ` Claude settings updated: ${paths.claudeSettings}`);
    if (result.backupPath) console.log(`  (backup: ${result.backupPath})`);
  } else {
    console.log(pc.dim('• Claude settings already up to date'));
  }
  const rolesToStart: Role[] = ['agent', 'worker'];
  for (const role of rolesToStart) {
    const s = start(role);
    const port = role === 'agent' ? `, :${config.agent.port}` : '';
    console.log(
      (s.running ? pc.green('✓') : pc.red('✗')) +
        ` ${role} ${s.running ? 'running' : 'failed'} (pid ${s.pid ?? '-'}${port})`
    );
  }
}
