import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TicketRunPreset } from '@claude-alive/core';
// The UI mirrors core's preset list rather than importing it: a runtime import
// from core's barrel drags `node:readline` into the browser bundle, which tsc
// accepts and the vite build rejects.
import { RUN_PRESET_IDS, DEFAULT_RUN_PRESET } from '../views/tickets/runPresets.ts';
import { COLORS, screen, topBar, body, primaryButton, secondaryButton, actionBar, input, label } from './styles.ts';
import type { MobileProject, MobileCreateFn } from './types.ts';

export type { MobileProject };

export interface MobileTicketComposeProps {
  projects: MobileProject[];
  onCancel: () => void;
  onCreate: MobileCreateFn;
}

/**
 * Three decisions, in the order they matter: what to do, where, how deep.
 *
 * The desktop composer lets you browse the filesystem for a directory; a phone
 * cannot be trusted with that (and the server refuses it remotely), so the
 * choice here is a list of the projects the operator allowlisted. With one
 * project there is nothing to choose and it is preselected.
 */
export function MobileTicketCompose({ projects, onCancel, onCreate }: MobileTicketComposeProps) {
  const { t } = useTranslation();
  const [goal, setGoal] = useState('');
  const [cwd, setCwd] = useState(projects.length === 1 ? projects[0]!.path : '');
  const [preset, setPreset] = useState<TicketRunPreset>(DEFAULT_RUN_PRESET);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = goal.trim().length > 0 && cwd.length > 0 && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    const message = await onCreate(goal.trim(), cwd, preset);
    setBusy(false);
    if (message) setError(message);
    else onCancel();
  };

  return (
    <div style={screen}>
      <div style={topBar}>
        <button style={{ ...secondaryButton, padding: '0 12px' }} onClick={onCancel}>{t('mobile.back')}</button>
        <span style={{ fontSize: 17, fontWeight: 600 }}>{t('mobile.composeTitle')}</span>
      </div>

      <div style={body}>
        <label style={label} htmlFor="mobile-goal">{t('mobile.goalLabel')}</label>
        <textarea
          id="mobile-goal"
          value={goal}
          rows={5}
          placeholder={t('mobile.goalPlaceholder')}
          onChange={(e) => setGoal(e.target.value)}
          style={{ ...input, resize: 'vertical', lineHeight: 1.5 }}
        />

        <div style={{ height: 20 }} />
        <span style={label}>{t('mobile.projectLabel')}</span>
        {projects.length === 0 ? (
          <p style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.6 }}>{t('mobile.noProjects')}</p>
        ) : (
          <div role="radiogroup" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {projects.map((project) => (
              <button
                key={project.path}
                role="radio"
                aria-checked={cwd === project.path}
                aria-label={project.name}
                onClick={() => setCwd(project.path)}
                style={{
                  minHeight: 48, padding: '0 14px', borderRadius: 10, textAlign: 'left', cursor: 'pointer',
                  border: `1px solid ${cwd === project.path ? COLORS.accent : COLORS.border}`,
                  background: COLORS.surface, color: COLORS.text, fontSize: 15,
                }}
              >
                {project.name}
              </button>
            ))}
          </div>
        )}

        <div style={{ height: 20 }} />
        <span style={label}>{t('mobile.presetLabel')}</span>
        <div role="radiogroup" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {RUN_PRESET_IDS.map((id) => (
            <button
              key={id}
              role="radio"
              aria-checked={preset === id}
              aria-label={t(`tickets.preset.${id}`)}
              onClick={() => setPreset(id)}
              style={{
                minHeight: 44, padding: '0 14px', borderRadius: 10, cursor: 'pointer', fontSize: 14,
                border: `1px solid ${preset === id ? COLORS.accent : COLORS.border}`,
                background: preset === id ? COLORS.accent : 'transparent',
                color: preset === id ? '#0d1117' : COLORS.text,
              }}
            >
              {t(`tickets.preset.${id}`)}
            </button>
          ))}
        </div>

        {error && (
          <p style={{ marginTop: 16, fontSize: 13, color: '#e5534b', lineHeight: 1.5 }}>{error}</p>
        )}
      </div>

      <div style={actionBar}>
        <button style={{ ...primaryButton, opacity: ready ? 1 : 0.4 }} disabled={!ready} onClick={submit}>
          {busy ? t('mobile.creating') : t('mobile.create')}
        </button>
      </div>
    </div>
  );
}
