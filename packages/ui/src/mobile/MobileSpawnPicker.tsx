import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MobileProject } from './types.ts';
import { COLORS, screen, topBar, body, secondaryButton, TYPE } from './styles.ts';
import { MobileFolderPicker } from './MobileFolderPicker.tsx';
import { autoStartCommand } from './terminalPresets.ts';

export interface MobileSpawnOptions {
  /** Type the first preset as soon as the shell is ready. */
  autoStart: boolean;
}

export interface MobileSpawnPickerProps {
  projects: MobileProject[];
  onCancel: () => void;
  onSpawn: (cwd: string, options: MobileSpawnOptions) => void;
}

/**
 * Where a phone-started shell should run, and whether it should start Claude
 * for you.
 *
 * The allowlist used to be the whole picker, one level deep. It is now the
 * middle of three answers — recents, allowlist, then the disk under the ticket
 * roots — because the checkout someone wants on a phone is routinely deeper
 * than the allowlist reaches.
 */
export function MobileSpawnPicker({ projects, onCancel, onSpawn }: MobileSpawnPickerProps) {
  const { t } = useTranslation();
  const [autoStart, setAutoStart] = useState(true);

  return (
    <div style={screen}>
      <div style={topBar}>
        <button style={{ ...secondaryButton, padding: '0 12px' }} onClick={onCancel}>{t('mobile.back')}</button>
        <span style={TYPE.title}>{t('mobile.terminalNew')}</span>
      </div>
      <div style={body}>
        <button
          role="switch"
          aria-checked={autoStart}
          aria-label={t('mobile.spawnAutoStart')}
          onClick={() => setAutoStart(!autoStart)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 48,
            padding: '0 12px', marginBottom: 12, borderRadius: 10, cursor: 'pointer', textAlign: 'left',
            border: `1px solid ${COLORS.border}`, background: COLORS.surface, color: COLORS.text,
          }}
        >
          <span style={{ width: 36, height: 20, borderRadius: 999, flexShrink: 0, position: 'relative', background: autoStart ? COLORS.accent : COLORS.border }}>
            <span style={{ position: 'absolute', top: 2, left: autoStart ? 18 : 2, width: 16, height: 16, borderRadius: 999, background: 'var(--on-accent)' }} />
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={TYPE.button}>{t('mobile.spawnAutoStart')}</span>
            <span style={{ ...TYPE.meta, color: COLORS.muted, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {autoStartCommand()}
            </span>
          </span>
        </button>

        <MobileFolderPicker projects={projects} onPick={(project) => onSpawn(project.path, { autoStart })} />
      </div>
    </div>
  );
}
