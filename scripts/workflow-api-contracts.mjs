// Source-reviewed contracts for the signal / execution / statement boundary.
// Cross-field financial validation remains in the handlers and workflow tests.
import { sourceResearchContracts, sourceResearchSchemas } from './source-research-contracts.mjs';
const string = { type: 'string' };
const number = { type: 'number' };
const integer = { type: 'integer' };
const boolean = { type: 'boolean' };
const positive = { type: ['number', 'null'], exclusiveMinimum: 0 };
const nonnegative = { type: 'number', minimum: 0 };
const text = { type: 'string', pattern: '\\S' };
const timestamp = { type: 'string', format: 'date-time' };
const object = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const fields = (names, schema) => Object.fromEntries(names.split(' ').map(name => [name, schema]));
const json = (schema, description) => ({ description, content: { 'application/json': { schema } } });
const body = (schema, description) => ({ required: true, description, content: { 'application/json': { schema } } });
const failure = description => ({ description, content: { 'text/plain': { schema: string } } });
const errors = {
  400: failure('Malformed body, invalid path identifier or request validation failure.'),
  401: json(object({ code: { const: 'unauthorized' }, message: string }, ['code', 'message']), 'Missing or invalid API credentials.'),
  404: failure('The requested action does not exist.'),
  409: failure('Current persisted state conflicts with this operation; reload and review. No successful execution is recorded.'),
  500: failure('Database or processing failure. Do not assume a mutation succeeded; reread state before retrying.'),
};

export const workflowSchemas = {
  ...sourceResearchSchemas,
  WeightReference: object({
    id: integer, ...fields('ticker asset_class role observed_date statement_fingerprint reason', string),
    ...fields('held ideal class_budget percent coverage reduction remaining portfolio_value', number),
    ...fields('research_missing statement_id', integer), ...fields('available fresh', boolean),
    source_dates: { type: 'object', additionalProperties: string }, suppressed: boolean,
  }, ['id','ticker','asset_class','role','held','ideal','percent','coverage','reduction','remaining','research_missing','statement_id','observed_date','portfolio_value','available','fresh']),
  WeightPolicy: object({ enabled: boolean, epoch: integer, version: string, targets: { type: 'array', items: ref('WeightReference') }, error: string }, ['enabled','epoch','version','targets']),
  WebhookSignal: object({
    ...fields('ticker signal script timeframe strength signalStrength current_zone cdf_state cdf_zone event_id secret', string),
    ...fields('bar_closed_at timestamp time', string),
    ...fields('price close analystPriceTarget', { type: ['number', 'string', 'null'] }),
    allocations: { type: 'object', additionalProperties: number },
  }),
  WebhookReceipt: object({ status: { const: 'accepted' }, type: { const: 'tradingview' }, receipt_id: integer, duplicate: boolean }, ['status', 'type', 'receipt_id', 'duplicate']),
  SecurityExecution: {
    ...object({ notes: string, units: positive, exception_reason: string, cash_value: positive, expected_instruction_value: positive }),
    allOf: [{
      if: { properties: { exception_reason: { pattern: '\\S' } }, required: ['exception_reason'] },
      then: { required: ['units', 'cash_value'], properties: { units: { type: 'number' }, cash_value: { type: 'number' } } },
      else: { properties: { cash_value: { type: 'null' } } },
    }],
  },
  ExecutionRecorded: object({ status: { enum: ['AWAITING_STATEMENT', 'CONFIRMED'] }, id: integer, message: { const: 'Decision recorded' } }, ['status', 'id', 'message']),
  SecurityAction: object({
    ...fields('id alert_id priority queue_count', integer),
    ...fields('ticker alert_type strength timeframe source scope asset_class_code source_event_key intent instruction_basis instruction status blocked_by_instruction deployment_state deployment_policy_version execution_note execution_exception_reason execution_policy_snapshot reconciliation_method override_reason', string),
    ...fields('holding_quantity_snapshot holding_value_snapshot holding_price_snapshot instruction_value target_value target_shortfall_value class_funding_before class_funding_after', number),
    ...fields('execution_units execution_cash_value', positive),
    ...fields('blocked_by_action_id reconciled_statement_id', integer),
    ...fields('can_record_purchase_exception is_external is_primary', boolean),
    ...fields('execution_reported_at next_review_at reconciled_at created_at updated_at', timestamp),
    affected_tickers: { type: 'array', items: string },
    weight_evidence: ref('WeightReference'), closed_reason: string,
  }, ['id', 'alert_id', 'ticker', 'alert_type', 'scope', 'intent', 'instruction_basis', 'instruction', 'priority', 'status', 'holding_quantity_snapshot', 'holding_value_snapshot', 'holding_price_snapshot', 'can_record_purchase_exception', 'is_external', 'created_at', 'updated_at', 'queue_count', 'is_primary']),
  StatementImport: object({
    account: object({
      account_name: text, statement_date: timestamp, total_value_aud: { type: 'number', exclusiveMinimum: 0 }, cash_aud: number,
      ...fields('usd_value usd_aud gbp_value gbp_aud', nonnegative), aud_value: number,
    }, ['account_name', 'statement_date', 'total_value_aud', 'cash_aud']),
    holdings: { type: 'array', items: {
      ...object({ details: text, isin: string, currency: text,
        ...fields('quantity cost_aud cost_native current_price value_aud market_value_native market_value cash_reserve', nonnegative),
        ...fields('gain_loss_aud gain_loss_native gain_loss_pct', number),
      }, ['details', 'quantity', 'currency']),
      anyOf: [{ required: ['value_aud'] }, { required: ['market_value_native'] }],
    } },
  }, ['account', 'holdings']),
  StatementImported: object({
    message: { const: 'Statement imported successfully' }, statement_id: integer, revision_id: integer, sync_id: integer, holdings_count: integer,
    changes: object(fields('added updated removed total', integer), ['added', 'updated', 'removed', 'total']),
  }, ['message', 'statement_id', 'sync_id', 'holdings_count', 'changes']),
  DataRefreshRun: object({
    id: integer, ...fields('dataset source update_mode cadence trigger_source last_attempt_at', string),
    status: { enum: ['RUNNING', 'COMPLETE', 'PARTIAL', 'FAILED', 'SKIPPED', 'NEVER_RUN', 'STALE'] },
    ...fields('finished_at last_success_at data_fresh_through message last_error', string),
    coverage_complete: boolean, ...fields('records_expected records_updated error_count stale_after_days', integer),
  }, ['id', 'dataset', 'source', 'update_mode', 'cadence', 'trigger_source', 'status', 'last_attempt_at', 'coverage_complete', 'records_expected', 'records_updated', 'error_count', 'stale_after_days']),
  DataFreshness: object({
    generated_at: timestamp,
    scheduler: object({ ...fields('enabled listing_enabled news_enabled', boolean), ...fields('daily_utc_hour listing_utc_hour news_daily_utc_hour poll_interval_minutes', integer) }, ['enabled', 'listing_enabled', 'news_enabled', 'daily_utc_hour', 'listing_utc_hour', 'news_daily_utc_hour', 'poll_interval_minutes']),
    datasets: { type: 'array', items: ref('DataRefreshRun') },
  }, ['generated_at', 'scheduler', 'datasets']),
};

