#!/bin/bash
# Local develop-then-use workflow:
#   1. Build the npm bundle (same as a real release)
#   2. Install it globally from the local tarball (`--force` overwrites any
#      previous global install of `claude-alive`)
#   3. Restart the background server so changes take effect immediately
#
# Use this instead of `pnpm dev` when you want to iterate on the published
# user-facing surface (CLI commands, auto-open, bundled server behavior).
# `pnpm dev` is faster for UI work because of Vite HMR, but it runs a different
# code path (workspace TS sources via tsx watch) than what end users actually
# get from npm — bugs in the bundling/packaging layer only show up here.
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "[1/4] Building npm bundle..."
bash scripts/build-npm.sh > /dev/null

echo "[2/4] Packing tarball..."
# `npm pack` produces the exact same .tgz the registry would serve. Installing
# from this tarball forces npm to copy the package + resolve runtime deps
# into the global prefix's node_modules, which is what real users get from
# `npm i -g claude-alive`. Earlier we did `npm i -g <dir>` directly, but npm
# symlinks the directory in that mode — and since the bundle's pino/fastify
# are externalized, the server crashed at first import.
cd "$ROOT/npm-dist"
TARBALL=$(npm pack 2>/dev/null | tail -1)
cd "$ROOT"

echo "[3/4] Installing globally from tarball ($TARBALL)..."
npm i -g "$ROOT/npm-dist/$TARBALL" --force > /dev/null 2>&1
rm -f "$ROOT/npm-dist/$TARBALL"

echo "[4/4] Restarting server..."
claude-alive stop > /dev/null 2>&1 || true
# Brief pause so the previous process fully releases :3141 before the new
# one tries to bind — otherwise users see EADDRINUSE on the very next start.
sleep 1
claude-alive start --no-open

INSTALLED_VERSION=$(claude-alive --help 2>/dev/null | head -1 || echo "unknown")
echo ""
echo "Done. Global claude-alive now reflects your local changes."
echo "  Dashboard: http://localhost:${CLAUDE_ALIVE_PORT:-3141}"
echo "  (Browser was NOT auto-opened — pass arguments to repack-local if you want that.)"
