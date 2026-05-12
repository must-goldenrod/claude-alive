import { Command } from 'commander';
import { analyzeCmd } from './commands/analyze.js';
import {
  autostartDisableCmd,
  autostartEnableCmd,
  autostartStatusCmd,
} from './commands/autostart.js';
import { backfillCmd } from './commands/backfill.js';
import { coachCmd, configGetCmd, configListCmd, configSetCmd } from './commands/config-cmd.js';
import { restartCmd, startCmd, statusCmd, stopCmd } from './commands/daemon-cmds.js';
import { doctorCmd } from './commands/doctor.js';
import { exportCmd, reprocessCmd } from './commands/export-reprocess.js';
import { feedbackCmd } from './commands/feedback.js';
import { installCmd } from './commands/install.js';
import { listCmd } from './commands/list.js';
import { showCmd } from './commands/show.js';
import { uninstallCmd } from './commands/uninstall.js';
import { wipeCmd } from './commands/wipe.js';

const program = new Command();

program
  .name('think-prompt')
  .description('Claude Code prompt collector + quality coach (local-first)')
  .version('0.1.0');

program
  .command('install')
  .description('install hooks + start daemons')
  .option(
    '--no-dashboard',
    'skip the dashboard daemon (agent + worker only) — for embedders like claude-alive'
  )
  .action((opts: { dashboard?: boolean }) => {
    const installOpts: { dashboard?: boolean } = {};
    if (opts.dashboard !== undefined) installOpts.dashboard = opts.dashboard;
    return installCmd(installOpts);
  });

program
  .command('uninstall')
  .description('remove hooks + stop daemons (data preserved unless --purge)')
  .option('--purge', 'also delete ~/.think-prompt/')
  .option('--no-dashboard', 'do not attempt to stop the dashboard daemon')
  .action((opts: { purge?: boolean; dashboard?: boolean }) => {
    const uninstallOpts: { purge?: boolean; dashboard?: boolean } = {};
    if (opts.purge !== undefined) uninstallOpts.purge = opts.purge;
    if (opts.dashboard !== undefined) uninstallOpts.dashboard = opts.dashboard;
    return uninstallCmd(uninstallOpts);
  });

program.command('start').description('start agent + worker daemons').action(startCmd);
program.command('stop').description('stop agent + worker daemons').action(stopCmd);
program.command('restart').description('restart daemons').action(restartCmd);
program.command('status').description('show daemon status').action(statusCmd);
program.command('doctor').description('run health checks').action(doctorCmd);

program
  .command('list')
  .description('list recent prompts')
  .option('--limit <n>', 'max rows', '20')
  .option('--tier <tier>', 'filter by tier (good/ok/weak/bad)')
  .option('--rule <id>', 'filter by rule id (e.g., R003)')
  .action(listCmd);

program.command('show <id>').description('show prompt details by id or suffix').action(showCmd);

program
  .command('analyze [id]')
  .description(
    'deep-analyze a prompt — problems + reasoning + suggested wording (requires consent)'
  )
  .option('--grant-consent', 'set analysis.deep_consent=granted in config')
  .option('--revoke-consent', 'set analysis.deep_consent=denied in config')
  .action(analyzeCmd);

program.command('coach <state>').description('toggle inline coach mode (on/off)').action(coachCmd);

program
  .command('feedback <id> <rating>')
  .description('record 👍/👎 feedback for a prompt (rating = up | down)')
  .option('--note <text>', 'optional free-form note')
  .action(feedbackCmd);

const config = program.command('config').description('get/set/list config');
config
  .command('get [key]')
  .description('get config value (whole config if no key)')
  .action(configGetCmd);
config.command('set <key> <value>').description('set config value').action(configSetCmd);
config.command('list').description('print full config').action(configListCmd);

program
  .command('reprocess')
  .description('re-run rules + rescore')
  .option('--all', 'all prompts')
  .option('--session <id>', 'only one session')
  .action(reprocessCmd);

program
  .command('export')
  .description('export data as JSON')
  .option('--since <age>', 'e.g. 30d, 7d, 24h')
  .requiredOption('--out <file>', 'output path')
  .action(exportCmd);

program
  .command('backfill')
  .description('scan or import historical prompts from ~/.claude/projects')
  .option('--dry-run', 'preview counts without importing (default)', true)
  .option('--execute', 'actually import — transactional, idempotent via prompt_hash dedup')
  .option('--limit <n>', 'process at most N .jsonl files')
  .option('--since <date>', 'only consider prompts after this date (YYYY-MM-DD)')
  .option('--project <substr>', 'filter to project dirs containing this substring')
  .option('--root <path>', 'override the Claude projects directory')
  .option('--batch-size <n>', 'transaction batch size when importing (default 500)')
  .action(backfillCmd);

const autostart = program
  .command('autostart')
  .description('manage OS-level auto-start (launchd on macOS, systemd --user on Linux)');
autostart
  .command('enable')
  .description('register & load auto-start units (opt-in, sudo not needed)')
  .action(autostartEnableCmd);
autostart
  .command('disable')
  .description('unload & remove auto-start units (data preserved)')
  .action(autostartDisableCmd);
autostart.command('status').description('show auto-start unit status').action(autostartStatusCmd);

program
  .command('wipe')
  .description('delete all data + hooks')
  .option('--yes', 'confirm destructive action')
  .action(wipeCmd);

// Library-only usage: claude-alive imports the per-command modules directly
// (e.g. `import { installCmd } from '@think-prompt/cli-internal/dist/commands/install.js'`)
// after D-048. The commander program above is kept so the prior CLI surface
// stays inspectable, but we no longer call parseAsync here — that would fire
// on every import. If you want to drive this as a CLI, write a thin bin.ts
// that imports `program` and calls `program.parseAsync(process.argv)`.
export { program };
export * from './commands/install.js';
export * from './commands/uninstall.js';
export * from './commands/daemon-cmds.js';
export * from './commands/autostart.js';
export * from './daemon.js';
