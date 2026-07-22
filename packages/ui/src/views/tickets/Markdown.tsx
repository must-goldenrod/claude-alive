import type { ReactNode, CSSProperties } from 'react';

/**
 * Minimal, dependency-free markdown renderer for ticket results.
 * Supports: #/##/### headings, **bold**, `code`, ``` fenced blocks,
 * - / 1. lists, > blockquotes, GFM pipe tables, and paragraphs.
 * Unsupported syntax degrades to plain text (spec: "쓰인 문법을 반영한 프레임").
 */

const inlineCode: CSSProperties = {
  fontFamily: 'var(--font-mono, monospace)',
  fontSize: '0.88em',
  background: 'var(--bg-tertiary, #21262d)',
  borderRadius: 4,
  padding: '1px 5px',
};

/**
 * Ticket results are agent output over untrusted repo content, so a markdown
 * link scheme is untrusted. Allow only http/https/mailto; reject javascript:,
 * data:, vbscript:, etc. Returns the safe href, or null to render as plain text.
 */
function safeHref(raw: string): string | null {
  try {
    const u = new URL(raw, 'http://x.invalid/');
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:' ? raw : null;
  } catch {
    return null;
  }
}

function renderInline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2] !== undefined) out.push(<strong key={`${key}-b${i}`}>{m[2]}</strong>);
    else if (m[3] !== undefined)
      out.push(
        <code key={`${key}-c${i}`} style={inlineCode}>
          {m[3]}
        </code>,
      );
    else if (m[4] !== undefined) {
      const href = safeHref(m[5]);
      out.push(
        href ? (
          <a key={`${key}-a${i}`} href={href} target="_blank" rel="noreferrer noopener" style={{ color: 'var(--accent-blue, #58a6ff)' }}>
            {m[4]}
          </a>
        ) : (
          // Disallowed scheme (javascript:, data:, …) → render the label as text.
          <span key={`${key}-a${i}`}>{m[4]}</span>
        ),
      );
    }
    last = m.index + m[0].length;
    i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.trim().startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) buf.push(lines[i++]);
      i++; // closing fence
      blocks.push(
        <pre
          key={key++}
          style={{
            background: 'var(--bg-tertiary, #21262d)',
            borderRadius: 8,
            padding: 12,
            overflowX: 'auto',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          {buf.join('\n')}
        </pre>,
      );
      continue;
    }

    // Table: header row followed by a |---| separator
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(splitRow(lines[i++]));
      blocks.push(
        <div key={key++} style={{ overflowX: 'auto', margin: '4px 0' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                {header.map((h, hi) => (
                  <th key={hi} style={cellStyle(true)}>
                    {renderInline(h, `th${key}-${hi}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} style={cellStyle(false)}>
                      {renderInline(c, `td${key}-${ri}-${ci}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Headings
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const size = level === 1 ? 20 : level === 2 ? 16 : 14;
      blocks.push(
        <div key={key++} style={{ fontSize: size, fontWeight: 700, margin: '12px 0 4px', color: 'var(--text-primary, #e6edf3)' }}>
          {renderInline(h[2], `h${key}`)}
        </div>,
      );
      i++;
      continue;
    }

    // Lists (consecutive - / * / 1.)
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: string[] = [];
      const ordered = /^\s*\d+\.\s+/.test(line);
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''));
        i++;
      }
      const ListTag = ordered ? 'ol' : 'ul';
      blocks.push(
        <ListTag key={key++} style={{ margin: '4px 0', paddingLeft: 20, lineHeight: 1.6 }}>
          {items.map((it, ii) => (
            <li key={ii}>{renderInline(it, `li${key}-${ii}`)}</li>
          ))}
        </ListTag>,
      );
      continue;
    }

    // Blockquote
    if (line.trim().startsWith('>')) {
      blocks.push(
        <blockquote
          key={key++}
          style={{ borderLeft: '3px solid var(--border-default, #30363d)', paddingLeft: 12, margin: '6px 0', color: 'var(--text-secondary, #8b949e)' }}
        >
          {renderInline(line.replace(/^\s*>\s?/, ''), `q${key}`)}
        </blockquote>,
      );
      i++;
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph (merge consecutive non-empty, non-special lines)
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].trim().startsWith('|') &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith('>')
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} style={{ margin: '6px 0', lineHeight: 1.65 }}>
        {renderInline(para.join(' '), `p${key}`)}
      </p>,
    );
  }

  return <div style={{ color: 'var(--text-primary, #e6edf3)', fontSize: 14 }}>{blocks}</div>;
}

function cellStyle(header: boolean): CSSProperties {
  return {
    border: '1px solid var(--border-default, #30363d)',
    padding: '6px 10px',
    textAlign: 'left',
    background: header ? 'var(--bg-tertiary, #21262d)' : 'transparent',
    fontWeight: header ? 600 : 400,
  };
}
