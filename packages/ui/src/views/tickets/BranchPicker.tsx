import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  branchErrorKey, checkoutBranch, createBranch, deleteBranch, fetchBranches,
  type BranchList, type BranchResult,
} from './branchApi.ts';

interface BranchPickerProps {
  /** Checkout to operate on. Empty until a folder is chosen. */
  cwd: string;
  /** Called after any successful branch change, with the branch now checked out. */
  onChanged?: (branch: string) => void;
}

/**
 * Which branch the next ticket runs on.
 *
 * A ticket has always run in whatever branch the folder happened to be on, with
 * no way to see or change that from here — so "start this in a new branch" meant
 * leaving the app. This states the current branch, moves between existing ones,
 * and creates one from the branch you are on.
 *
 * It never forces anything through: switching with uncommitted changes and
 * deleting unmerged work are both refused by the server, and the reason is shown
 * rather than worked around.
 */
export function BranchPicker({ cwd, onChanged }: BranchPickerProps) {
  const { t } = useTranslation();
  const [list, setList] = useState<BranchList | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const reload = useCallback(async (path: string) => {
    const next = await fetchBranches(path);
    setList(next);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!cwd) {
      setList(null);
      setLoaded(false);
      return;
    }
    setLoaded(false);
    setError(null);
    setCreating(false);
    void reload(cwd);
  }, [cwd, reload]);

  /** Run one branch operation, then re-read so the row reflects reality. */
  const apply = async (op: () => Promise<BranchResult>) => {
    setBusy(true);
    setError(null);
    const result = await op();
    if (result.ok) {
      setCreating(false);
      setNewName('');
      await reload(cwd);
      if (result.branch) onChanged?.(result.branch);
    } else {
      setError(t(branchErrorKey(result.code), { name: result.name, message: result.message }));
    }
    setBusy(false);
  };

  if (!cwd || !loaded) return null;
  if (!list) {
    return <Hint text={t('git.notARepoHint')} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary, #8b949e)' }}>
          {t('git.label')}
        </span>
        <select
          data-testid="branch-select"
          aria-label={t('git.label')}
          value={list.current ?? ''}
          disabled={busy}
          onChange={(e) => void apply(() => checkoutBranch(cwd, e.target.value))}
          style={selectStyle}
        >
          {list.current === null && <option value="">{t('git.detached')}</option>}
          {list.branches.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>

        {!creating && (
          <button
            type="button"
            data-testid="branch-new"
            disabled={busy}
            onClick={() => setCreating(true)}
            style={ghostBtn}
          >
            + {t('git.create')}
          </button>
        )}

        {list.current && list.branches.length > 1 && (
          <button
            type="button"
            data-testid="branch-delete"
            disabled={busy}
            onClick={() => {
              // Which branch to drop is ambiguous from a single button, so this
              // acts on the selection you can see — never on the current one,
              // which the server refuses anyway.
              const target = list.branches.find((b) => b !== list.current);
              if (!target) return;
              if (!window.confirm(t('git.deleteConfirm', { name: target }))) return;
              void apply(() => deleteBranch(cwd, target));
            }}
            style={ghostBtn}
          >
            {t('git.delete')}
          </button>
        )}

        {busy && <span style={{ fontSize: 11, color: 'var(--text-secondary, #8b949e)' }}>{t('git.switching')}</span>}
      </div>

      {creating && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            data-testid="branch-name"
            autoFocus
            value={newName}
            placeholder={t('git.namePlaceholder')}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              // A Korean IME commits its last syllable with an Enter that also
              // reaches keydown; submitting there duplicates the character.
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void apply(() => createBranch(cwd, newName.trim(), list.current ?? undefined));
              }
              if (e.key === 'Escape') setCreating(false);
            }}
            style={{
              flex: 1, minWidth: 0, padding: '5px 8px', fontSize: 12,
              background: 'var(--bg-primary, #0d1117)', color: 'var(--text-primary, #e6edf3)',
              border: '1px solid var(--border-default, #30363d)', borderRadius: 8, outline: 'none',
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--text-secondary, #8b949e)', whiteSpace: 'nowrap' }}>
            {t('git.createFrom', { name: list.current ?? '' })}
          </span>
          <button
            type="button"
            data-testid="branch-create-submit"
            disabled={busy || newName.trim().length === 0}
            onClick={() => void apply(() => createBranch(cwd, newName.trim(), list.current ?? undefined))}
            style={ghostBtn}
          >
            {t('git.create')}
          </button>
        </div>
      )}

      {list.dirty && <Hint text={t('git.dirtyHint')} />}
      {error && (
        <div data-testid="branch-error" style={{ fontSize: 11, color: 'var(--accent-red, #f85149)' }}>
          {error}
        </div>
      )}
    </div>
  );
}

function Hint({ text }: { text: string }) {
  return (
    <div data-testid="branch-hint" style={{ fontSize: 11, color: 'var(--text-secondary, #8b949e)', opacity: 0.8 }}>
      {text}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: '5px 8px',
  fontSize: 12,
  fontFamily: 'var(--font-mono, monospace)',
  background: 'var(--bg-primary, #0d1117)',
  color: 'var(--text-primary, #e6edf3)',
  border: '1px solid var(--border-default, #30363d)',
  borderRadius: 8,
  maxWidth: 220,
};

const ghostBtn: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 11,
  fontWeight: 600,
  background: 'transparent',
  color: 'var(--text-secondary, #8b949e)',
  border: '1px solid var(--border-default, #30363d)',
  borderRadius: 8,
  cursor: 'pointer',
};
