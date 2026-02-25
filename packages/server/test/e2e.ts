/**
 * E2E integration test for claude-alive server.
 * Verifies API routes, static file serving, and SPA fallback.
 *
 * Run after `pnpm build`:
 *   node --import tsx packages/server/test/e2e.ts
 */
import { SessionStore } from '@claude-alive/core';
import { createHttpServer } from '../src/httpRouter.js';

const PORT = 0; // Let OS pick a free port

const store = new SessionStore();

function getSnapshot() {
  return {
    agents: store.getAllAgents(),
    recentEvents: store.getRecentEvents(100),
  };
}

function onEvent(payload: import('@claude-alive/core').HookEventPayload): void {
  store.processEvent(payload);
}

const server = createHttpServer({ onEvent, getSnapshot });

async function run() {
  const baseUrl = await new Promise<string>((resolve) => {
    server.listen(PORT, () => {
      const addr = server.address();
      if (typeof addr === 'object' && addr) {
        resolve(`http://localhost:${addr.port}`);
      }
    });
  });

  console.log(`[e2e] Server listening at ${baseUrl}`);
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`  PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  FAIL: ${name}`);
      console.error(`        ${err}`);
      failed++;
    }
  }

  function assert(condition: boolean, msg: string) {
    if (!condition) throw new Error(msg);
  }

  // 1. Health check
  await test('GET /health returns { ok: true }', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(body.ok === true, `Expected { ok: true }, got ${JSON.stringify(body)}`);
  });

  // 2. Dashboard index.html at /
  await test('GET / returns HTML with <div id="root">', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const html = await res.text();
    assert(html.includes('<div id="root">'), 'Response should contain <div id="root">');
    assert(
      res.headers.get('content-type')?.includes('text/html') === true,
      `Expected text/html, got ${res.headers.get('content-type')}`,
    );
  });

  // 3. Vite-built JS asset
  await test('GET /assets/index-*.js returns JavaScript', async () => {
    // First, get index.html to find the actual asset filename
    const indexRes = await fetch(`${baseUrl}/`);
    const html = await indexRes.text();
    const jsMatch = html.match(/\/assets\/index-[^"]+\.js/);
    assert(jsMatch !== null, 'Could not find JS asset reference in index.html');
    const jsPath = jsMatch![0];

    const res = await fetch(`${baseUrl}${jsPath}`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(
      res.headers.get('content-type')?.includes('javascript') === true,
      `Expected javascript content-type, got ${res.headers.get('content-type')}`,
    );
  });

  // 4. POST /api/event with SessionStart
  await test('POST /api/event with SessionStart returns { ok: true }', async () => {
    const payload = {
      event: 'SessionStart',
      tool: '',
      session_id: 'test-session-001',
      timestamp: Date.now(),
      data: {
        session_id: 'test-session-001',
        hook_event_name: 'SessionStart',
        cwd: '/tmp/test',
      },
    };
    const res = await fetch(`${baseUrl}/api/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const body = await res.json();
    assert(body.ok === true, `Expected { ok: true }, got ${JSON.stringify(body)}`);
  });

  // 5. GET /api/agents includes the created agent
  await test('GET /api/agents returns array with created agent', async () => {
    const res = await fetch(`${baseUrl}/api/agents`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const agents = await res.json();
    assert(Array.isArray(agents), `Expected array, got ${typeof agents}`);
    assert(agents.length > 0, 'Expected at least one agent');
    const found = agents.some((a: { sessionId?: string }) => a.sessionId === 'test-session-001');
    assert(found, 'Expected to find agent with sessionId test-session-001');
  });

  // 6. SPA fallback: unknown route returns HTML, not JSON 404
  await test('GET /nonexistent-route returns HTML (SPA fallback)', async () => {
    const res = await fetch(`${baseUrl}/nonexistent-route`);
    assert(res.status === 200, `Expected 200 (SPA fallback), got ${res.status}`);
    const html = await res.text();
    assert(html.includes('<div id="root">'), 'SPA fallback should contain <div id="root">');
    assert(
      res.headers.get('content-type')?.includes('text/html') === true,
      `Expected text/html, got ${res.headers.get('content-type')}`,
    );
  });

  // Summary
  console.log(`\n[e2e] Results: ${passed} passed, ${failed} failed`);

  server.close();

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('[e2e] Fatal error:', err);
  server.close();
  process.exit(1);
});
