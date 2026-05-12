import { existsSync, writeFileSync } from 'node:fs';
import { createLogger, getPaths, loadConfig } from '@think-prompt/core';
import { buildAgentServer } from './server.js';

const paths = getPaths();
const config = loadConfig();
const logger = createLogger('agent.bootstrap', { file: paths.agentLog, stdout: true });

async function findFreePort(startPort: number, attempts = 10): Promise<number> {
  const net = await import('node:net');
  for (let i = 0; i < attempts; i++) {
    const port = startPort + i;
    const free = await new Promise<boolean>((resolve) => {
      const s = net.createServer();
      s.once('error', () => {
        s.close();
        resolve(false);
      });
      s.once('listening', () => {
        s.close(() => resolve(true));
      });
      s.listen(port, '127.0.0.1');
    });
    if (free) return port;
  }
  throw new Error(`No free port starting from ${startPort}`);
}

async function main() {
  const app = buildAgentServer();
  const port = await findFreePort(config.agent.port);
  await app.listen({ host: '127.0.0.1', port });
  writeFileSync(paths.agentPid, String(process.pid), 'utf8');
  logger.info({ pid: process.pid, port }, 'agent listening');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    try {
      await app.close();
    } finally {
      if (existsSync(paths.agentPid)) {
        try {
          const { unlinkSync } = await import('node:fs');
          unlinkSync(paths.agentPid);
        } catch {
          // ignore
        }
      }
      process.exit(0);
    }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'agent failed to start');
  process.exit(1);
});
