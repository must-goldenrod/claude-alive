/**
 * SSH connection presets stored in localStorage.
 *
 * Security note: passwords are NEVER stored. The preset only holds the command
 * (e.g. `ssh studio`) — the user still answers any password prompt manually
 * in the pty, or relies on ssh-agent / key-based auth / ~/.ssh/config.
 */

const STORAGE_KEY = 'claude-alive:ssh-presets:v1';

export interface SSHPreset {
  id: string;
  label: string;
  command: string;
  /** Optional structured fields — kept for re-editing in the dialog. */
  host?: string;
  user?: string;
  port?: number;
  identityFile?: string;
  autoRun: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SSHPresetDraft {
  label: string;
  command: string;
  host?: string;
  user?: string;
  port?: number;
  identityFile?: string;
  autoRun: boolean;
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ssh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isSSHPreset(v: unknown): v is SSHPreset {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    typeof p.label === 'string' &&
    typeof p.command === 'string' &&
    typeof p.autoRun === 'boolean' &&
    typeof p.createdAt === 'number' &&
    typeof p.updatedAt === 'number'
  );
}

export function loadPresets(): SSHPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSSHPreset);
  } catch {
    return [];
  }
}

function persist(presets: SSHPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // localStorage may be full or disabled (private mode) — fail silently.
  }
}

export function createPreset(draft: SSHPresetDraft): SSHPreset {
  const now = Date.now();
  const preset: SSHPreset = {
    id: randomId(),
    label: draft.label.trim(),
    command: draft.command.trim(),
    host: draft.host?.trim() || undefined,
    user: draft.user?.trim() || undefined,
    port: draft.port,
    identityFile: draft.identityFile?.trim() || undefined,
    autoRun: draft.autoRun,
    createdAt: now,
    updatedAt: now,
  };
  const next = [...loadPresets(), preset];
  persist(next);
  return preset;
}

export function updatePreset(id: string, draft: SSHPresetDraft): SSHPreset | null {
  const all = loadPresets();
  const idx = all.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const existing = all[idx]!;
  const updated: SSHPreset = {
    ...existing,
    label: draft.label.trim(),
    command: draft.command.trim(),
    host: draft.host?.trim() || undefined,
    user: draft.user?.trim() || undefined,
    port: draft.port,
    identityFile: draft.identityFile?.trim() || undefined,
    autoRun: draft.autoRun,
    updatedAt: Date.now(),
  };
  const next = [...all.slice(0, idx), updated, ...all.slice(idx + 1)];
  persist(next);
  return updated;
}

export function deletePreset(id: string): void {
  const next = loadPresets().filter((p) => p.id !== id);
  persist(next);
}

/** Build an `ssh` command string from structured fields. */
export function buildSSHCommand(fields: {
  host: string;
  user?: string;
  port?: number;
  identityFile?: string;
}): string {
  const parts: string[] = ['ssh'];
  if (fields.identityFile && fields.identityFile.trim()) {
    parts.push('-i', shellQuote(fields.identityFile.trim()));
  }
  if (fields.port && fields.port !== 22) {
    parts.push('-p', String(fields.port));
  }
  const target = fields.user?.trim()
    ? `${fields.user.trim()}@${fields.host.trim()}`
    : fields.host.trim();
  parts.push(target);
  return parts.join(' ');
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@~-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
