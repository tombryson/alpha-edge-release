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
