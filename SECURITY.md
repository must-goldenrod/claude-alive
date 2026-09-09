# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | :white_check_mark: |
| < 0.2   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in claude-alive, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email the maintainers or use GitHub's private vulnerability reporting feature:
1. Go to the repository's Security tab
2. Click "Report a vulnerability"
3. Provide details about the vulnerability

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix release**: Depends on severity, typically within 2 weeks for critical issues

## Security Architecture

claude-alive runs a local server that can start autonomous agents, so the
default posture is a single machine with no network exposure:

- The server binds `127.0.0.1` unless remote access is turned on explicitly
- CORS restricts API access to localhost origins
- No authentication is required in local-only mode — loopback is the boundary
- WebSocket upgrades are checked against an Origin allowlist
- Request body size is limited to 1MB
- WebSocket connections are capped at 50 concurrent clients
- Security headers (CSP, X-Frame-Options, etc.) are set on all responses
- All data stays on the user's machine; there is no telemetry

## Remote Access

Remote access is off by default and is enabled with `CLAUDE_ALIVE_REMOTE=1`.
Turning it on changes the model rather than widening it:

- The server refuses to start without a device token (`CLAUDE_ALIVE_TOKENS`) and
  a cwd allowlist (`CLAUDE_ALIVE_TICKET_ROOTS`)
- **A loopback source address is no longer treated as authentication.** A local
  proxy — `ssh -L`, `cloudflared`, any reverse proxy — makes a remote request
  arrive as `127.0.0.1`, so with remote mode on every caller presents a token,
  whatever address it appears to come from. `CLAUDE_ALIVE_TRUST_LOOPBACK=1`
  restores the old behaviour for setups where nothing proxies to the port
- Remote callers reach an allowlist of routes (tickets, status, the project and
  branch listings, the WebSocket stream). Everything else answers 403, including
  any route added later — the list is opt-in
- A device connection to the WebSocket may read the stream but not send
  `terminal:*`; terminals stay local
- Tickets created by a device must fall inside the cwd allowlist, and SSH-located
  tickets require the host to be named in `CLAUDE_ALIVE_REMOTE_SSH_HOSTS`
- Tokens are compared in constant time, never logged, and a source address is
  locked out after 10 failed attempts in a minute
- Local components (the hook script, the CLI, the served dashboard) use a
  separate full-access token generated into `~/.claude-alive/.env` with mode
  0600 — filesystem access, not source address, is what identifies them

Design notes and the measurements behind them:
[docs/security/remote-trigger-hardening.md](docs/security/remote-trigger-hardening.md).

## Known Limitations

- The server does not use TLS (HTTP only). For remote access, put it on a private
  network (Tailscale/WireGuard) or behind a TLS-terminating tunnel; transport
  encryption is deliberately delegated rather than built in
- A device token is a bearer credential: anyone holding it can create tickets in
  the allowlisted directories, which run agents. Revoke with
  `claude-alive token revoke <label>`
- In local-only mode the WebSocket endpoint is open to any local process

## Trademark Notice

"Claude" is a trademark of Anthropic, PBC. This project is an independent, community-driven tool and is not officially affiliated with or endorsed by Anthropic. Use of the name "claude-alive" is for descriptive purposes to indicate compatibility with Claude Code.
