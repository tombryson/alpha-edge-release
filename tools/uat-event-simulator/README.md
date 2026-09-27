# UAT Event Simulator

This is a deliberately standalone operator tool. It is not bundled with Alpha
Edge and it adds no application route, backend route, schema, or UI component.

Serve it from the repository root:

```bash
npm run serve:uat-event-simulator
```

Then open `http://localhost:3000` and keep the UAT Alpha Edge application open
in a separate tab. The runner accepts only the UAT backend or a local backend,
requires an API bearer token, and keeps that token only in browser session
storage. For a live UAT run, the local machine also needs an authenticated Fly
CLI session because fixture preparation uses `fly ssh console`.

**Fixture boundary:** the local server is hard-coded to the UAT backend app and
the reserved `ASX:AEVT` fixture. **Start clean** removes only that fixture's
previous holding, active alerts, mappings, position state, and simulator theme
events; then inserts a normal 100-unit `$500` Gold Miner holding with a stable
`ASX:AEVT` identity into the current UAT statement and reduces that statement's
mock cash by `$500`. It is deliberately not marked external, so it appears in
the real UAT Positions tab after refresh.

When the durable inbox is installed, Start clean also removes the fixture's
own receipts and failure records. The reset transaction refuses to run if any
of its packets are still PENDING or PROCESSING; wait for delivery to finish
before resetting. Other securities' receipts and all real alerts/decisions are
outside this cleanup. This allows the fixed simulator event IDs to be reused
without weakening production duplicate protection.

Fixture alerts that already have a recorded decision are retired rather than
deleted, preserving the UAT audit trail. The runner then sends a fixed catalogue of CDF/TMS webhook events one at a
time and compares persisted alert and position results with the scenario
expectation. The commodity-ratio scenario sends the real
`/webhook/theme-confirmation` payloads using TradingView-native `BATS:` ETF and
`ASX_DLY:` security symbols, then reads the persisted Gold Market evidence.
It also drives `EQUITY_RELATIVE BUY -> SELL` for the same Gold Miner fixture
and verifies the resulting class-scoped Equity Regime Strong Trim includes that
holding. The stock-level Outperform `BUY -> SELL` is shown separately as
evidence; it does not claim the unfinished 75/100 sizing action exists. The
runner never accepts arbitrary payloads and does not contain a generic
production injector.
