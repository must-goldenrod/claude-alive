/**
 * Backend registry for the onboarding surface (spec §4).
 *
 * Lists the execution/delegation backends the user can connect and runs live
 * connectivity checks. `claude-local` is the local orchestrator; `litellm` is a
 * sub-agent delegation target; `ssh` is a remote location (checked per-host at
 * ticket time, so listed but not probed here).
 */
import type { BackendId, BackendStatus } from '@claude-alive/core';
import type { LitellmClient } from './litellmClient.js';

export interface BackendRegistryDeps {
  /** Present when LITELLM_KEY is configured. */
  litellm?: LitellmClient;
  /** True when at least one SSH host is registered (presets are browser-side, so this is a hint). */
  sshConfigured?: boolean;
  /** Resolve the local `claude` binary; returns null when not found. */
  findClaude?: () => string | null;
}

export interface BackendRegistry {
  list(): BackendStatus[];
  check(id: BackendId): Promise<BackendStatus>;
}

export function createBackendRegistry(deps: BackendRegistryDeps): BackendRegistry {
  function base(id: BackendId): BackendStatus {
    switch (id) {
      case 'claude-local':
        return { id, label: 'Claude (local)', kind: 'orchestrator' };
      case 'litellm':
        return { id, label: 'litellm', kind: 'subagent' };
      case 'ssh':
        return { id, label: 'SSH host', kind: 'location' };
    }
  }

  return {
    list() {
      const items: BackendStatus[] = [base('claude-local')];
      if (deps.litellm) items.push(base('litellm'));
      items.push({ ...base('ssh'), detail: 'register & check hosts below' });
      return items;
    },

    async check(id) {
      const b = base(id);
      if (id === 'claude-local') {
        const path = deps.findClaude?.() ?? null;
        return { ...b, connected: Boolean(path), detail: path ?? 'claude not found on PATH' };
      }
      if (id === 'litellm') {
        if (!deps.litellm) return { ...b, connected: false, detail: 'LITELLM_KEY not configured' };
        const r = await deps.litellm.checkConnection();
        return r.ok
          ? { ...b, connected: true, models: r.models, detail: `${r.models?.length ?? 0} models` }
          : { ...b, connected: false, detail: r.error };
      }
      // ssh is validated per-host at ticket time.
      return { ...b, connected: undefined, detail: 'checked per-host when a ticket runs' };
    },
  };
}
