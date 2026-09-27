# Database Upgrades And Recovery

Scheduled off-volume encrypted backups and round-trip verification are now
implemented but require explicit provisioning/activation. See
[encrypted backups](ENCRYPTED_BACKUPS.md). Migration 7 adds append-only statement
revision evidence; older overwritten corrections cannot be reconstructed.

Status: production and UAT use schema 7. Each migration release records its
backup, isolated migration and recovery rehearsal, and retained financial
evidence in the private release records. This runbook covers the Trading
Terminal's SQLite database, not the independent Intelligence Service database.

## Ownership

Production startup now uses [the versioned runner](../../backend/internal/database/migrate.go)
through [database startup](../../backend/database_startup.go), before starting
HTTP handlers, webhook workers or provider schedulers.

The [frozen baseline SQL](../../backend/internal/database/migrations/0001_baseline.sql)
is the raw effective schema reference: 76 application tables and their indexes.
It was generated from a new, isolated legacy-bootstrap database, not a broker
export. [Fresh defaults](../../backend/internal/database/migrations/0001_fresh_defaults.sql)
contain the existing catalogue, settings and initial ETF universe; they are
applied only to a completely empty database. No holdings, account statements,
approved shapes or historical trading signals are fabricated.

`terminal_schema_migrations` is the additional runner-owned table. Each entry
records version, name, SHA-256 migration-content checksum, UTC application time,
pre-upgrade backup path and that backup's SHA-256. The unrelated historical
`schema_migrations` table on UAT is preserved, not renamed or reinterpreted.
Its two observed entries are `0001_versioning_begins.sql` and
`0002_analyst_rated_at.sql`; their original runner is absent from this checkout.

## Upgrade Rules

1. Read and validate migration history and schema before attempting an upgrade.
2. Already-current databases require no write lock or new backup. Unknown future
   versions, changed migration checksums and unsupported layouts stop startup.
3. For pending work, acquire one SQLite write reservation and recheck the plan.
   Two concurrent starts cannot both apply the same migration.
4. Before upgrading any non-empty database, create and validate a consistent
   standalone backup. A missing/unwritable destination or failed backup stops
   the upgrade before schema or application records change.
5. Apply the pending changes and their ledger entries in one transaction.
   Failed or interrupted work rolls back; the pre-upgrade backup is retained.
6. Check SQLite integrity before committing. Only then allow service startup.

Baseline adoption of the observed UAT layout adds the new ledger only. It does
not rerun statement conversion, holdings reconciliation, class reseeding,
alert-table rebuilding or ETF defaults. Feature-level `ensure...Schema` helpers
no longer perform their legacy DDL/backfills on a managed production database.
Normal statement imports and explicitly requested business operations retain
their existing responsibilities; this is not a change to allocation policy.

Compatibility is deliberately bounded. The runner accepts the observed UAT
ETF CHECK/default variation and equivalent named/inline unique indexes. It also
supports adding three known recent `security_actions` fields
(`execution_cash_value`, `execution_exception_reason`, `execution_policy_snapshot`)
and the memo-run table if absent. Other missing tables/columns, changed defaults,
nullability, key/column types, or incompatible constraints require an explicit
migration. It does not promise conversion of arbitrary old databases.
Additional operator/legacy tables and columns are left intact. `quick_check`
checks SQLite structural integrity, not financial correctness or all domain
invariants; before/after evidence comparison remains part of release validation.

Version 2 adds a narrowly fingerprinted bridge for production v187's pre-runner
schema. It creates 14 feature tables and 14 indexes and adds eight nullable or
empty-default evidence/provenance columns. Unknown legacy schemas still fail
closed. For this one layout, versions 1 and 2 are adopted together in the same
backed-up transaction; the shipped version-1 checksum remains unchanged.
Existing version-1 databases receive version 2 without schema/data rewrites.

The bridge seeds the 15-member momentum catalogue using production identities,
not the fresh database's numeric IDs. Compatible unique exchange aliases and
referenced exchange-less identities are reused; ambiguity aborts the upgrade.
Only missing catalogue identities are inserted. It does not seed Core selections,
approved shapes, historical examples, execution units or user settings. Existing
rows and their original columns must compare identically in the rehearsal.

Version 3 adds the source-research job table and its security/active-run/provider
indexes. It preserves existing records and migration checksums. Backend versions
whose runner only knows versions 1 and 2 cannot start on a version-3 database;
prefer a compatible forward fix to rolling back the application binary blindly.

Version 4 adds six empty owner-auth tables. No owner, session, passkey or recovery
code is seeded; deployment does not enable owner mode or change machine keys.
Existing financial tables and migration checksums remain intact. Older runners
that do not know version 4 cannot be used as a routine binary rollback.

Version 5 adds opt-in weight management configuration, defaulting off. Version 6
adds the empty announcement-subscription ledger; it does not confirm external
subscriptions or alter holdings, signals or execution evidence. A runner that
only knows schema 5 cannot start against schema 6. Use a compatible forward fix
or a separately approved, evidence-preserving recovery procedure.

## Backup Location

`DB_BACKUP_DIR` controls pre-upgrade backups. Both Fly configuration files now
specify `/data/backups`, outside the `/litefs` FUSE mount. Locally the default is
the `backups` directory beside `DB_PATH`. The Docker image includes `dbtool`.

Backups use SQLite's online backup API, including committed WAL pages. The
output is checked, made standalone, synced and published without overwriting an
existing file. Files are private (`0600`); a newly created upgrade-backup directory
is private (`0700`). Reports expose schema hashes, table counts and migration
metadata, not portfolio row contents. Treat the database files themselves as
sensitive. Never commit them or paste them into public issues.

