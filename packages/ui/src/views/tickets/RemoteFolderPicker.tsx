import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { SshTarget } from '@claude-alive/core';
import { loadRecentFolders, pushRecentFolder, removeRecentFolder } from '../chat/recentFolders.ts';

/**
 * Remote (SSH) folder picker for the ticket form. Browses the remote host's
 * directories via `POST /api/ssh/browse` (the server runs `ssh host ls`), so an
 * SSH ticket gets a real, server-validated remote absolute path instead of a
 * hand-typed one.
 *
 * Mirrors the local `FolderPicker` design 1:1 (header → recent-folders shortcuts
 * → browse → footer). Recent history is namespaced per host (`user@host:port`)
 * so a remote path is never offered as a shortcut on the wrong machine.
 */
const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;

function pathBasename(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;
}

interface RemoteFolderPickerProps {
  ssh: SshTarget;
  onSelect: (absPath: string) => void;
  onClose: () => void;
}

export function RemoteFolderPicker({ ssh, onSelect, onClose }: RemoteFolderPickerProps) {
  const { t } = useTranslation();
  // Depend on the primitive fields, not the `ssh` object — the parent passes a
  // fresh object literal each render, which would otherwise recreate `browse`
  // and loop the effect (perpetual loading).
  const { host, user, port, identityFile } = ssh;
  // Per-host recents namespace: the same absolute path means different folders
  // on different machines, so each host keeps its own shortcut history.
  const scope = `${user ?? ''}@${host}:${port ?? 22}`;

  const [path, setPath] = useState('');
  const [dirs, setDirs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>(() => loadRecentFolders(scope));

  const browse = useCallback(
    (target?: string) => {
      setLoading(true);
      setError(null);
      fetch(`${API_BASE}/api/ssh/browse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ssh: { host, user, port, identityFile }, path: target }),
      })
        .then((r) => r.json())
        .then((data: { path?: string; dirs?: string[]; error?: string }) => {
          if (data.error) {
            setError(data.error);
            return;
          }
          setPath(data.path ?? '');
          setDirs(data.dirs ?? []);
        })
        .catch(() => setError('connection failed'))
        .finally(() => setLoading(false));
    },
    [host, user, port, identityFile],
  );

  useEffect(() => {
    browse(undefined); // home
  }, [browse]);

  const pick = useCallback(
    (p: string) => {
      if (!p) return;
      setRecent(pushRecentFolder(p, scope));
      onSelect(p);
      onClose();
    },
    [onSelect, onClose, scope],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const join = (base: string, name: string) => `${base.replace(/\/$/, '')}/${name}`;
  const parent = path.replace(/\/[^/]+\/?$/, '') || '/';

  const monoPath: React.CSSProperties = {
    flex: 1,
    fontSize: 11,
    fontFamily: 'var(--font-mono, monospace)',
    color: 'var(--text-primary, #e6edf3)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    direction: 'rtl',
    textAlign: 'left',
  };

  const sectionLabel: React.CSSProperties = {
    padding: '8px 16px 4px',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-secondary)',
    opacity: 0.5,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  };

  return createPortal(
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, 92vw)',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-secondary, #161b22)',
          border: '1px solid var(--border-default, #30363d)',
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border-color, #30363d)' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #e6edf3)' }}>
            {t('tickets.remotePickerTitle')} <span style={{ color: 'var(--accent-purple, #bc8cff)' }}>⬈ {ssh.user ? `${ssh.user}@${ssh.host}` : ssh.host}</span>
          </span>
          <button type="button" onClick={onClose} aria-label={t('tickets.close')} style={{ background: 'none', border: 'none', color: 'var(--text-secondary, #8b949e)', cursor: 'pointer', fontSize: 16, padding: '2px 6px' }}>
            ×
          </button>
        </div>

        {/* Recent folders (per-host shortcuts) */}
        {recent.length > 0 && (
          <div style={{ borderBottom: '1px solid var(--border-color, #30363d)' }}>
            <div style={sectionLabel}>{t('terminal.menu.recentFolders')}</div>
            <div style={{ overflowY: 'auto', maxHeight: 180 }}>
              {recent.map((cwd) => (
                <div
                  key={cwd}
                  style={{ display: 'flex', alignItems: 'center', width: '100%', transition: 'background 0.15s ease' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(63, 185, 80, 0.08)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <button
                    type="button"
                    onClick={() => pick(cwd)}
                    title={cwd}
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '7px 16px',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      color: 'var(--text-primary, #e6edf3)',
                      minWidth: 0,
                    }}
                  >
                    <span style={{ fontSize: 12, color: 'var(--accent-green, #3fb950)' }}>⟲</span>
                    <span style={{ fontSize: 12, fontWeight: 500, flexShrink: 0 }}>{pathBasename(cwd)}</span>
                    <span
                      style={{
                        fontSize: 10,
                        color: 'var(--text-secondary, #8b949e)',
                        opacity: 0.45,
                        fontFamily: 'var(--font-mono, monospace)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        minWidth: 0,
                      }}
                    >
                      {cwd}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRecent(removeRecentFolder(cwd, scope));
                    }}
                    title={t('terminal.menu.removeRecentFolder')}
                    aria-label={t('terminal.menu.removeRecentFolder')}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-secondary, #8b949e)',
                      opacity: 0.4,
                      cursor: 'pointer',
                      fontSize: 12,
                      padding: '4px 12px',
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = '0.9';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = '0.4';
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Browse */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={sectionLabel}>{t('terminal.browseSection')}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderBottom: '1px solid var(--border-color, #30363d)' }}>
            {path && path !== '/' && (
              <button type="button" onClick={() => browse(parent)} title={t('terminal.parentDir')} style={{ background: 'none', border: 'none', color: 'var(--text-secondary, #8b949e)', cursor: 'pointer', fontSize: 14, padding: '2px 6px', flexShrink: 0 }}>
                ←
              </button>
            )}
            <div style={monoPath}>
              <span dir="ltr">{path || '…'}</span>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', minHeight: 120, maxHeight: 320 }}>
            {loading ? (
              <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-secondary, #8b949e)' }}>…</div>
            ) : error ? (
              <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--accent-red, #f85149)', lineHeight: 1.5 }}>{error}</div>
            ) : dirs.length === 0 ? (
              <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-secondary, #8b949e)', opacity: 0.5 }}>{t('terminal.emptyDir')}</div>
            ) : (
              dirs.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => browse(join(path, name))}
                  onDoubleClick={() => pick(join(path, name))}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--text-primary, #e6edf3)', fontSize: 12 }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ opacity: 0.5, fontSize: 11 }}>📁</span>
                  <span>{name}</span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Footer: use the currently-browsed folder */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderTop: '1px solid var(--border-color, #30363d)' }}>
          <span style={{ ...monoPath, color: 'var(--text-secondary, #8b949e)' }}>
            <span dir="ltr">{path}</span>
          </span>
          <button
            type="button"
            onClick={() => pick(path)}
            disabled={!path}
            style={{
              fontSize: 13,
              fontWeight: 600,
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              background: path ? 'var(--accent-blue, #58a6ff)' : 'var(--bg-tertiary, #21262d)',
              color: path ? '#0d1117' : 'var(--text-secondary, #8b949e)',
              cursor: path ? 'pointer' : 'not-allowed',
              whiteSpace: 'nowrap',
            }}
          >
            {t('tickets.useThisFolder')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
