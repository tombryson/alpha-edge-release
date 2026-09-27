# Encrypted Off-Volume Backups

Status: worker implemented, disabled by default. No bucket or paid resource has
been provisioned by this change. Local pre-migration backups remain separate.

Fly offers [Tigris S3-compatible object storage](https://fly.io/docs/tigris/), billed
through the Fly account. Use a **private, dedicated backup bucket**, not a public
asset bucket. Current rates are on [Tigris pricing](https://www.tigrisdata.com/pricing/).
Restic encrypts before upload; its password must be recoverable outside Fly.

## Provision And Enable

An operator must approve provisioning and retain the credentials privately.

1. Provision a private bucket using `fly storage create -a YOUR_BACKEND_APP`.
   Fly configures `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and the S3 endpoint.
   Verify public access is disabled and use separate credentials/repositories for
   UAT and production. Do not attach these secrets to the demo frontend.
2. Generate a random password of at least 32 characters. Escrow it in the owner's
   password manager/offline recovery store. Losing it makes backups unrecoverable.
3. Configure backend secrets without placing values in chat, git or shell history:
   `RESTIC_PASSWORD`, `RESTIC_REPOSITORY` and `BACKUP_NAMESPACE`.
   Repository format: `s3:https://t3.storage.dev/BUCKET/ENVIRONMENT`.
   Namespace is the backend app/environment name, not a changing machine ID.
   Tigris S3 region can be set with `AWS_DEFAULT_REGION=auto`.
4. Deploy the backend containing Restic, leaving `ALPHA_EDGE_BACKUPS_ENABLED`
   unset. Using its environment, run `restic init` once. The worker never creates
   a bucket/repository, resets a password, removes a lock or prunes data.
5. Explicitly set `ALPHA_EDGE_BACKUPS_ENABLED=true`. The worker runs at startup
   when due, checks every five minutes, and takes a backup every 24 hours.
   Failures retry no faster than hourly; operations time out after 20 minutes.
6. Read authenticated `GET /api/backup-status`. Require `state=verified`, a recent
   `last_success`, snapshot ID and SHA-256. Uploaded-but-unverified is a failure,
   not a successful backup. Alert operationally if last success exceeds 36 hours.

The SQLite online backup API includes committed WAL data. The worker validates a
standalone 0600 file in a temporary 0700 directory, uploads it via Restic, downloads
that exact snapshot, compares SHA-256 and runs SQLite integrity inspection. The
temporary plaintext copies are removed on completion. A writable status claim
prevents a read-only replica from attempting a backup and prevents duplicate
schedulers claiming the same hourly attempt. The supported deployment remains
one authoritative database volume, not independent writable clones.

Status exposes no repository URL, passwords or raw provider stderr. Its records
are stored under `settings.verified_backup_status`; a failed run preserves the
previous success timestamp. Never interpret `enabled=true` as proof of coverage.

## Recovery Drill

Use an isolated directory and a matching backend image; never overwrite live DB.

```sh
restic snapshots --host YOUR_NAMESPACE --tag alpha-edge-sqlite
restic restore SNAPSHOT_ID --target PRIVATE_EMPTY_DIRECTORY
dbtool inspect --db PRIVATE_EMPTY_DIRECTORY/database.db
dbtool plan --db PRIVATE_EMPTY_DIRECTORY/database.db
```

Compare the restored checksum to `/api/backup-status` for the same snapshot and
rehearse any pending migration with `dbtool migrate --backup-dir PRIVATE_BACKUPS`.
Check statement/revision counts, portfolio approvals, pending executions and
security identities. Stop application writers before an operator-controlled
cutover. Do not restart paid jobs or replay confirmed trades during recovery.

The database includes owner session/recovery-code hashes. Restoring an old copy
can revive credentials: revoke sessions, replace recovery codes and review
machine credentials before reopening private access. See
[owner recovery](OWNER_SESSIONS_AND_DEMO.md#recovery).

## Retention

No automatic deletion is enabled. Start with 14 daily, 8 weekly and 12 monthly
snapshots as an operator-reviewed policy. After a verified recovery drill, inspect
`restic forget --dry-run --host YOUR_NAMESPACE --tag alpha-edge-sqlite
--keep-daily 14 --keep-weekly 8 --keep-monthly 12` before running the corresponding
non-dry-run command and `restic prune` in a maintenance window.

Never put a blanket object-age expiry on a Restic repository: shared data packs
may still be required by retained snapshots. Monitor bucket size and budget.
Backups are not immutable against a compromised credential with delete rights;
separate retention credentials or an additional independent copy are future
hardening options. Repository checks/restore testing do not replace that boundary.

Reference: [Restic repositories](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html),
[Restic recovery](https://restic.readthedocs.io/en/stable/050_restore.html).
