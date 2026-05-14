import { readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerResponse } from 'node:http';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/**
 * Resolve the UI dist directory.
 *
 * Called at handler-construction time (not module-load time) so the env var
 * override `__CLAUDE_ALIVE_UI_DIST` is read late. The npm bundle's server
 * entry sets this var before importing the server, but ESM `import` hoisting
 * means the import runs first when both live in a single esbuild bundle —
 * a top-level `const X = process.env.FOO ?? ...` captured the wrong value
 * and the dashboard 404'd on `/` (hitting the JSON router fallback instead
 * of the static index.html).
 */
function resolveUiDistDir(override?: string): string {
  if (override) return override;
  if (process.env.__CLAUDE_ALIVE_UI_DIST) return process.env.__CLAUDE_ALIVE_UI_DIST;
  return resolve(__dirname, '..', '..', 'ui', 'dist');
}

export function createStaticHandler(uiDistPath?: string) {
  // Resolve lazily on first request so npm-bundle env var assignments that run
  // after the import chain (a side-effect of ESM hoisting in esbuild bundles)
  // are still picked up. Cached after first hit — env doesn't change at runtime.
  let cachedDistDir: string | null = null;
  const getDistDir = (): string => {
    if (cachedDistDir === null) cachedDistDir = resolveUiDistDir(uiDistPath);
    return cachedDistDir;
  };

  return async function serveStatic(pathname: string, res: ServerResponse): Promise<boolean> {
    const distDir = getDistDir();
    const filePath = resolve(distDir, pathname === '/' ? 'index.html' : '.' + pathname);
    if (!filePath.startsWith(distDir)) return false; // directory traversal blocked

    try {
      const data = await readFile(filePath);
      const ext = extname(filePath);
      const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
      return true;
    } catch {
      // File not found — try SPA fallback (serve index.html)
      if (pathname !== '/' && pathname !== '/index.html') {
        try {
          const indexData = await readFile(join(getDistDir(), 'index.html'));
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(indexData);
          return true;
        } catch {
          // index.html not found either — UI not built
          return false;
        }
      }
      return false;
    }
  };
}
