#!/bin/bash
# Build the single npm package (claude-alive)
# Bundles CLI + server + core + hooks into self-contained files.
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/npm-dist"
VERSION=$(node -p "require('$ROOT/package.json').version")

echo "Building claude-alive v$VERSION"
echo ""
echo "[1/5] Building all packages..."
pnpm build

echo "[2/5] Cleaning npm-dist..."
rm -rf "$OUT"
mkdir -p "$OUT/dist" "$OUT/scripts" "$OUT/ui"

# pino (absorbed via prompt-core in D-048) uses dynamic require() of node: builtins
# and transport workers at runtime — esbuild can't statically resolve those when
# bundling to ESM, so the bundled output throws "Dynamic require of 'node:os'".
# Mark pino + its runtime-resolved deps external so Node loads them from
# node_modules at install time. They must also be listed under `dependencies` in
# the generated package.json below.
# All runtime deps that either (a) ship native bindings or (b) use dynamic require()
# at runtime are externalized here. When prompt-* packages were absorbed in D-048
# the server bundle suddenly pulled in pino/fastify/better-sqlite3/franc-min — none
# of which survive esbuild ESM bundling. Externalizing keeps the bundle small and
# defers loading to install-time `node_modules`.
EXTERNAL_FLAGS="--external:ws --external:node-pty --external:better-sqlite3 --external:pino --external:pino-* --external:thread-stream --external:sonic-boom --external:on-exit-leak-free --external:real-require --external:atomic-sleep --external:safe-stable-stringify --external:fast-redact --external:quick-format-unescaped --external:process-warning --external:fastify --external:@fastify/* --external:franc-min --external:trigram-utils --external:n-gram --external:collapse-white-space --external:commander --external:picocolors --external:zod"

echo "[3/5] Bundling CLI..."
npx esbuild "$ROOT/npm/cli-entry.ts" \
  --bundle --platform=node --format=esm \
  --target=node20 --outfile="$OUT/dist/cli.js" \
  $EXTERNAL_FLAGS

echo "[4/5] Bundling server..."
npx esbuild "$ROOT/npm/server-entry.ts" \
  --bundle --platform=node --format=esm \
  --target=node20 --outfile="$OUT/dist/server.js" \
  $EXTERNAL_FLAGS

echo "[5/5] Copying assets..."
cp "$ROOT/packages/hooks/scripts/stream-event.sh" "$OUT/scripts/"
cp -r "$ROOT/packages/ui/dist/." "$OUT/ui/"
cp "$ROOT/LICENSE" "$OUT/"
cp "$ROOT/README.md" "$OUT/"

# Create package.json for npm
cat > "$OUT/package.json" << PKGJSON
{
  "name": "claude-alive",
  "version": "$VERSION",
  "description": "Real-time animated UI for Claude Code sessions, powered by hooks",
  "license": "MIT",
  "type": "module",
  "bin": {
    "claude-alive": "./cli.js"
  },
  "files": [
    "cli.js",
    "dist/",
    "scripts/",
    "ui/",
    "LICENSE",
    "README.md"
  ],
  "dependencies": {
    "ws": "^8",
    "node-pty": "1.2.0-beta.11",
    "better-sqlite3": "^11.7.0",
    "pino": "^9.5.0",
    "fastify": "^5.2.0",
    "franc-min": "^6.2.0",
    "commander": "^12.1.0",
    "picocolors": "^1.1.1",
    "zod": "^4.3.6"
  },
  "engines": {
    "node": ">=20"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/hoyoungyang0526/claude-alive.git"
  },
  "homepage": "https://github.com/hoyoungyang0526/claude-alive",
  "publishConfig": {
    "access": "public"
  },
  "keywords": [
    "claude",
    "claude-code",
    "agent",
    "monitoring",
    "dashboard",
    "hooks",
    "realtime",
    "websocket"
  ]
}
PKGJSON

# Create top-level bin wrapper (npm 11 rejects paths with '/')
cat > "$OUT/cli.js" << 'CLIWRAP'
#!/usr/bin/env node
import './dist/cli.js';
CLIWRAP
chmod +x "$OUT/cli.js"

echo ""
echo "Done! Package ready at: $OUT"
echo "To publish: cd npm-dist && npm publish"
