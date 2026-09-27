# Broker Importer Setup

The Google Apps Script source in `backend/google_apps_script/ig_statement_sync.gs`
is a template. The deployed Apps Script and its triggers are managed separately;
updating this repository does not update or interrupt a live importer.

Before deploying this template, configure these private Script Properties:

| Property | Value |
| --- | --- |
| `IG_SPREADSHEET_ID` | The staging spreadsheet owned by the operator |
| `IG_STATEMENT_GMAIL_QUERY` | A Gmail query matching the operator's broker-statement messages |
| `IG_TERMINAL_API_ENDPOINT` | The installation's HTTPS `/api/statements/import` endpoint, without query credentials |

Retain the existing API/provider key properties used by the importer. Never paste
keys, spreadsheet identifiers or personal email filters into source files, issues,
screenshots or public test fixtures. Missing required configuration fails before
the operation runs; there is no fallback to the maintainer's account.

For an existing deployment, transfer the previously hard-coded values privately
into Script Properties before replacing the script. Keep its bearer-token
integration intact during the owner-session migration. Do not change Google
triggers or replay real broker statements merely to test a source-only release.

## A Statement Stops Importing

`Last import` is the last successful import, not the last trigger attempt. A
rejected statement is rolled back, including its provisional sync-history entry.
The Broker statements freshness row currently describes accepted evidence, not
failed delivery attempts. Check the Apps Script **Executions** log first.

| HTTP result | Check |
| --- | --- |
| 401/403 | Service bearer token, destination and origin restrictions; browser passkeys do not replace machine credentials |
| 400 | Required fields, complete holdings and reconciled account totals; do not bypass validation |
| 409 | Statement date/account, external holdings, or identity conflicts; retain the complete response text |
| 500 | Backend logs for the matching time and request; do not credit cash or record trades manually |

For an identity conflict, compare the incoming ISIN, exchange/ticker and name with
`holdings`, `company_mappings`, `security_identities` and `security_name_aliases`.
Two different companies must not share an identity merely because an old ticker
mapping or name alias overlaps. A nonempty conflicting ISIN on a ticker/name
fallback now rejects the import with HTTP 409 before changing either identity.
External-position and duplicate-identity errors are reported separately; a
duplicate error identifies both incoming names and the shared internal ID.

Repair existing incorrect links only after a consistent backup and a rehearsal.
Trace all identity references, preserve amounts/research and immutable statement
revisions, and verify that no new foreign-key violations are introduced. Never
disable the duplicate/external safeguards, silently omit a holding, or restore an
older portfolio database just to work around a mapping error.

After an approved repair, retry the genuine statement via
`processAndSyncIGStatement` (not the separate announcement poller). Confirm the
statement's date, successful sync and expected holdings. Do not manufacture a
new statement date or replay old data merely to make the header look current.
