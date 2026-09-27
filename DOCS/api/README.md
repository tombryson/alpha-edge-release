# API Guide

Status: current route inventory and selected workflow contracts, reviewed against
source on 14 September 2026. No API request is executed by documentation generation.

| Need | Reference |
| --- | --- |
| Every registered method/path | [Generated route catalogue](ROUTES.md) |
| Machine-readable inventory | [OpenAPI 3.1](openapi.json) |
| Payloads, examples, side effects | [API reference](API_REFERENCE.md) |
| Follow a signal end to end | [Signal trace](SIGNAL_TRACE.md) |
| TradingView payload contracts | [Webhooks](WEBHOOK_CONTRACT.md) |
| Pine source and script identifiers | [TradingView scripts](TRADINGVIEW_SCRIPTS.md) |
| Credentials and browser CORS | [Authentication](../operations/AUTHENTICATION.md) |
| GET-only local inspection | [HTTP examples](examples.http) |

## Coverage Is Explicit

OpenAPI contains the registered Go operations and nine Next Council proxy operations,
excluding OPTIONS. The [generated catalogue](ROUTES.md) reports the exact current
request/response coverage counts. `x-contract-level` distinguishes
`route-inventory`, `request-documented` and `workflow-documented`. Coverage is not
exhaustive. The schema is useful for discovery, not yet suitable for
generating a fully typed client. No uniform 200 or JSON error contract is invented.

The human reference describes more payloads than the machine schemas. That
material must be checked against handler validation as schemas are added.
Malformed-input, workflow, permission and state-transition rules still need
handler tests even when a request passes JSON Schema validation.

The selected workflow contracts cover TradingView receipt, security-action reads,
execution recording, ignore/Exit override, complete statement import and freshness.
Migration 7 adds immutable statement revision reads and a verified-backup status
contract. Statement corrections retain the original accepted evidence while
updating the current projection.
Missing-exchange auto-assignment also has a bounded request and per-item outcome
contract, including partial success and concurrent-batch rejection.
Announcement subscription setup has GET/PATCH contracts for the manual
per-security confirmation ledger, including atomic batches and listing-change
rechecks. It does not register subscriptions with external providers or assert
announcement delivery.
Portfolio-cycle reads and four-month approval rejection contracts are defined in
[cycle contracts](../../scripts/portfolio-cycle-contracts.mjs). These returns are
adjusted-price references, not personal P/L; see [cycle policy](../system/PORTFOLIO_CYCLES.md).
They distinguish receipt from processing, action ID from decision ID, ordinary
execution from a reported exception, JSON from plain-text errors, and statement
confirmation from correction-induced variance. See [Signal trace](SIGNAL_TRACE.md).
They do not yet cover every signal family or the independent Intelligence API.

Source research now has five documented operations for templates, saved jobs,
explicit paid submission and recovery. They preserve the distinction between a
retrieved source packet and a Council analysis. See [Source research](../system/SOURCE_RESEARCH.md).

## Service Origins

Legacy/machine Terminal routes use the Go backend origin. Owner-mode browsers use
the Next same-origin `/api/terminal/{path}` gateway for those same logical operations;
this transport alias is not duplicated in the route inventory. `/api/council/*`
validates the Terminal session and CSRF (or legacy token) before using the independent
Intelligence Service. Identical `/api` prefixes do not mean identical servers.
The public demo uses neither backend. See [owner sessions and demo](../operations/OWNER_SESSIONS_AND_DEMO.md).
OpenAPI deliberately defaults only to local origins; there is no one-click
production mutation example.

GET is not a blanket side-effect guarantee in the current backend. Some read
handlers reconcile or expire stored workflow state; check the documented side
effects before using any endpoint as a monitoring probe.

The independent Intelligence Service schema is not in this repository. Its
internal Announcement Router endpoint and Council API must be maintained by
that service; the Terminal proxy catalogue is not a substitute.

## Updating Contracts

Change handlers, [route annotations](contracts.json) and, for these selected
workflows, [schema definitions](../../scripts/workflow-api-contracts.mjs), then run
`npm run docs:generate` and `npm run docs:audit`. New or removed routes fail the
audit until the inventory is reconciled. Generated files are committed so
GitHub readers can inspect them without running the application.
