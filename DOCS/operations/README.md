# Operations

These instructions describe independent installations. They do not grant access
to the maintainer's deployments, account data, credentials or backups.

| Guide | Purpose |
| --- | --- |
| [Broker importer setup](BROKER_IMPORTER_SETUP.md) | Private Script Properties for an independently installed importer |
| [Authentication](AUTHENTICATION.md) | Separate owner access, trusted service tokens and webhook credentials |
| [Owner sessions and demo](OWNER_SESSIONS_AND_DEMO.md) | Passkey enrollment, recovery and the isolated read-only demo |
| [Database upgrades and recovery](DATABASE_UPGRADES_AND_RECOVERY.md) | Versioned migrations, consistent backups and tested recovery |
| [Encrypted backups](ENCRYPTED_BACKUPS.md) | Off-volume encrypted Restic backups and private storage configuration |

## Deployment

Use Fly.io with app names and origins belonging to your own installation. Inspect
every configuration before deploying. Do not reuse another installation's
database, service tokens, passkeys, volumes or frontend images.

The public demo is frontend-only: `APP_ACCESS_MODE=demo`, synthetic data and no
provider credentials. Never connect a demonstration to a private database.
Private owner access requires the matching frontend/backend configuration and
real-device enrollment described in the access runbook. Machine tokens remain
separate from browser sessions. An API token does not populate portfolio data.

## Release Checks

1. Pass the CI release gate on the intended source revision.
2. Back up the private database and verify restoration on an isolated copy.
3. Verify no credentials, broker exports or database files are being shipped.
4. Deploy additive backend changes before frontend consumers, first in an isolated test environment.
5. Confirm authenticated reads, blocked anonymous reads, passkey recovery and unchanged financial evidence.
6. Store deployment records and backups privately, outside the public source repository.

The Vercel Git integration is disabled in `vercel.json`; keep it disabled.
CI tests do not deploy the application. Test fixtures and UAT simulations must
never target production. Rollback of application code is not permission to restore
an older financial database or resurrect revoked sessions.
