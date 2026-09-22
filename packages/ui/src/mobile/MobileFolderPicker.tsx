import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { projectName } from '../views/tickets/ticketDisplay.ts';
import { COLORS, TYPE, clamp1, label, secondaryButton } from './styles.ts';
import { loadRecentProjects, type RecentProject } from './recentProjects.ts';
import { fetchBrowse, BrowseUnavailable, type BrowseResult } from './remoteBrowseClient.ts';
import { formatStamp } from './time.ts';
import type { MobileProject } from './types.ts';

const API_BASE = `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3141'}`;

export interface MobileFolderPickerProps {
  /** The server's allowlist, or the directories tickets have run in. */
  projects: MobileProject[];
  onPick: (project: MobileProject) => void;
  /** Highlighted as the current choice. */
  selected?: string;
}

const row = (active: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  minHeight: 48,
  padding: '0 12px',
  marginBottom: 6,
  borderRadius: 10,
  textAlign: 'left',
  cursor: 'pointer',
  border: `1px solid ${active ? COLORS.accent : COLORS.border}`,
  background: COLORS.surface,
  color: COLORS.text,
  fontSize: 15,
});

/**
 * Where work should happen: recently used first, then the allowlist, then the
 * disk.
 *
 * The flat allowlist was the only answer the phone had, and it is one level
 * deep — the checkout someone wants is often two or three below a root, and
 * simply could not be reached from a phone. Browsing fixes that; the recents
 * above it mean that after the first time, nobody has to browse again.
 */
export function MobileFolderPicker({ projects, onPick, selected }: MobileFolderPickerProps) {
  const { t } = useTranslation();
  const [recents, setRecents] = useState<RecentProject[]>(() => loadRecentProjects());
  const [browsing, setBrowsing] = useState(false);
  const [dir, setDir] = useState<BrowseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An older server has no browse route; the button is hidden rather than
  // offered and then failing.
  const [supported, setSupported] = useState(true);

  useEffect(() => { setRecents(loadRecentProjects()); }, []);

  const go = useCallback(async (path: string | null) => {
    setBusy(true);
    setError(null);
    try {
      setDir(await fetchBrowse(API_BASE, path));
      setBrowsing(true);
    } catch (err) {
      if (err instanceof BrowseUnavailable) {
        setSupported(false);
        setBrowsing(false);
      } else {
        setError(err instanceof Error ? err.message : t('mobile.browseFailed'));
      }
    } finally {
      setBusy(false);
    }
  }, [t]);

  // Probe once so the entry point only appears on a server that has it.
  useEffect(() => {
    let cancelled = false;
    fetchBrowse(API_BASE, null)
      .then(() => { if (!cancelled) setSupported(true); })
      .catch((err: unknown) => { if (!cancelled && err instanceof BrowseUnavailable) setSupported(false); });
    return () => { cancelled = true; };
  }, []);

  const pick = (path: string, name?: string) => onPick({ path, name: name || projectName(path) });

  if (browsing) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <button style={{ ...secondaryButton, padding: '0 12px' }} onClick={() => setBrowsing(false)}>
            {t('mobile.browseClose')}
          </button>
          <span style={{ ...TYPE.meta, ...clamp1, color: COLORS.muted, direction: 'rtl', textAlign: 'left' }}>
            {dir?.path ?? t('mobile.browseRoots')}
          </span>
        </div>

        {dir?.path && (
          <button
            style={{ ...row(true), justifyContent: 'center', fontWeight: 600 }}
            onClick={() => pick(dir.path!)}
          >
            {t('mobile.browsePickHere')}
          </button>
        )}

        {dir?.parent && (
          <button style={row(false)} onClick={() => void go(dir.parent)}>
            <span aria-hidden="true">↰</span>
            {t('mobile.browseUp')}
          </button>
        )}

        {busy && <p style={{ ...TYPE.meta, color: COLORS.muted }}>{t('mobile.browseLoading')}</p>}
        {error && <p style={{ ...TYPE.meta, color: 'var(--accent-red)' }}>{error}</p>}

        {!busy && dir?.entries.length === 0 && (
          <p style={{ ...TYPE.meta, color: COLORS.muted }}>{t('mobile.browseEmpty')}</p>
        )}

        {dir?.entries.map((entry) => (
          <div key={entry.path} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <button
              style={{ ...row(false), marginBottom: 0, flex: 1, minWidth: 0 }}
              onClick={() => void go(entry.path)}
            >
              <span style={{ ...clamp1, flex: 1 }}>{entry.name}</span>
              {entry.isGit && <span style={{ ...TYPE.badge, color: COLORS.accent }}>git</span>}
              <span aria-hidden="true" style={{ color: COLORS.muted }}>›</span>
            </button>
            <button
              aria-label={t('mobile.browseSelectEntry', { name: entry.name })}
              style={{ ...secondaryButton, minHeight: 48, padding: '0 12px', flexShrink: 0 }}
              onClick={() => pick(entry.path, entry.name)}
            >
              {t('mobile.browseSelect')}
            </button>
          </div>
        ))}

        {dir?.truncated && <p style={{ ...TYPE.meta, color: COLORS.muted }}>{t('mobile.browseTruncated')}</p>}
      </div>
    );
  }

  return (
    <div>
      {recents.length > 0 && (
        <>
          <span style={label}>{t('mobile.recentFolders')}</span>
          {recents.map((recent) => (
            <button
              key={recent.path}
              aria-label={recent.name}
              style={row(recent.path === selected)}
              onClick={() => pick(recent.path, recent.name)}
            >
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                <span style={clamp1}>{recent.name}</span>
                <span style={{ ...TYPE.meta, color: COLORS.muted }}>{formatStamp(recent.usedAt)}</span>
              </span>
            </button>
          ))}
        </>
      )}

      <span style={label}>{t('mobile.projectLabel')}</span>
      {projects.length === 0 ? (
        <p style={{ ...TYPE.body, color: COLORS.muted, lineHeight: 1.6 }}>{t('mobile.noProjects')}</p>
      ) : (
        projects.map((project) => (
          <button
            key={project.path}
            aria-label={project.name}
            style={row(project.path === selected)}
            onClick={() => pick(project.path, project.name)}
          >
            <span style={{ ...clamp1, flex: 1 }}>{project.name}</span>
          </button>
        ))
      )}

      {supported && (
        <button style={{ ...row(false), justifyContent: 'center' }} onClick={() => void go(null)}>
          {t('mobile.browseOpen')}
        </button>
      )}
    </div>
  );
}
