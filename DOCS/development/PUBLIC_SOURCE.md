# Public Source Releases

The public-facing source release is a clean snapshot, not a fork of the private
operational repository. It does not carry the original branches, commits, Actions
logs, deployment records, database files, statements or research results.

Operational records, test logs, internal audits and the PineScript sources are
omitted; links to them appear as plain text. They are not needed to build or use
a separate installation. User guides,
system policies, API contracts and synthetic regression tests remain available.

## Preparing A Snapshot

1. Commit reviewed changes on a private release branch. Uncommitted files are never exported.
2. Run `npm run test:publication`, `npm run check:publication` and the redacted secret scan.
3. Run `node scripts/export-public-source.mjs /absolute/new/directory COMMIT` from the private checkout. The parent must exist. Existing destinations are rejected.
4. Review the exported files and the adjacent SHA-256 manifest. No `.git` directory or remote is copied. The manifest stays outside the candidate repository.
5. Initialise a new local repository, run the application/documentation/access checks on that exact snapshot, and scan it again for credentials and personal financial data.
6. Retain `LICENSE` (Apache 2.0) and `NOTICE`, configure private vulnerability reporting and confirm the decision to publish the snapshot.

The exporter does not delete private history, publish a repository, deploy an
application or change authentication. A clean snapshot does not make an
installation secure, and secret scanners do not find every kind of financial
information.

The file guard rejects databases (including disguised SQLite content), private
keys, environment files, broker exports, unreviewed binary assets and personal
configuration. Review new images visually before changing the hashes in
`scripts/publication-assets.json`. Do not add portfolio screenshots to satisfy
the check. Gitleaks uses its default credential rules with one narrowly scoped
exception for a SQL `PRIMARY KEY` declaration in a synthetic test.

## Private Account Access

Source publication does not grant access to an owner's portfolio. Private
installations require configured authentication. Complete real-device passkey
enrollment, backup credentials and recovery acceptance before switching an
existing owner deployment from legacy token login. Retain machine authentication
for legitimate integrations and rotate shared tokens in coordination with them.

The public demo must remain isolated, synthetic and read-only with no paid AI
credentials. Do not connect it to an owner's database to make the demo look real.
