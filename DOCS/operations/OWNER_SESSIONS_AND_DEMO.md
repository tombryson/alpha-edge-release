# Owner Sessions And Public Demo

Status: production and UAT use passkey owner sessions, and both bootstrap
digests have been removed. Service bearer tokens and TradingView secrets remain
configured in both environments. The [public demo](https://alpha-edge-demo-frontend.fly.dev)
is published separately.
The owner account is single-user. This is not multi-tenant portfolio hosting.

## Isolation Model

| Mode | Data | Browser access | Mutations / integrations |
| --- | --- | --- | --- |
| `legacy` (default) | Existing backend | Existing API token | Existing behaviour, for staged migration only |
| `owner` | Private Go backend and SQLite volume | Passkey, then HttpOnly session cookie | Owner workflow; machine credentials remain separate |
| `demo` | Simulated portfolio in `lib/demo-data.ts` | Public, no account | Read-only; no backend connection, jobs, provider calls, imports or webhooks |

Demo runs as a **separate frontend deployment and origin**. It does not share a
database, volume, owner cookies or service keys with production. Real ASX security
names identify simulated positions; historical shapes are also simulated. Neither
positions nor shapes are derived from a production export. It is
a curated read-only demonstration, not a sandbox trading account. Some integration
views are intentionally empty. Client-only presentation preferences still work.

### Public Security Universe

The fixture contains 21 ASX-listed companies and four ETFs across 12 invested
asset classes. The company selection began with [ASX market-cap rankings](https://marketcap.company/stock-exchanges/au-australian-securities-exchange-market-capitalization/)
on 17 September 2026,
excluding hybrid/preference securities (such as WBCPI and SUNPH) and duplicate
issuer entries. It includes foreign companies with ASX listings; it is not a claim
of S&P index membership or float-adjusted index weight. Fund identities are
[MVB](https://www.vaneck.com.au/investments/equity/mvb-vaneck-australian-banks-etf/),
[GDX](https://www.vaneck.com.au/etf/equity/gdx/snapshot),
[FUEL](https://www.betashares.com.au/fund/global-energy-companies-etf/) and
[VAP](https://fund-docs.vanguard.com/ETF-Vanguard_Australian_Property_Securities_Index_ETF_8206_FS_VAP.pdf).

Company tickers: BHP, CBA, NEM, WBC, NAB, ANZ, MQG, CSL, WES, WDS, RIO,
GMG, FMG, WOW, TCL, ALL, QBE, COL, NST, STO and EVN. Telecommunications,
Healthcare Services, Forestry/Paper/Packaging and Transport/Logistics were
removed from the example holdings, not reclassified or removed from the registry.

Only identities are real. Quantities, prices, returns, scores, signals, memos and
approval history are illustrative and do not refresh from market providers. The
small Demo badge remains visible; there is no full-width banner or name suffix.
The sample totals $283,350 ($268,702 invested and $14,648 cash). P/L is
$89,821.95, or 31.7% using the header's gain/portfolio-value convention. Cost
bases reconcile to this total; individual holding returns and six-month momentum
are separate measures. Each asset class appears once in shapes and grouping.
All four funds are Core ETFs at a 1:4 ratio, with both underfunded and overfunded
examples. Stock budgets deduct the greater of each Core ETF's target or holding.
The three historical shapes progressively move four percentage points from gold
miners to banks, with corresponding simulated memos. Fixture tests reconcile
holdings, class totals, stock suggestions and ETF targets.

Ten rolling-age alerts cover exits, trims, breakouts, adds, buys and
relative outperformance. Eight concern holdings and two concern the six-stock
watchlist. Gold, silver, copper, base metals, iron ore, oil and uranium have populated market paths,
including connected feeds, company evidence and mixed Bull/Bear states.
The added silver, copper and uranium securities are watchlist-only, with no
approved budget; the twelve invested classes and account totals are unchanged.
Twenty-six stocks have distinct synthetic theses, catalysts, saved Council scores
and readable model output. Lynas deliberately remains an incomplete-research
example. Synthetic announcement-router scores include positive, negative and
neutral deltas, using the real capped 3%-per-point weight modifier and per-class
normalisation. ETFs retain their separate allocation rules. No invented provider
job IDs or live research links are created. Sources are labelled synthetic in
the saved output, with no extra table annotations.
Signals resolve exchange-qualified or unique legacy tickers, then use stock IDs
for display so separate exchanges cannot overwrite each other. The Positions
shape strip starts hidden for a new demo browser; explicit saved choices and
the owner's existing default are preserved.
Freshness returns the real client contract with synthetic complete records and
all schedulers disabled; it does not suppress real errors or contact providers.
Ignore controls are disabled in demo mode rather than submitting a rejected write.
Run `npm run test:demo-state` and `npm run test:access` to verify these fixtures.

The demo's complete asset-class registry and risk classifications are generated
from a fresh in-memory backend database into
`lib/demo-asset-classes.generated.ts`. Regenerate with `npm run demo:catalogue`;
the Go test `TestDemoAssetClassCatalogue` checks it against the current seeded
defaults in CI. No owner database is used or exported. The demo serves separate
registry and policy endpoints, just as the private application does.

Held classes split into Q1 (Banks, Diversified Miners, Gold Miners, Consumer
Discretionary, Real Estate / REIT and Iron Ore Miners), Q1-Defensive (Consumer Staples,
Insurance, Gaming & Gambling), and Q1-Exempt (Energy Producers, Pharma & Biotech,
Infrastructure). Cash remains separate. Shape governance
flags use these same policies; the index under System also includes unheld classes.

The demo server refuses live backend/provider configuration. Every mutation is
rejected with 403, including Council submissions; the sole POST exception is the
existing read-only sizing query, answered from fixed fixtures. Browser CSP keeps
application connections same-origin. Its only external embed exception is the
TradingView advanced-chart loader and `www.tradingview-widget.com`, so the four
Markets charts can display public prices. The cross-origin widgets fetch their
own market data; they receive chart symbols/settings, not holdings, credentials
or access to the private backend. No AI provider is enabled. UAT is **not** the demo.

### Demo AI Spending Policy

The public demo has a **zero paid AI budget**, not a per-browser allowance.
Council stock/portfolio analysis, Parallel source retrieval and recovery, news
generation, AI classification and ticker enrichment cannot run. Existing example
research is synthetic; browsing it does not contact a model provider.

Enforcement is server-side, before reading job inputs or forwarding requests.
Reloading, retries, new sessions, forged authentication headers and direct API
requests do not enable paid work. The demo app has no provider credentials or
private backend connection; supplying the forbidden configuration fails closed.
The sizing POST only filters fixed demo fixtures and is not an AI operation.

`npm run test:access` checks every Terminal operation in the REST inventory for
zero upstream requests, blocked mutations, retries and unsafe configuration.
`npm run test:council-proxy` covers JSON/upload submission rejection and the
Council helper's independent demo guard. These run in the existing CI gate.

This prevents AI charges, not HTTP traffic or hosting-cost abuse. A future live
AI trial would be a separate feature requiring server-side user quotas, a shared
hard spending cap, concurrency limits and a kill switch. Do not enable it by
adding provider secrets to the public demo or using browser-only limits.

## Private Configuration

| Process | Variable | Requirement |
| --- | --- | --- |
| Go and Next server | `APP_ACCESS_MODE=owner` | Explicit opt-in; use both together |
| Go and Next server | `APP_ORIGIN` | Exact frontend HTTPS origin, no path/trailing slash; `http://localhost:PORT` for local passkey work |
| Next server only | `TRADING_BACKEND_API_URL` | Private backend API base ending in `/api` |
| Go only | `OWNER_SETUP_TOKEN_SHA256` | SHA-256 digest of a random, offline setup token; remove after enrollment |
| Go only | `API_TOKEN`, `WEBHOOK_SECRET` | Existing machine integrations; never copy to the browser or demo |

Passkeys require a domain, not an IP address. Use `localhost`, not `127.0.0.1`,
when testing owner login. The relying party is the **frontend hostname**, not the
Go hostname. Changing the public hostname requires enrollment/recovery on the
new origin; plan that before enabling access. Back up passkeys in a trusted
password manager or register a second passkey.

`AUTH_DISABLED=true` is rejected in owner mode. No owner is created automatically.
`npm run owner:setup` prints a random setup token and its digest. Keep the token
offline; put only the digest in backend secrets. On the private frontend, enter
the token once and register a passkey. An existing owner prevents any reuse of
the setup token. A concurrent second enrollment cannot overwrite the first.

## Session Contract

- Go uses `go-webauthn`; the browser uses SimpleWebAuthn. User verification and
  resident credentials are required. Private keys never reach the application.
- Production cookies are host-only `__Host-alpha-edge-session` and
  `__Host-alpha-edge-challenge`: Secure, HttpOnly, SameSite=Strict, Path=/.
  HTTP localhost uses `alpha-edge-local-*` names without Secure.
- Sessions use 256-bit random values. Only SHA-256 hashes are stored in SQLite.
  Absolute expiry is seven days, idle expiry 24 hours. A visible tab refreshes
  the idle timer every five minutes; hidden tabs do not keep it alive.
- Owner browser calls use same-origin `/api/terminal/*`; the gateway forwards
  only the owner cookies, content type, Origin and CSRF header. It drops bearer
  headers and unrelated cookies; query credentials and machine ingress are blocked.
- Writes require both exact Origin and a session-bound `X-CSRF-Token`. The CSRF
  value is returned by `/api/auth/session`, held in memory, and is not a login secret.
- Council authorization checks the same Go session and CSRF before making any
  paid call. Its server-side Intelligence credential never reaches the browser.
- Logout revokes the stored session. Sign out everywhere revokes all sessions
  and requires a sign-in in the last ten minutes. SSE checks revocation before
  delivering events and at 15-second heartbeats.
- Challenges expire after five minutes and are consumed once, before validation.
  Anonymous ceremony attempts have a durable global limit of 30 per minute.
  This intentionally simple single-owner limit can be exhausted by an attacker;
  use perimeter rate limiting for the private deployment as an additional layer.
- Owner/demo modes do not hydrate or write the legacy holdings cache. Logout,
  invalid sessions and demo entry clear cached holdings, memo state, trading drafts
  and source input. Valid owner page reloads retain unfinished drafts. Theme/layout
  preferences remain. Unsubmitted drafts are not server state.

## Recovery

First enrollment displays eight random recovery codes once. Download them and
store them offline, apart from the device holding the passkey. Only their hashes
are stored. The UI requires acknowledgment before entering the terminal.

A recovery code is consumed atomically and grants a **five-minute registration-only
session**, not portfolio or Council access. Register a replacement passkey. Only
after that registration succeeds are all old passkeys, sessions, challenges and
remaining recovery codes revoked. Eight new codes are issued. Abandoning recovery
uses that one code but does not prematurely disable the working passkeys.

The shield button in the header opens owner access: verify again, add a backup
passkey, sign out, or sign out everywhere. Adding a passkey does not rotate recovery
codes; recovery does. There is no public email-reset endpoint. Losing all passkeys
and all codes requires a controlled operator recovery, with verified backups.
Do not delete auth tables or restore an old whole-portfolio backup casually.

## Rollout Gate

1. Keep production authentication unchanged while testing owner mode. Back up the private DB,
   rehearse schema migration 4 on a copy, and verify the current financial records.
   Migration 4 adds auth tables only; previous migration checksums are unchanged.
   The supported initial owner deployment is a **single active backend machine**.
   Do not add read replicas without primary-authoritative session verification:
   replica lag could delay revocation. LiteFS normally sends reads to replicas and
   writes to the primary; see [Fly's proxy contract](https://fly.io/docs/litefs/proxy/).
2. Deploy to private UAT first with matching owner configuration and its own origin.
   Enroll, download codes, add a backup passkey, log out/in, test recovery, and check
   Council authorization without submitting a paid job. Use separate UAT codes.
3. Verify real Touch ID/password-manager behaviour on your devices. The automated
   test uses Chromium's virtual authenticator; it cannot certify device recovery.
4. Preserve service-to-service bearer authentication. Inventory clients before
   rotating the old browser-shared `API_TOKEN`; update legitimate import/operator
   clients together, independently of registering the user's passkey. Until
   rotation, old token copies retain full API access: enabling sessions does not
   revoke them. Never publish a previously browser-used token, and do not rotate
   TradingView secrets accidentally. The owner requested that current machine
   integrations remain working during session activation.
5. Deploy private owner frontend/backend together, enroll privately, retain a
   verified recovery route, and remove the bootstrap digest after enrollment.
6. Publish the demo separately using `fly.demo.toml`, no volumes or secrets. Build
   from a clean context with no `.env*` or `NEXT_PUBLIC_API_TOKEN` in the bundle.
   Do not reuse a private image built with public-token fallbacks.

Production and UAT Fly configs select owner mode. Keep those settings on future
deployments; omitting them returns the application to legacy browser-token login.
Live enrollment is verified in production. Backup-passkey and real-device recovery rehearsal remain recommended checks.
Rolling back
the application does not mean restoring financial data. Old application code
may refuse the newer migration ledger: prefer a reviewed forward fix; do not
work around that check by erasing the ledger or rolling the portfolio back.
Restoring an older DB can also restore old session/code records. Treat access
revocation and recovery-code replacement as part of a controlled restore.

The maintained WebAuthn dependency raises the backend minimum to Go 1.26. The
Docker build and CI matrix now use that minimum; local verification also ran on
Go 1.27.1. The old unused Fly `GO_VERSION` build argument does not override the
Dockerfile base image.

## Local Verification

```sh
npm run test:access
npm run test:council-proxy
cd backend
go test ./...
```

Build a separate output directory without touching the normal dev server:

```sh
NEXT_DIST_DIR=.next-access npm run build
npm run test:access:browser
```

The browser harness uses ports 3311/3313 and 8311, a temporary database, synthetic
credentials and a virtual authenticator. It starts no schedulers or provider
clients, and stops its own server process groups afterward. It checks registration,
login/reload, CSRF, logout, recovery isolation, replacement revocation, demo pages
and blocked demo writes. Run it only with those test ports free.

For the public demonstration locally: `npm run dev:demo`, then open
`http://127.0.0.1:3312`. This uses a separate `.next-demo` output directory and
does not start a Go backend. It is not an owner login preview.

To inspect incomplete research locally, start it with
`DEMO_INCOMPLETE_RESEARCH=1 npm run dev:demo`. Westpac's two simulated model
results lack price targets, so the five Bank stocks show unavailable Ideal wt
and the existing Analysis data-issues panel lists Westpac. The Banks Core ETF
retains its policy target. Holdings and all private databases remain untouched.
Restart without the flag to restore the default evidence. This scenario is
ignored in production builds.

No claim of a security certification: domain/TLS setup, secret rotation, private
device enrollment and an independent security review remain release checks.
