const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;

export interface BranchList {
  current: string | null;
  branches: string[];
  dirty: boolean;
}

/** Codes the server returns instead of prose, so the UI owns every string. */
export type BranchErrorCode =
  | 'name-empty' | 'name-whitespace' | 'name-too-long' | 'name-reserved' | 'name-edges'
  | 'not-a-repo' | 'no-such-branch' | 'already-exists' | 'dirty' | 'delete-current'
  | 'git-failed' | 'network';

export interface BranchResult {
  ok: boolean;
  branch?: string;
  code?: BranchErrorCode;
  name?: string;
  message?: string;
}

/** Translation key for a refusal code. Git's own words ride along in `message`. */
const ERROR_KEY: Record<BranchErrorCode, string> = {
  'name-empty': 'git.error.nameEmpty',
  'name-whitespace': 'git.error.nameWhitespace',
  'name-too-long': 'git.error.nameTooLong',
  'name-reserved': 'git.error.nameReserved',
  'name-edges': 'git.error.nameEdges',
  'not-a-repo': 'git.error.notARepo',
  'no-such-branch': 'git.error.noSuchBranch',
  'already-exists': 'git.error.alreadyExists',
  dirty: 'git.error.dirty',
  'delete-current': 'git.error.deleteCurrent',
  'git-failed': 'git.error.gitFailed',
  network: 'git.error.network',
};

export function branchErrorKey(code: BranchErrorCode | undefined): string {
  return code ? ERROR_KEY[code] : ERROR_KEY.network;
}

const NETWORK: BranchResult = { ok: false, code: 'network' };

/** Branches for a checkout, or null when it is not a repository (or unreachable). */
export async function fetchBranches(cwd: string): Promise<BranchList | null> {
  try {
    const res = await fetch(`${API_BASE}/api/git/branches?cwd=${encodeURIComponent(cwd)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { branches: BranchList | null };
    return data.branches;
  } catch {
    return null;
  }
}

async function send(path: string, method: 'POST' | 'DELETE', body: unknown): Promise<BranchResult> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return NETWORK;
    const data = (await res.json()) as { result: BranchResult };
    return data.result;
  } catch {
    return NETWORK;
  }
}

export function checkoutBranch(cwd: string, name: string): Promise<BranchResult> {
  return send('/api/git/checkout', 'POST', { cwd, name });
}

export function createBranch(cwd: string, name: string, from?: string): Promise<BranchResult> {
  return send('/api/git/branches', 'POST', { cwd, name, ...(from ? { from } : {}) });
}

export function deleteBranch(cwd: string, name: string): Promise<BranchResult> {
  return send('/api/git/branches', 'DELETE', { cwd, name });
}
