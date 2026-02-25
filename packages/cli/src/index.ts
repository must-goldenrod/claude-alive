#!/usr/bin/env node

import { installHooks, uninstallHooks } from '@claude-alive/hooks';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const command = process.argv[2];

switch (command) {
  case 'install': {
    console.log('Installing claude-alive hooks...');
    const result = installHooks();
    console.log(`  Hook script: ${result.hookScriptPath}`);
    console.log(`  Settings:    ${result.settingsPath}`);
    console.log('Done! Claude Code will now stream events to claude-alive.');
    break;
  }

  case 'uninstall': {
    console.log('Removing claude-alive hooks...');
    uninstallHooks();
    console.log('Done! Hooks removed from settings.json.');
    break;
  }

  case 'start': {
    console.log('Starting claude-alive server...');
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const serverEntry = resolve(currentDir, '..', '..', 'server', 'dist', 'index.js');
    const child = spawn('node', [serverEntry], { stdio: 'inherit' });
    child.on('close', (code) => process.exit(code ?? 0));
    break;
  }

  case 'status': {
    const port = process.env.CLAUDE_ALIVE_PORT ?? '3141';
    try {
      const res = await fetch(`http://localhost:${port}/api/status`);
      const data = await res.json();
      console.log(JSON.stringify(data, null, 2));
    } catch {
      console.log('claude-alive server is not running.');
      process.exit(1);
    }
    break;
  }

  default: {
    console.log(`
claude-alive — Real-time animated UI for Claude Code

Usage:
  claude-alive install     Install hooks into ~/.claude/settings.json
  claude-alive uninstall   Remove hooks from settings.json
  claude-alive start       Start the event server (http://localhost:3141)
  claude-alive status      Check if server is running
`);
  }
}
