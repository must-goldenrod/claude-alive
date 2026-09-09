#!/bin/bash
# claude-alive hook: streams Claude Code events to the local server.
# Runs synchronously but bounded — failures are silent.
# Uses stdin pipe (--data-binary @-) to avoid shell injection via variable interpolation.
#
# NOTE: curl runs in the FOREGROUND on purpose. A previous version backgrounded
# it (`curl ... &` then `exit 0`); when the parent shell exited immediately the
# detached curl was killed before it finished the localhost request, so every
# event was silently lost. The `-m 2` timeout caps the wait at 2s, well under
# the hook's own 5s timeout, so blocking here is safe and non-disruptive.
#
# AUTH: with remote mode on, the server stops treating a loopback address as
# proof of anything (a tunnel forges it), so this script authenticates like any
# other caller. The token is read from the 0600 env file on every run, which is
# what a tunnelled attacker cannot do — and means rotating the token needs no
# reinstall. Without remote mode the file has no token and the header is absent.

AUTH=()
ENV_FILE="${HOME}/.claude-alive/.env"
if [ -r "$ENV_FILE" ]; then
  TOKEN=$(sed -n 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}CLAUDE_ALIVE_LOCAL_TOKEN=//p' "$ENV_FILE" | tail -n 1 | sed "s/^['\"]//; s/['\"]$//")
  if [ -n "$TOKEN" ]; then
    AUTH=(-H "Authorization: Bearer ${TOKEN}")
  fi
fi

curl -s -X POST "http://localhost:${CLAUDE_ALIVE_PORT:-3141}/api/event" \
  -H "Content-Type: application/json" \
  "${AUTH[@]}" \
  -m 2 \
  --data-binary @- > /dev/null 2>&1

exit 0