Pre-upgrade backups are not periodic backups. No automatic pruning is introduced:
check free volume space before deployment and retain a verified recoverable copy
before deleting old backups. These backups share the application's volume and
do not protect against loss of that volume/account. Off-volume retention remains
an explicit operational follow-up.

## Operator Commands

From `backend/`, on an **existing isolated copy** at `/tmp/alpha-edge-review.db`:

```sh
go run ./cmd/dbtool inspect --db /tmp/alpha-edge-review.db
go run ./cmd/dbtool plan --db /tmp/alpha-edge-review.db
go run ./cmd/dbtool backup --db /tmp/alpha-edge-review.db --out /tmp/alpha-edge-before-upgrade.db
go run ./cmd/dbtool migrate --db /tmp/alpha-edge-review.db --backup-dir /tmp/alpha-edge-upgrade-backups
go run ./cmd/dbtool restore --db /tmp/alpha-edge-before-upgrade.db --out /tmp/alpha-edge-restored.db
go run ./cmd/dbtool plan --db /tmp/alpha-edge-restored.db
```

These commands do not start HTTP, workers or provider requests. `inspect` and
`plan` open read-only. Sources must exist; mistyped source paths do not create an
empty portfolio. `--out` must be new, including for restore. Existing paths,
symlinks to an existing path and in-place restores are refused. The default
operation timeout is two minutes; `--timeout` can be increased deliberately for
a larger database. Inspect source and destination reports, not just exit status.

`plan` reports pre-upgrade version, pending names and baseline DDL count. A
zero DDL count with baseline still pending means ledger-only adoption, not that
the migration has already run. `migrate` returns that pre-application plan;
run `plan` again to confirm no pending versions.

## Restore And Release Gates

For the first versioned-baseline rollout, use a maintenance window: quiesce
ingestion and stop old application processes before the new runner takes over.
Do not mix the old request-time migration code with the new runner in a rolling
deployment. A transaction protects the upgrade itself; it cannot prevent an
older binary from running its legacy backfills after that transaction commits.

1. Choose a known backup and the application revision compatible with it.
   Check recorded hashes, statement dates and the incident's loss window.
2. Restore to a new isolated file. Verify `quick_check`, schema, row counts and
   actual evidence: statements/units, pending executions, approved shape rows,
   cash pools, Core policies and user settings. Hashes alone do not establish
   business correctness or the provenance of an untrusted backup.
3. Rehearse the proposed migration on that copy. Use `dbtool`, not a server with
   active schedulers or real webhook traffic. Do not test recovery by creating
   trades in the live portfolio.
4. Live activation is a separate authorised maintenance operation: stop writes,
   preserve the current database, identify the LiteFS primary and coordinate
   replication and source revision. This tool deliberately does not replace
   an active LiteFS database or roll back newer broker evidence automatically.
5. After an authorised deployment/restore, verify health and authenticated data
   reads against the captured evidence, then resume ingestion deliberately.

Do not blindly roll back to a pre-runner application image: the old bootstrap
can rerun destructive historical migrations. Database rollback and application
rollback are different operations. An already-upgraded read-only replica can
validate and start; a replica needing migration must receive the primary's
upgraded database before it can start. Multi-machine failover was not rehearsed.

## Verification

Fly volume snapshots are enabled with five-day retention, and production keeps
private off-volume SQLite backups. Restoring a Fly snapshot itself has not been
rehearsed.

An initial schema-only compatibility rehearsal passed but missed an embedded
SQLite integrity-check bug involving implicit REAL defaults on old rows. The
first rollout refused startup before committing a migration. The driver was
updated to `go-sqlite3 v1.14.23` (SQLite 3.46.1); integrity validation was not
weakened and class ratios were not rewritten. An authorised private full-data
backup then passed migration and recovery, comparing every record in 81 tables
and the restored schema. Automated tests separately use synthetic statements, holdings, actions and approved shapes to compare
every record before adoption, after adoption and after isolated backup recovery.
They also cover supported older additions, altered/future ledgers, concurrent
startup, read-only repeats, invalid schemas/defaults, failed backups, WAL data,
no-clobber restore, injected errors and abrupt process interruption.
An old-row `ALTER TABLE ... REAL NOT NULL DEFAULT` fixture also verifies
integrity, adoption and recovery across the driver's previously failing case.
The application-level regression asserts that repeat startup and all guarded
schema helpers issue no DDL or record changes after user configuration edits.

Run from `backend/`:

```sh
go test ./...
go test -race ./internal/database ./cmd/dbtool -count=1
```

CI runs the suite on the declared Go version and stable Go. The Docker build also
runs the migration and CLI tests under Linux/CGO.

## Adding A Migration

Append a sequential entry to the runner with immutable SQL/content and a stable
name. Never edit shipped baseline/default files or existing ledger checksums.
The legacy export test writes only to a temporary directory. New schema or data
changes belong in a new migration, not a feature's request-time schema helper.
Migration callbacks must use the supplied transaction connection exclusively,
without external requests or file-side effects.

The initial validator assumes subsequent migrations are additive. A future
rename/drop/rebuild needs a version-aware validator and its own compatibility
tests before release. Add tests for previous-version upgrade, retained business
evidence, repeat startup, failed-step rollback and recovery; rehearse against the
target deployment's schema and an authorised isolated data copy before rollout.