export const workflowContracts = {
  ...sourceResearchContracts,
  'GET /api/weight-policy': {
    description: 'Read persisted opt-in mode and backend-held-universe Ideal wt references. Default Off removes individual weight ceilings, not class, cash or signal gates. Targets use stored research and server router evidence, never browser-provided targets. An error with empty targets means model evidence is unavailable, not zero. Read-only; action evaluation belongs to the worker/security-actions projection.',
    responses: { 200: json(ref('WeightPolicy'), 'Mode and current references; optional error when evidence cannot be loaded.'), 401: errors[401], 503: failure('Mode could not be read; do not assume Off.') },
  },
  'PATCH /api/weight-policy': {
    description: 'Persist enabled state using the last observed epoch. Actual changes increment epoch, restart daily evidence and close unexecuted weight-only actions. Existing executions and independent signals remain intact. Same mode/epoch is idempotent; stale epoch returns 409. No broker trades or cash movements.',
    requestBody: body({ ...object({ enabled: boolean, epoch: { type:'integer', minimum:0 } }, ['enabled','epoch']), additionalProperties:false }, 'Owner/session write with CSRF. Demo rejects writes. Read latest epoch before changing mode.'),
    responses: { 200: json(ref('WeightPolicy'), 'Saved mode and current targets.'), 400: errors[400], 401: errors[401], 409: errors[409], 500: errors[500], 503: failure('Saved mode could not be read back. Re-read before retrying.') },
  },
  'POST /api/webhook/tradingview': {
    description: 'Admission validates one JSON object (1 MiB maximum) and persists a receipt before returning 200. Send ticker, script and signal for actionable events. Envelope fields are intentionally not all required by the admission schema: signal validation and interpretation occur in the worker. CONNECT never replaces operator initialisation. event_id deduplicates within the seven-day receipt retention; otherwise closed-bar envelopes or short-window identical payloads are used. Reusing event_id with different content is 409. Restarts resume pending work; uncertain PROCESSING work is quarantined, not blindly replayed. This acknowledgement is not a trade permission or proof of downstream processing.',
    requestBody: body(ref('WebhookSignal'), 'Canonical sender fields and supported aliases. Do not send Q3/Q4 here; use the regime endpoint. Never include real credentials in examples.'),
    responses: { 200: json(ref('WebhookReceipt'), 'Durably accepted, possibly a duplicate of an existing receipt.'), 400: errors[400], 401: errors[401], 409: failure('Conflicting content for the same retained event identity.'), 503: failure('Durable storage unavailable; signal was not acknowledged.') },
  },
  'GET /api/security-actions': {
    description: 'Reprojects permitted actions from current connections, risk, approved class budgets and statement-backed funding. This GET can expire/backfill actions and update projections. Analysis remains advisory; opt-in weight management constrains purchases using the held-universe backend ideal. WEIGHT_LIMIT keeps the Add visible with no funded ticket. WEIGHT_REDUCE includes weight_evidence and uses existing reduction recording; WEIGHT_CLASS_REVIEW is review-only. Closed weight proposals retain closed_reason in history. instruction_value is a permitted ticket or proposed sale, execution_cash_value is reported purchase spend, and neither replaces broker holdings. AWAITING_STATEMENT is not a confirmed trade. A correction rechecks CONFIRMED/VARIANCE actions matched to that same statement; a later unrelated statement does not silently clear an existing variance.',
    parameters: [{ name: 'ticker', in: 'query', schema: string, description: 'Optional ticker; normalised to canonical symbol.' }, { name: 'includeHistory', in: 'query', schema: { type: 'boolean', default: false }, description: 'Only literal true includes confirmed, ignored, expired and not-applicable actions.' }],
    responses: { 200: json({ type: 'array', items: ref('SecurityAction') }, 'Current action projections; empty array when none match.'), 401: errors[401], 500: errors[500] },
  },
  'POST /api/security-actions/{id}/record-execution': {
    description: 'Records an already-performed broker trade, not an order. Rechecks queue priority, current permission and class funding. Optional units use exact matching; omission captures estimated units (or quantity direction for an unsized trim). Class actions cannot use one unit amount. A documented purchase exception needs units, AUD cash_value and a nonblank reason, and only applies to broker-funded single-security purchases. A repeat execution returns 409. Broker holdings are unchanged until import. External holdings are manually confirmed without pretending IG verified them.',
    requestBody: body(ref('SecurityExecution'), 'Use {} for ordinary estimated-unit matching. WEIGHT_REDUCE also requires expected_instruction_value equal to the reviewed proposal; changed amounts return 409. REVIEW intent cannot be recorded as a trade. cash_value is permitted only with exception_reason. Zero/negative units are invalid.'),
    responses: { 200: json(ref('ExecutionRecorded'), 'id is the newly recorded decision ID, not the action ID. Normally AWAITING_STATEMENT; manual external execution is CONFIRMED.'), ...errors },
  },
  'POST /api/statements/import': {
    description: 'Complete long-only snapshot for the established broker account, up to 4 MiB. Missing broker positions close; external holdings remain untouched. Validates identity uniqueness, totals (at least AUD 1 rounding allowance), supported native FX and dates. Older days, another broker and identity conflicts are rejected without mutation. The latest day can be corrected in place using the same statement_id and a new sync_id. Only dates after the execution baseline can reconcile; corrections to a previously matched statement recheck its unit evidence. Imports update holdings, identities and history transactionally; action reconciliation follows commit. It is not idempotent at the sync-history level, but repeat snapshots do not create additional decisions.',
    requestBody: body(ref('StatementImport'), 'Explicit account amounts and holdings array required. [] is valid only for a reconciled all-cash account. Date is RFC3339 and normalised to the broker calendar day. Financial cross-field checks remain server-side.'),
    responses: { 201: json(ref('StatementImported'), 'Imported or corrected latest snapshot.'), 400: errors[400], 401: errors[401], 409: failure('Older statement, different account, ambiguous/stable identity conflict or external-holding conflict. No import committed.'), 500: errors[500] },
  },
  'GET /api/data-freshness': {
    description: 'Read-only family-level freshness, not per-security coverage or connectivity proof. coverage_complete reflects completion before stale status is applied. A successful request is not necessarily fresh provider evidence; use data_fresh_through, status and record coverage. Event-driven sources have stale_after_days=0: quiet TradingView is not itself stale or disconnected. Optional date fields may be omitted; last_attempt_at may be empty for NEVER_RUN.',
    responses: { 200: json(ref('DataFreshness'), 'Scheduler configuration and eight provider/event families.'), 401: errors[401], 500: errors[500] },
  },
  'POST /api/security-actions/{id}/ignore': {
    description: 'Only an OPEN non-Exit action can be ignored. Writes an IGNORE decision and resolves its alert. No trade or holding change. Repeats and Exit actions return 409. Request body is ignored.',
    responses: { 200: json(object({ status: { const: 'IGNORED' } }, ['status']), 'Action ignored.'), ...errors },
  },
  'POST /api/security-actions/{id}/override-exit': {
    description: 'Only OPEN or already OVERRIDDEN Exit actions may be overridden. Requires a nonblank reason; optional review date is RFC3339. Records an OVERRIDE decision and resolves the alert without selling. Repeated valid overrides create another audit decision; this endpoint is not idempotent.',
    requestBody: body(object({ reason: text, next_review_at: string }, ['reason']), 'Whitespace is trimmed. Empty next_review_at is allowed; a nonblank value must parse as RFC3339.'),
    responses: { 200: json(object({ status: { const: 'OVERRIDDEN' } }, ['status']), 'Exit overridden.'), ...errors },
  },
};
