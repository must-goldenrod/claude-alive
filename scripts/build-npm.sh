#!/bin/bash
# Build the single npm package (claude-alive)
# Bundles CLI + server + core + hooks into self-contained files.
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/npm-dist"
VERSION=$(node -p "require('$ROOT/package.json').version")

echo "Building claude-alive v$VERSION"
echo ""
echo "[1/6] Building all packages..."
pnpm build

echo "[2/6] Cleaning npm-dist..."
rm -rf "$OUT"
mkdir -p "$OUT/dist" "$OUT/scripts" "$OUT/ui"

# Runtime deps that ship native bindings or resolve modules dynamically stay
# external so Node loads them from node_modules at install time. Each one must
# also be listed under `dependencies` in the generated package.json below.
EXTERNAL_FLAGS="--external:ws --external:node-pty --external:better-sqlite3 --external:@browserbasehq/* --external:@anthropic-ai/sdk --external:zod"

# Bundle the SAME CLI source the workspace uses (packages/cli/src/index.ts).
# The CLI auto-detects whether the server entry lives at the workspace path
# (../../server/dist/index.js) or alongside it as a sibling bundle (./server.js),
# so a single source supports both `pnpm dev` link and the npm-published bundle.
# Removes the prior duplication in npm/cli-entry.ts that caused PR #21 to leak.
echo "[3/6] Bundling CLI..."
npx esbuild "$ROOT/packages/cli/src/index.ts" \
  --bundle --platform=node --format=esm \
  --target=node22 --outfile="$OUT/dist/cli.js" \
  $EXTERNAL_FLAGS

echo "[4/6] Bundling server..."
npx esbuild "$ROOT/npm/server-entry.ts" \
  --bundle --platform=node --format=esm \
  --target=node22 --outfile="$OUT/dist/server.js" \
  $EXTERNAL_FLAGS

# The orchestrator's sub-agent tool. `ensureDelegateCli()` writes a
# ~/.claude-alive/bin/ca-delegate wrapper that execs `node <dist>/delegateCli.js`
# — a sibling of the server bundle. Without this entry that file never existed in
# the published package and every delegation died with "Cannot find module".
echo "[5/6] Bundling ca-delegate CLI..."
npx esbuild "$ROOT/packages/server/src/orchestrator/delegateCli.ts" \
  --bundle --platform=node --format=esm \
  --target=node22 --outfile="$OUT/dist/delegateCli.js" \
  $EXTERNAL_FLAGS

echo "[6/6] Copying assets..."
cp "$ROOT/packages/hooks/scripts/stream-event.sh" "$OUT/scripts/"
cp -r "$ROOT/packages/ui/dist/." "$OUT/ui/"
cp "$ROOT/LICENSE" "$OUT/"
cp "$ROOT/README.md" "$OUT/"

# Bundle efficio (pure-stdlib python — no numpy). The server spawns
# `python3 -m efficio collect` from the package root on session end, so the
# package needs the source tree (sources only; tests/__pycache__ excluded).
mkdir -p "$OUT/efficio"
cp "$ROOT"/efficio/*.py "$OUT/efficio/"
cp "$ROOT/efficio/README.md" "$OUT/efficio/"

# Create package.json for npm
cat > "$OUT/package.json" << PKGJSON
{
  "name": "claude-alive",
  "version": "$VERSION",
  "private": true,
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
    "efficio/",
    "LICENSE",
    "README.md"
  ],
  "dependencies": {
    "ws": "^8",
    "node-pty": "1.2.0-beta.11",
    "better-sqlite3": "^12.11.1",
    "zod": "~4.4.3",
    "@browserbasehq/stagehand": "^4.1.0",
    "@anthropic-ai/sdk": "^0.127.0"
  },
  "engines": {
    "node": ">=22.18.0"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/hoyoungyang0526/claude-alive.git"
  },
  "homepage": "https://github.com/hoyoungyang0526/claude-alive",
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
