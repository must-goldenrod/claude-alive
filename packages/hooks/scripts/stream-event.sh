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

curl -s -X POST "http://localhost:${CLAUDE_ALIVE_PORT:-3141}/api/event" \
  -H "Content-Type: application/json" \
  -m 2 \
  --data-binary @- > /dev/null 2>&1

exit 0
