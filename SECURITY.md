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

claude-alive is designed as a **local-only** monitoring tool:

- All data stays on the user's machine
- Server binds to `localhost` only
- CORS restricts API access to localhost origins
- No external network calls are made
- No authentication is required (local-only assumption)
- Request body size is limited to 1MB
- WebSocket connections are capped at 50 concurrent clients
- Security headers (CSP, X-Frame-Options, etc.) are set on all responses

## Known Limitations

- The server does not use TLS (HTTP only) — acceptable for localhost
- No authentication mechanism — relies on localhost-only access
- WebSocket endpoint is open to any local process

## Trademark Notice

"Claude" is a trademark of Anthropic, PBC. This project is an independent, community-driven tool and is not officially affiliated with or endorsed by Anthropic. Use of the name "claude-alive" is for descriptive purposes to indicate compatibility with Claude Code.
