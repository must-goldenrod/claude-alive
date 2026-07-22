/**
 * LocalExecutor — runs the agent as a local `claude` child process, validating
 * the cwd against the local filesystem and the optional allowlist. This is the
 * behaviour tickets have always had, now behind the Executor interface.
 */
import { existsSync, realpathSync } from 'node:fs';
import { runHeadlessClaude } from '../headlessClaude.js';
import { isCwdAllowed } from '../ticketRunner.js';
import type { Executor, AgentSpawnRequest } from './types.js';

export interface LocalExecutorOptions {
  /** cwd allowlist; empty/undefined = unrestricted. */
  allowedRoots?: readonly string[];
  /** Injectable for tests. Defaults to fs.existsSync. */
  cwdExists?: (path: string) => boolean;
  /** Injectable for tests. Defaults to fs.realpathSync. */
  canonicalize?: (path: string) => string;
}

export function createLocalExecutor(options: LocalExecutorOptions = {}): Executor {
  const cwdExists = options.cwdExists ?? existsSync;
  const canonicalize = options.canonicalize ?? ((p: string) => realpathSync(p));
  const allowedRoots = options.allowedRoots;

  return {
    async validateCwd(cwd) {
      if (!cwdExists(cwd)) return `working directory does not exist: ${cwd}`;
      let check = cwd;
      if (allowedRoots && allowedRoots.length > 0) {
        try {
          check = canonicalize(cwd);
        } catch {
          return `cwd does not resolve: ${cwd}`;
        }
      }
      if (!isCwdAllowed(check, allowedRoots)) return `cwd not in allowlist: ${cwd}`;
      return null;
    },
    spawn(req: AgentSpawnRequest) {
      return runHeadlessClaude({
        goal: req.goal,
        cwd: req.cwd,
        permissionMode: req.permissionMode,
        resumeSessionId: req.resumeSessionId,
      });
    },
  };
}
