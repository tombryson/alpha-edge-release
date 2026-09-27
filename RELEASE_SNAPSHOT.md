# Release Snapshot

Prepared on 27 September 2026 from the existing Alpha Edge Trading Terminal.
This repository starts with an accurately dated `Initial public release` commit.
That date describes this snapshot's publication, not when the application was
originally developed.

## Provenance

- Source revision: `71acc111ef348ca16599fdf8a0c82dc2a56c9a57`.
- Exported using the source repository's `scripts/export-public-source.mjs` and
  reviewed publication policy.
- Original development history, branches and tags are retained separately by the
  maintainer; this is not a rewrite of that history.
- Apache 2.0 licensing and the existing `NOTICE` are retained. See
  [contributor attribution](CONTRIBUTORS.md).

## Scope

The snapshot includes the Terminal frontend, Go backend, synthetic demo fixtures,
tests and public documentation. It excludes private operational logs, broker data,
local environment files, credentials and private PineScript sources. Alpha Edge
Intelligence is a separate application and is not included.

The README publication notice, this provenance document and contributor credits
are snapshot-specific additions. Release verification also updates the demo smoke
test to scope company names to Positions and explicitly enable optional Q1 groups;
these test corrections do not change application behaviour.
Fly configuration files are unconfigured public
templates. No deployment credentials or connections are transferred, and existing
hosted environments continue to use their original release process.

The single-commit presentation does not remove historical copies, earlier public
releases or activity elsewhere.

## Verification

The [initial snapshot CI run](https://github.com/tombryson/alpha-edge-release/actions/runs/36301073272)
passed source-security checks, frontend build and type checks, documentation and
API contracts, and backend tests including race checks on both Go configurations.
Local publication tests, access-gateway tests and a production-build demo smoke
check also passed. Secret scans reported no findings; that is not a security
certification.

The release gate did **not** pass. The workflow-browser suite passed 59 of 65
tests, with six unresolved failures:

| Area | Observed mismatch |
| --- | --- |
| Ideal wt, single holding | Test expects an Amcor row absent from the current demo. |
| Ideal wt, Core ETF | Test expects a $6,500 target; current demo renders $17,001. |
| Incomplete research review | Test expects one company in the filtered results; two render. |
| Pinned name column | Test expects `position: static`; current styling uses `relative`. |
| Alert sidebar density | Test expects five position alerts; four render. |
| ETF sidebar identity | Test cannot find the expected Silver Miners text in the current chip layout. |

These failures need reconciliation with current fixtures and UI behaviour. They
are not waived or removed from CI, and the suite must not be described as green.

The owner-browser job passed passkey enrolment/login, reload, CSRF, logout,
recovery, replacement and revocation. Its subsequent demo check selected a hidden
BHP alert instead of the Positions row. A follow-up test-only commit scopes that
lookup to Positions, explicitly enables optional Q1 grouping and updates the
Energy Producers count. The corrected Positions assertions passed locally;
the complete owner-browser rerun is still pending at publication.

This is a source snapshot with disclosed verification gaps, not approval to
deploy a new version to a live financial account. Existing deployments are
unchanged. Consult the repository's current Actions results for later verification.
