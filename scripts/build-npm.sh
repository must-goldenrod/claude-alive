#!/bin/bash
# Build the single npm package (claude-alive)
# Bundles CLI + server + core + hooks into self-contained files.
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/npm-dist"

echo "[1/5] Building all packages..."
pnpm build

echo "[2/5] Cleaning npm-dist..."
rm -rf "$OUT"
mkdir -p "$OUT/dist" "$OUT/scripts" "$OUT/ui"

echo "[3/5] Bundling CLI..."
npx esbuild "$ROOT/npm/cli-entry.ts" \
  --bundle --platform=node --format=esm \
  --target=node20 --outfile="$OUT/dist/cli.js" \
  --external:ws

echo "[4/5] Bundling server..."
npx esbuild "$ROOT/npm/server-entry.ts" \
  --bundle --platform=node --format=esm \
  --target=node20 --outfile="$OUT/dist/server.js" \
  --external:ws

echo "[5/5] Copying assets..."
cp "$ROOT/packages/hooks/scripts/stream-event.sh" "$OUT/scripts/"
# Copy UI dist but exclude proprietary Live2D models
rsync -a --exclude='live2d/' "$ROOT/packages/ui/dist/" "$OUT/ui/"
cp "$ROOT/LICENSE" "$OUT/"
cp "$ROOT/README.md" "$OUT/"

# Create package.json for npm
cat > "$OUT/package.json" << 'PKGJSON'
{
  "name": "claude-alive",
  "version": "0.2.0",
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
    "ws": "^8"
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
    "live2d",
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
