import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Paths {
  root: string;
  dbFile: string;
  configFile: string;
  queueFile: string;
  queueOffsetFile: string;
  agentPid: string;
  agentLog: string;
  workerPid: string;
  workerLog: string;
  rulesCacheFile: string;
  claudeSettings: string;
}

export function getPaths(rootOverride?: string): Paths {
  const root = rootOverride ?? process.env.THINK_PROMPT_HOME ?? join(homedir(), '.think-prompt');
  return {
    root,
    dbFile: join(root, 'prompts.db'),
    configFile: join(root, 'config.json'),
    queueFile: join(root, 'queue.jsonl'),
    queueOffsetFile: join(root, 'queue.offset'),
    agentPid: join(root, 'agent.pid'),
    agentLog: join(root, 'agent.log'),
    workerPid: join(root, 'worker.pid'),
    workerLog: join(root, 'worker.log'),
    rulesCacheFile: join(root, 'rules-cache.json'),
    claudeSettings:
      process.env.THINK_PROMPT_CLAUDE_SETTINGS ?? join(homedir(), '.claude', 'settings.json'),
  };
}
