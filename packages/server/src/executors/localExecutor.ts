/**
 * LocalExecutor — runs the agent as a local `claude` child process, validating
 * the cwd against the local filesystem and the optional allowlist. This is the
 * behaviour tickets have always had, now behind the Executor interface.
 */
import { existsSync, realpathSync } from 'node:fs';
import { probeLocalClaudeHelp, runHeadlessClaude } from '../headlessClaude.js';
import { isCwdAllowed } from '../ticketRunner.js';
import { createFlagSupportCache, type FlagSupportCache } from '../agentFlags.js';
import { spawnWithFlagGuard } from './flagGuard.js';
import { sessionIdReporter } from './sessionReporter.js';
import type { Executor, AgentSpawnRequest } from './types.js';

export interface LocalExecutorOptions {
  /** cwd allowlist; empty/undefined = unrestricted. */
  allowedRoots?: readonly string[];
  /** Injectable for tests. Defaults to fs.existsSync. */
  cwdExists?: (path: string) => boolean;
  /** Injectable for tests. Defaults to fs.realpathSync. */
  canonicalize?: (path: string) => string;
  /** Injectable `claude --help` probe for run-flag capability detection. */
  probeHelp?: () => Promise<string>;
  /** Shared probe cache; a private one is created when omitted. */
  flagCache?: FlagSupportCache;
}

export function createLocalExecutor(options: LocalExecutorOptions = {}): Executor {
  const cwdExists = options.cwdExists ?? existsSync;
  const canonicalize = options.canonicalize ?? ((p: string) => realpathSync(p));
  const allowedRoots = options.allowedRoots;
  const probeHelp = options.probeHelp ?? probeLocalClaudeHelp;
  const flagCache = options.flagCache ?? createFlagSupportCache();

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
      return spawnWithFlagGuard({
        cacheKey: 'local',
        cache: flagCache,
        probe: probeHelp,
        requested: req.run ?? {},
        onResolved: req.onFlagsResolved,
        spawnWith: (flags) =>
          runHeadlessClaude({
            goal: req.goal,
            cwd: req.cwd,
            permissionMode: req.permissionMode,
            resumeSessionId: req.resumeSessionId,
            pathPrepend: req.pathPrepend,
            extraEnv: req.extraEnv,
            flags,
            ...(req.onSessionId ? { onEvent: sessionIdReporter(req.onSessionId) } : {}),
          }),
      });
    },
  };
}
