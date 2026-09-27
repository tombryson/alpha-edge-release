# Authentication

Updated 21 September 2026. Production and UAT use private owner sessions. The
owner confirmed UAT passkey login and recovery-code storage, then completed
production setup. Both enrollments are verified and bootstrap digests removed.
The public demo remains isolated and anonymous. Follow [Owner sessions and demo](OWNER_SESSIONS_AND_DEMO.md)
for enrollment, recovery, cookie/CSRF contracts, isolation and the rollout gate.
The rest of this page describes retained machine credentials and legacy access.

## Backend environment

| Variable | Purpose |
| --- | --- |
| `API_TOKEN` | Retained machine/legacy bearer credential (`Authorization: Bearer <token>`); owner browser requests use sessions instead. |
| `WEBHOOK_SECRET` | Shared secret required on `POST /api/webhook/*`. |
| `CORS_ALLOWED_ORIGINS` | Comma-separated origin allowlist. Defaults to local frontend origins on ports `3000` through `3002`, plus the two Fly frontends. No wildcard. |
| `AUTH_DISABLED` | `true` disables auth entirely. **Local development only.** |

The server refuses to start if `API_TOKEN`/`WEBHOOK_SECRET` are unset and `AUTH_DISABLED` is not `true`.

Generate tokens: `openssl rand -hex 32`

Deploy: `fly secrets set API_TOKEN=... WEBHOOK_SECRET=... CORS_ALLOWED_ORIGINS=https://<frontend-origin>` (run for prod and UAT apps).

## Route classes

1. **Webhooks** (`POST /api/webhook/*`) — TradingView cannot send headers, so the secret travels in the alert payload: add `"secret": "<WEBHOOK_SECRET>"` to every TradingView alert message JSON (TMS, CDF, Q3D, Q4D, ETF rebalance, regime). `?secret=` query param and bearer token are also accepted (the latter is what UAT fixtures use). The secret is validated before processing and is not stored — alert inserts use parsed fields only.
2. **SSE** (`GET /api/alerts/stream`) — `EventSource` cannot send headers; a `?token=<API_TOKEN>` query param is accepted on this route only.
3. **Owner mode** accepts a valid owner session; mutations also require Origin
   and CSRF verification. Enrollment/login/recovery have their own challenge or
   setup/recovery-token validation. `/api/auth/session` returns status, not portfolio data.
4. **Other legacy/machine calls** require the bearer token. Exempt: `/api/health`, CORS preflights.

All comparisons are constant-time. A blank configured token never matches (no skeleton key on misconfiguration).

## Frontend

In legacy mode the token is entered via the in-app prompt (`components/api-token-gate.tsx`) and stored in `localStorage` under `alpha-edge-api-token`. Any 401 re-opens the prompt. The former `NEXT_PUBLIC_API_TOKEN` build-time fallback is removed: no secret belongs in a browser bundle. UAT browser tests seed localStorage explicitly. Owner mode ignores and removes old browser tokens.

All application API calls go through `apiFetch` in `lib/api.ts`: legacy access
attaches the bearer header; owner access uses the same-origin gateway, session
cookie and CSRF header. Do not call bare `fetch` against the backend.

## UAT

Set `UAT_API_TOKEN` to match the UAT backend's `API_TOKEN`:

- Playwright `APIRequestContext` calls get the bearer header via `extraHTTPHeaders` (playwright.config.ts).
- Legacy/local browser fixtures seed localStorage via `tests/uat/global-setup.ts`.
  That does not sign a browser into deployed owner-mode UAT. Use real passkey
  enrollment for manual UAT, and the isolated `npm run test:access:browser`
  harness for automated login/recovery tests. Never enroll a virtual test
  authenticator into a real owner account.
- The `curl-*.sh` scripts read `UAT_API_TOKEN`/`API_TOKEN` and attach the header when present.

Alternatively run the local UAT backend with `AUTH_DISABLED=true`.

## TradingView checklist (one-time, after deploy)

Update each alert's message JSON to include the `secret` field. Until this is done, webhook signals will be rejected with 401 — do the deploy and the alert updates in the same sitting.
