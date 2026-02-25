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

/** Default path: from server/dist/ -> ../../ui/dist */
const DEFAULT_UI_DIST = resolve(__dirname, '..', '..', 'ui', 'dist');

export function createStaticHandler(uiDistPath?: string) {
  const distDir = uiDistPath ?? DEFAULT_UI_DIST;

  return async function serveStatic(pathname: string, res: ServerResponse): Promise<boolean> {
    // Prevent directory traversal
    const safePath = pathname.replace(/\.\./g, '');
    const filePath = join(distDir, safePath === '/' ? 'index.html' : safePath);

    try {
      const data = await readFile(filePath);
      const ext = extname(filePath);
      const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
      return true;
    } catch {
      // File not found — try SPA fallback (serve index.html)
      if (safePath !== '/' && safePath !== '/index.html') {
        try {
          const indexData = await readFile(join(distDir, 'index.html'));
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
