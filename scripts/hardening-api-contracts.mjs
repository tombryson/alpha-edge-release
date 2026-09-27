const integer = { type: 'integer', minimum: 1 };
const string = { type: 'string' };
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required });
const json = schema => ({ description: 'Authenticated read-only response.', content: { 'application/json': { schema } } });
const error = description => ({ description, content: { 'text/plain': { schema: string } } });
const auth = { description: 'Owner session or machine authentication required.' };
const number = { type: 'number' };
const optionalNumber = { type: ['number','null'] };
const optionalString = { type: ['string','null'] };
const snapshot = object({
  account: object({ id: integer, account_name: string, statement_date: string,
    total_value_aud: number, cash_aud: number, usd_value: optionalNumber, usd_aud: optionalNumber,
    gbp_value: optionalNumber, gbp_aud: optionalNumber, aud_value: optionalNumber }),
  holdings: { type: 'array', items: object({ security_id: { type: ['integer','null'] },
    details: string, quantity: number, ticker: optionalString, exchange_prefix: optionalString,
    isin: optionalString, canonical_name: optionalString, cost_aud: number, current_price: number,
    value_aud: number, gain_loss_aud: number, gain_loss_pct: number, currency: string,
    market_value: number, cash_reserve: optionalNumber }) },
});

export const hardeningContracts = {
  'GET /api/backup-status': {
    responses: {
      200: json(object({ enabled: { type: 'boolean' }, state: { enum: ['disabled','running','verified','failed'] },
        last_attempt: string, last_success: string, snapshot_id: string, sha256: string, error: string }, ['enabled','state'])),
      401: auth,
    },
  },
  'GET /api/statements/{id}/revisions': {
    parameters: [{ name: 'before', in: 'query', schema: integer, description: 'Exclusive revision-number cursor; each page contains at most 100 rows.' }],
    responses: {
      200: json(object({ statement_id: integer, revisions: { type: 'array', maxItems: 100, items: object({
        id: integer, revision: integer, source: { enum: ['legacy_snapshot','import'] }, recorded_at: string, payload_sha256: string,
      }) } })),
      400: error('Invalid positive statement ID or revision cursor.'), 401: auth, 500: error('Unable to read revisions.'),
    },
  },
  'GET /api/statements/{id}/revisions/{revision}': {
    responses: {
      200: json(object({ statement_id: integer, revision: integer, source: { enum: ['legacy_snapshot','import'] }, recorded_at: string,
        snapshot,
        accepted_payload: { type: ['object','null'], description: 'Validated, normalised import fields. Null for preserved legacy snapshots. Not the original PDF.' },
      })),
      400: error('Invalid positive statement ID or revision.'), 401: auth, 404: error('Revision not found.'), 500: error('Unable to read revision.'),
    },
  },
};
