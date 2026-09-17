import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FONT_PRESETS, resolveTerminalTheme, type AppSettings } from '../services/settings.ts';
import { isFontInstalled, loadTerminalFont, primaryFontName } from '../services/terminalFonts.ts';

/** Sample session shown in the preview — shell output, not UI copy, so it is not translated. */
const SAMPLE = {
  cwd: '~/projects/shop-web',
  modified: 'src/checkout/coupon.ts',
  untracked: 'tests/coupon.test.ts',
};

interface TerminalFontPreviewProps {
  terminal: AppSettings['terminal'];
}

/**
 * A few lines of a real-looking session rendered with the chosen font, size,
 * line height, letter spacing and colours — so a font choice is judged by eye
 * rather than by name. Includes the glyphs people check fonts by (0/O, 1/l/I).
 */
export function TerminalFontPreview({ terminal }: TerminalFontPreviewProps) {
  const { t } = useTranslation();
  const preset = FONT_PRESETS.find((f) => f.id === terminal.fontFamilyId) ?? FONT_PRESETS[0]!;
  const theme = resolveTerminalTheme(terminal.themeId, terminal.colorOverrides);
  const [installed, setInstalled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    setInstalled(null);
    void loadTerminalFont(preset.family, terminal.fontSize).then(() => {
      if (!cancelled) setInstalled(preset.bundled ? true : isFontInstalled(primaryFontName(preset.family)));
    });
    return () => {
      cancelled = true;
    };
  }, [preset.family, preset.bundled, terminal.fontSize]);

  const prompt = (
    <>
      <span style={{ color: theme.green }}>{SAMPLE.cwd}</span>
      <span style={{ color: theme.blue }}> $ </span>
    </>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        data-testid="terminal-font-preview"
        aria-label={t('settings.terminal.fontPreview')}
        style={{
          padding: `${terminal.paddingY}px ${terminal.paddingX}px`,
          borderRadius: 8,
          border: '1px solid var(--border-color)',
          background: theme.background === 'transparent' ? 'var(--bg-primary)' : theme.background,
          color: theme.foreground,
          fontFamily: preset.family,
          fontSize: terminal.fontSize,
          lineHeight: terminal.lineHeight,
          letterSpacing: `${terminal.letterSpacing}px`,
          whiteSpace: 'pre',
          overflowX: 'auto',
        }}
      >
        <div>{prompt}claude --version</div>
        <div>2.1.272 (Claude Code)</div>
        <div>{prompt}git status --short</div>
        <div><span style={{ color: theme.yellow }}> M</span> {SAMPLE.modified}</div>
        <div><span style={{ color: theme.red }}>??</span> {SAMPLE.untracked}</div>
        <div>0O Il1| {'{}'} [] () =&gt; != === &lt;= &gt;=</div>
        <div>
          {prompt}
          <span style={{ background: theme.cursor, color: theme.cursorAccent }}>&nbsp;</span>
        </div>
      </div>
      {installed === false && (
        <div role="note" style={{ fontSize: 11, color: 'var(--accent-orange, #d29922)' }}>
          {t('settings.terminal.fontNotInstalled', { font: preset.label })}
        </div>
      )}
    </div>
  );
}
