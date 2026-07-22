import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { loadRecentFolders, pushRecentFolder, removeRecentFolder } from '../chat/recentFolders.ts';

/**
 * Local project-folder picker for the ticket form.
 *
 * Reuses the exact same logic the terminal uses to choose a working directory:
 * the `/api/fs/browse` endpoint for directory navigation and the shared
 * `recentFolders` store for quick access. Selecting a folder yields a real,
 * server-validated absolute path — so a ticket never launches against a typo'd
 * or non-existent cwd the way a free-text input allowed.
 */

const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;

function pathBasename(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;
}

interface FolderPickerProps {
  /** Called with the chosen absolute path; the folder is also pushed to recents. */
  onSelect: (absPath: string) => void;
  onClose: () => void;
}

export function FolderPicker({ onSelect, onClose }: FolderPickerProps) {
  const { t } = useTranslation();
  const [dirs, setDirs] = useState<{ name: string; path: string }[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => loadRecentFolders());

  const browse = useCallback((dir: string) => {
    setLoading(true);
    fetch(`${API_BASE}/api/fs/browse?dir=${encodeURIComponent(dir)}`)
      .then((r) => r.json())
      .then((data: { path: string; dirs: { name: string; path: string }[] }) => {
        setCurrentPath(data.path);
        setDirs(data.dirs);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    browse('~');
  }, [browse]);

  const pick = useCallback(
    (path: string) => {
      if (!path) return;
      setRecent(pushRecentFolder(path));
      onSelect(path);
      onClose();
    },
    [onSelect, onClose],
  );

  // Esc closes the picker.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
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
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-color, #30363d)',
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #e6edf3)' }}>
            {t('tickets.pickerTitle')}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('tickets.close')}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary, #8b949e)',
              cursor: 'pointer',
              fontSize: 16,
              padding: '2px 6px',
            }}
          >
            ×
          </button>
        </div>

        {/* Recent folders */}
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
                      setRecent(removeRecentFolder(cwd));
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
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              borderBottom: '1px solid var(--border-color, #30363d)',
            }}
          >
            {currentPath !== '/' && (
              <button
                type="button"
                onClick={() => browse(currentPath.replace(/\/[^/]+\/?$/, '') || '/')}
                title={t('terminal.parentDir')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary, #8b949e)',
                  cursor: 'pointer',
                  fontSize: 14,
                  padding: '2px 6px',
                  flexShrink: 0,
                }}
              >
                ←
              </button>
            )}
            <div
              style={{
                flex: 1,
                fontSize: 11,
                fontFamily: 'var(--font-mono, monospace)',
                color: 'var(--text-primary, #e6edf3)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                direction: 'rtl',
                textAlign: 'left',
              }}
            >
              <span dir="ltr">{currentPath}</span>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', minHeight: 120, maxHeight: 320 }}>
            {loading ? (
              <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-secondary, #8b949e)' }}>…</div>
            ) : dirs.length === 0 ? (
              <div
                style={{
                  padding: 16,
                  textAlign: 'center',
                  fontSize: 12,
                  color: 'var(--text-secondary, #8b949e)',
                  opacity: 0.5,
                }}
              >
                {t('terminal.emptyDir')}
              </div>
            ) : (
              dirs.map((dir) => (
                <button
                  key={dir.path}
                  type="button"
                  onClick={() => browse(dir.path)}
                  onDoubleClick={() => pick(dir.path)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 16px',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.15s ease',
                    color: 'var(--text-primary, #e6edf3)',
                    fontSize: 12,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <span style={{ opacity: 0.5, fontSize: 11 }}>📁</span>
                  <span>{dir.name}</span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Footer: use the currently-browsed folder */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            borderTop: '1px solid var(--border-color, #30363d)',
          }}
        >
          <span
            style={{
              flex: 1,
              fontSize: 11,
              fontFamily: 'var(--font-mono, monospace)',
              color: 'var(--text-secondary, #8b949e)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              direction: 'rtl',
              textAlign: 'left',
            }}
          >
            <span dir="ltr">{currentPath}</span>
          </span>
          <button
            type="button"
            onClick={() => pick(currentPath)}
            disabled={!currentPath}
            style={{
              fontSize: 13,
              fontWeight: 600,
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              background: currentPath ? 'var(--accent-blue, #58a6ff)' : 'var(--bg-tertiary, #21262d)',
              color: currentPath ? '#0d1117' : 'var(--text-secondary, #8b949e)',
              cursor: currentPath ? 'pointer' : 'not-allowed',
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
