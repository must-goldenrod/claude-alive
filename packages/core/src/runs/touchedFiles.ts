/**
 * Which files a run actually changed.
 *
 * The dashboard reports what an agent *concluded* but never what it *did to the
 * repo*. `PostToolUse` already carries the tool name and its input, so the set
 * of edited paths can be accumulated without any new instrumentation.
 */

/** Tools that write to disk. Read-only tools name paths too and must not count. */
const WRITE_TOOLS: ReadonlySet<string> = new Set(['edit', 'write', 'notebookedit', 'multiedit']);

/** Upper bound on the list. A long run can touch hundreds of files; the panel
 *  is a summary, and an unbounded array would bloat every persisted run. */
export const MAX_TOUCHED_FILES = 200;

/** The path a write-style tool targeted, or null when the call changed nothing. */
export function editedPathFrom(tool: string, input: Record<string, unknown> | undefined): string | null {
  if (!WRITE_TOOLS.has(tool.toLowerCase())) return null;
  if (!input) return null;
  for (const key of ['file_path', 'notebook_path', 'path'] as const) {
    const value = input[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

/** Add a path, keeping first-touched order, without duplicates, within the cap. */
export function mergeTouchedFiles(current: string[] | undefined, path: string): string[] {
  const list = current ?? [];
  if (list.includes(path)) return list;
  if (list.length >= MAX_TOUCHED_FILES) return list;
  return [...list, path];
}
