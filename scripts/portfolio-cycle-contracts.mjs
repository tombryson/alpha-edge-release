const ref = name => ({ $ref: `#/components/schemas/${name}` });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required });
const text = { type: 'string' };
const timestamp = { type: 'string', format: 'date-time' };
const nullableReturn = { type: ['number', 'null'] };
const count = { type: 'integer', minimum: 0 };
const json = schema => ({ description: 'Success', content: { 'application/json': { schema } } });
const plain = description => ({ description, content: { 'text/plain': { schema: text } } });

export const portfolioCycleSchemas = {
    PortfolioApprovalPolicy: object({ minimum_months: { const: 4 }, can_approve: { type: 'boolean' }, next_allowed_at: timestamp }, ['minimum_months', 'can_approve']),
    PortfolioCycle: object({ snapshot_id: { type: 'integer', minimum: 1 }, started_at: timestamp, ended_at: timestamp, closed: { type: 'boolean' } }),
    PortfolioCycleClassReturn: object({ asset_class: text, return_pct: nullableReturn, securities: count, covered: count,
        coverage_pct: { type: 'number', minimum: 0, maximum: 100 }, reason: text }, ['asset_class', 'return_pct', 'securities', 'covered', 'coverage_pct']),
    PortfolioCycleSecurityReturn: object({ ticker: text, exchange: text, name: text, asset_class: text,
        opening_value_aud: { type: 'number', exclusiveMinimum: 0 }, return_pct: nullableReturn,
        start_price_date: { type: 'string', format: 'date' }, end_price_date: { type: 'string', format: 'date' }, reason: text },
        ['ticker', 'exchange', 'name', 'asset_class', 'opening_value_aud', 'return_pct']),
    PortfolioCyclePerformance: object({ cycle: { anyOf: [ref('PortfolioCycle'), { type: 'null' }] },
        method: { const: 'opening_basket_adjusted_price_return' }, baseline_at: { type: ['string', 'null'], format: 'date-time' },
        classes: { type: 'array', items: ref('PortfolioCycleClassReturn') }, securities: { type: 'array', items: ref('PortfolioCycleSecurityReturn') },
        best_performer: { anyOf: [ref('PortfolioCycleSecurityReturn'), { type: 'null' }] }, covered: count, reason: text },
        ['cycle', 'method', 'baseline_at', 'classes', 'securities', 'best_performer', 'covered']),
    PortfolioCycleLocked: object({ error: text, code: { const: 'PORTFOLIO_CYCLE_LOCKED' }, next_allowed_at: timestamp }),
};

const approvalResponses = {
    200: { description: 'Approved snapshot and rows, with approval_policy. Existing response fields are unchanged.' },
    409: { description: 'Four-calendar-month interval has not elapsed. Transaction is rolled back.', content: { 'application/json': { schema: ref('PortfolioCycleLocked') } } },
    default: plain('Other validation, authentication and database errors retain their existing contracts.'),
};

export const portfolioCycleContracts = {
    'GET /api/portfolio-mix/cycle-performance': {
        description: 'Read-only opening-basket adjusted-price reference. No provider requests or writes. Never personal P/L. Explicit snapshot ID selects the cycle starting at that approval and ending at the next; omission selects the latest. Missing evidence returns null percentages, coverage and reasons. Existing short cycles remain unchanged. See DOCS/system/PORTFOLIO_CYCLES.md.',
        parameters: [{ name: 'snapshot_id', in: 'query', required: false, schema: { type: 'integer', minimum: 1 } }],
        responses: { 200: json(ref('PortfolioCyclePerformance')), 400: plain('Invalid snapshot_id.'), 404: plain('No matching approved/superseded shape.'), 500: plain('Historical evidence could not be read.') },
    },
    'GET /api/portfolio-mix/approved': {
        description: 'Latest approved snapshot and rows. approval_policy is advisory UI state computed by the server; mutation checks are transactional and authoritative.',
        responses: { 200: json(object({ snapshot: { type: ['object', 'null'] }, rows: { type: 'array', items: { type: 'object' } }, approval_policy: ref('PortfolioApprovalPolicy') })), 500: plain('Failed to load approval.') },
    },
    'POST /api/portfolio-mix/approve-current': {
        description: 'First approval unrestricted. Subsequent approvals require four calendar months, clamped at month ends, in UTC. No override via reason or notes. Rejection rolls back supersession of active plans and shapes.',
        requestBody: { required: false, content: { 'application/json': { schema: object({ reason: text, notes: text }, []) } } },
        responses: approvalResponses,
    },
    'POST /api/portfolio-rebalances/{id}/approve': {
        description: 'Completed actions and a matching broker statement remain required. The same four-calendar-month shape approval guard applies; Q3/Q4 overlay confirmations do not call this endpoint.',
        responses: approvalResponses,
    },
};
