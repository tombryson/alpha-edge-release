# Source Research

## Responsibility

Source research retrieves dated, linked factual evidence for a saved Analysis
security. It does not perform Council analysis, create scores or targets, change
classification, approve a portfolio shape or place trades. The default provider
is Parallel Task API `ultra4x`, not the Search API. Keep the manual Web UI route.

The Terminal backend owns these explicit retrieval jobs and saved source packets.
Intelligence still owns Council analysis. The existing supplementary JSON-document
contract transfers a user-selected packet into Council without introducing a
second analysis API or impersonating a Perplexity result.

## Templates And Identity

The library has one template selector shared by **Source research** and **Web UI
prompts**. The former retrieves facts; the latter asks an external Web UI for
full investment analysis. Switching modes retains the chosen template.

Each Gemini, GPT, Perplexity and Claude run editor also has a **Template** button.
It opens the matching Web UI prompt within the same dialog, populated from the
security's saved company name, ticker and exchange. The asset-class mapping selects
the initial rubric; an explicit template selection remains available. A missing
company name, ticker or exchange blocks copying rather than guessing an identity.
**Copy prompt** copies the full investment rubric, not a retrieval-only brief.
**Back to run** preserves unsaved scores, run date and source text. Opening or
copying a template does not call a model, save a run or change classification.

For a security, the initial choice uses `getCouncilTemplateForAssetClass`, then
its saved `templateId`. An unmapped security requires an explicit selection.
The copy-only manual classifier has been removed. Asset-class classification
remains the separate Grok-assisted operation; selecting a template never edits
the asset class. Canonical portfolio class and research template ID are different
fields and are saved separately on each job.

The backend reads the security's identity from `stock_analysis`, checks it is a
STOCK and requires an exchange-qualified ticker matching the UI's expected ticker.
It receives a template ID/version, not a client-composed prompt. Company, exchange
and ticker placeholders are filled server-side. Optional operating details are
research questions to resolve from named sources, not mandatory manual inputs or
invented values. Source-only instructions remove inherited valuation/estimate
requirements. Shared mining briefs are stamped with the selected template ID.

`lib/enrichment-templates.ts` and `public/enrichment-prompts/manual` are the source
catalogue. `npm run research:generate` produces the Go-embedded
`backend/research-catalogue.json`; `npm run test:research-catalogue` and frontend
builds detect drift. The frontend Docker context includes this generated file,
but continues to exclude all other backend files.
The frontend and generator share `lib/research-prompts.ts`. Web UI valuation
rubrics are unchanged; their filled prompts explicitly include the listing ticker
and selected exchange. Template versions are hashes of the normalised instructions;
the exact filled prompt, identity and retrieval date are also saved per run.

## Paid Job Lifecycle

The dialog shows Parallel Ultra 4x and the estimated USD charge before the user
chooses **Retrieve sources**. The server verifies the accepted estimate and
template version. The current estimate is US$1.20 per successful task, from
[Parallel pricing](https://docs.parallel.ai/getting-started/pricing), checked
17 September 2026. This is not a billed-cost ledger. Provider success followed by
local validation failure can still incur a provider charge.

1. Persist `queued` before calling Parallel. One active job per Analysis row and
   at most three active jobs globally; rejected requests are not submitted.
2. Claim `submitting` with a conditional SQLite update, then POST once. Save the
   provider run ID and enter `running`. Send only the populated public-company
   retrieval brief and local job metadata, not holdings, balances or other research.
3. A backend worker checks pending jobs every 15 seconds using provider GETs.
   Known run IDs survive app restarts. Closing the browser does not stop research.
4. Store the full provider response. Validate packet identity, JSON shape, dates,
   source count and document URLs before entering `succeeded`. Invalid output is
   `review`, downloadable for inspection but not attachable as a validated packet.
5. **Attach to Council** places the selected packet and provenance in the existing
   supplementary-document slot. If a document is already selected, the command
   explicitly reads **Replace Council attachment**. It does not start Council,
   and is allowed only when the security and Council template match.
   The packet remains persisted; the pending attachment is browser component state.

Ready means structurally valid, not independently fact-checked. Users can inspect
document summaries, evidence gaps and rejected sources before using the packet.
No provider/model execution is initiated by opening the library or polling its UI.

### Existing Documents

Source research also owns manual Council attachments. The former standalone
**DOC** upload in Council controls has been removed. **Council sources** exposes
Paste, Upload and removal, including when source-retrieval services are unavailable.
Paste creates a UTF-8 `.txt` file only after **Attach sources**; uploads retain
their original file and name. Empty files, unsupported extensions and files over
20 MB are rejected without replacing the current attachment. Accepted extensions
remain PDF, Markdown, text and JSON. Manual material is not given the validated
provider-packet status.

There is one pending file per security, retained in the existing Council runner
component state. Closing/reopening the modal preserves an attached file, but
unattached paste drafts and pending attachments are not persisted across page
reloads. Paste, upload, removal and provider-packet selection make no Council
request; only a separately confirmed Council run submits the file through the
existing multipart `supplementary_file` field. The confirmation retains the
filename, and the Source research button uses a paperclip attachment indicator.
Both the Council column and the expanded research row render the same setup
controls, including when the Council column is hidden. Entry buttons only open
those controls; the sole execution path is **Confirm and run** after preflight.
Opening or closing the controls clears preflight so a prior confirmation cannot
be reused accidentally. Source attachment selection remains independent of execution.

## Idempotency And Recovery

The browser retains a random request ID and original body in session storage
before submission. A lost response exposes **Check submission**, which explicitly
replays the same request, not a new one. A persistent unique database constraint
returns the same job even if it has already completed. Storage unavailable means
submission fails before the network call. Reusing an ID with different parameters
is rejected.

A provider POST transport error, 5xx or unusable success response becomes
`uncertain`; it is never automatically resubmitted. A `submitting` job left for
more than two minutes also becomes uncertain. If Parallel accepted it, find its
run ID in the provider account using metadata `local_job_id`, then use **Recover
run**. Recovery verifies the metadata and processor with a GET before reconnecting.
An unresolved uncertain job continues to occupy capacity. There is deliberately
no blind retry/release button: if the provider has no corresponding run, an operator
must investigate and resolve the stored status before a new paid request.

Transient status/result downloads remain `running` with a reconnection message.
Definite provider rejection or failure becomes `failed`; a new run is always an
explicit new user action. There is no automated provider fallback or tier escalation.

## Persistence And Operations

Schema migration 3 adds `source_research_jobs` and indexes. It does not rewrite
holdings, Analysis scores, class assignments or previous migration checksums.
The existing database runner requires a verified pre-upgrade backup.

Configure `PARALLEL_API_KEY` on the Go backend only. Never use a `NEXT_PUBLIC_*`
variable for it. Missing configuration disables retrieval while keeping template
browsing, copying and saved records available. Deploy backend before frontend.
The library itself needs no new credential and still works offline from the API.

API contracts are in [OpenAPI](../api/openapi.json) and the
[API reference](../api/API_REFERENCE.md#source-research). All five routes use the
Terminal bearer-token middleware. GETs of these routes read local state only.
The worker calls the documented [Parallel Task API](https://docs.parallel.ai/api-reference/tasks/create-task-run).
Provider URLs are fixed in server code, redirects are disabled, results are bounded
to 4 MiB, and upstream response/error bodies are not copied into operational errors.

Validation: mocked-provider Go workflow tests, existing database upgrade/recovery
tests, catalogue drift check, TypeScript and browser tests. Browser fixtures never
spend provider credits or write the real portfolio database.
