import '@testing-library/jest-dom/vitest';
import '@claude-alive/i18n';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { primaryFontName, isFontInstalled } from '../services/terminalFonts.ts';
import { DEFAULT_SETTINGS, FONT_PRESETS } from '../services/settings.ts';
import { TerminalFontPreview } from '../components/TerminalFontPreview.tsx';

afterEach(cleanup);

describe('terminal fonts', () => {
  it('reads the primary family from a CSS font list', () => {
    expect(primaryFontName('"Fira Code", ui-monospace, monospace')).toBe('Fira Code');
    expect(primaryFontName('Menlo, monospace')).toBe('Menlo');
  });

  it('gives every preset a real fallback stack', () => {
    for (const preset of FONT_PRESETS) {
      expect(preset.family).toContain('monospace');
      expect(preset.family.split(',').length).toBeGreaterThan(2);
    }
  });

  it('marks the open-licensed families as bundled and the OS families as not', () => {
    const bundled = FONT_PRESETS.filter((f) => f.bundled).map((f) => f.id);
    expect(bundled).toEqual(['jetbrains-mono', 'fira-code', 'cascadia-code', 'source-code-pro', 'ibm-plex-mono']);
  });

  it('reports unknown instead of guessing when it cannot measure text', () => {
    expect(isFontInstalled('Fira Code')).toBeNull();
  });

  it('renders the preview in the chosen font and size', () => {
    const terminal = { ...DEFAULT_SETTINGS.terminal, fontFamilyId: 'fira-code', fontSize: 16 };
    render(<TerminalFontPreview terminal={terminal} />);
    const preview = screen.getByTestId('terminal-font-preview');
    expect(preview.style.fontFamily).toContain('Fira Code');
    expect(preview.style.fontSize).toBe('16px');
    expect(preview).toHaveTextContent('claude --version');
  });
});
