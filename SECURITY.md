# Security

Alpha Edge is currently single-owner software, not multi-tenant account hosting.
It contains financial decision-support workflows, but does not place broker orders.

## Access Boundaries

- Private browser access uses passkeys and Secure, HttpOnly, SameSite session
  cookies when owner mode is enabled. Writes require Origin and CSRF checks.
- Trusted microservices retain server-side bearer tokens. Enabling sessions
  does not revoke previously distributed API tokens.
- TradingView uses a separate webhook secret. Do not place any of these secrets
  in source files, frontend build arguments, URLs, screenshots or public issues.
- The public demo is a separate, anonymous, read-only application with synthetic
  holdings, no provider credentials, no private database and no paid AI access.

See [owner sessions and recovery](DOCS/operations/OWNER_SESSIONS_AND_DEMO.md)
for the currently deployed modes, session lifetime, recovery and rollout gates.

## Reporting Issues

Report suspected vulnerabilities to the maintainer privately. Use GitHub private
vulnerability reporting if it is enabled. Do not file a public issue containing
API tokens, recovery codes, broker statements, holdings exports or exploit details
that expose a private account. Use synthetic data for reproduction.

If a credential was exposed, revoke or rotate it in the relevant service;
deleting the file or changing GitHub visibility does not revoke the credential.
Do not restore a financial database just to undo an authentication change.

## Publication

Publish only a separately reviewed clean-source snapshot, following the
[publication checklist](DOCS/development/PUBLIC_SOURCE.md). Operational repositories
may retain private data in their history and must not be made public as a shortcut.
The check must cover all remote branches, tags, releases and artifacts, not only HEAD.
Automated tests and secret scans are useful checks, not a security certification.
