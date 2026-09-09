import { useTranslation } from 'react-i18next';
import type { MobileProject } from './types.ts';
import { COLORS, screen, topBar, body, secondaryButton, label } from './styles.ts';

export interface MobileSpawnPickerProps {
  projects: MobileProject[];
  onCancel: () => void;
  onSpawn: (cwd: string) => void;
}

/**
 * Where a phone-started shell should run.
 *
 * The same allowlist the ticket composer uses, for the same reason: the server
 * will not hand a device an arbitrary path, and a phone has no business
 * browsing the disk to find one.
 */
export function MobileSpawnPicker({ projects, onCancel, onSpawn }: MobileSpawnPickerProps) {
  const { t } = useTranslation();
  return (
    <div style={screen}>
      <div style={topBar}>
        <button style={{ ...secondaryButton, padding: '0 12px' }} onClick={onCancel}>{t('mobile.back')}</button>
        <span style={{ fontSize: 17, fontWeight: 600 }}>{t('mobile.terminalNew')}</span>
      </div>
      <div style={body}>
        <span style={label}>{t('mobile.projectLabel')}</span>
        {projects.length === 0 ? (
          <p style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.6 }}>{t('mobile.noProjects')}</p>
        ) : (
          projects.map((project) => (
            <button
              key={project.path}
              aria-label={project.name}
              onClick={() => onSpawn(project.path)}
              style={{
                display: 'block', width: '100%', minHeight: 48, padding: '0 14px', marginBottom: 6,
                borderRadius: 10, textAlign: 'left', cursor: 'pointer',
                border: `1px solid ${COLORS.border}`, background: COLORS.surface,
                color: COLORS.text, fontSize: 15,
              }}
            >
              {project.name}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
