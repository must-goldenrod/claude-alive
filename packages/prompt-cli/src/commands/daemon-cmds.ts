import { loadConfig } from '@think-prompt/core';
import pc from 'picocolors';
import { restart, start, status, stop } from '../daemon.js';

export async function startCmd(): Promise<void> {
  const a = start('agent');
  const w = start('worker');
  const cfg = loadConfig();
  console.log(
    (a.running ? pc.green('✓') : pc.red('✗')) + ` agent (pid ${a.pid ?? '-'}, :${cfg.agent.port})`
  );
  console.log((w.running ? pc.green('✓') : pc.red('✗')) + ` worker (pid ${w.pid ?? '-'})`);
}

export async function stopCmd(): Promise<void> {
  stop('agent');
  stop('worker');
  console.log(pc.green('✓') + ' stopped');
}

export async function restartCmd(): Promise<void> {
  restart('agent');
  restart('worker');
  console.log(pc.green('✓') + ' restarted');
}

export async function statusCmd(): Promise<void> {
  const a = status('agent');
  const w = status('worker');
  const cfg = loadConfig();
  console.log(
    `agent:     ${a.running ? pc.green('running') : pc.red('stopped')}  pid=${a.pid ?? '-'}  :${cfg.agent.port}`
  );
  console.log(
    `worker:    ${w.running ? pc.green('running') : pc.red('stopped')}  pid=${w.pid ?? '-'}`
  );
}
