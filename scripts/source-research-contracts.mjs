const string = { type: 'string' };
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required });
const json = (schema, description) => ({ description, content: { 'application/json': { schema } } });
const error = description => json(object({ error: string }), description);
const errors = {
    400: error('Invalid request or missing security identity.'),
    401: json(object({ code: string, message: string }), 'Terminal authentication required.'),
    404: error('Saved security or research run does not exist.'),
    409: error('Active run, reused request ID with different content, stale template/price/ticker or capacity limit. Reload before proceeding.'),
    500: error('Database/read failure. A failed submission response is not proof the request was not accepted.'),
    503: error('PARALLEL_API_KEY is not configured.'),
};
export const sourceResearchSchemas = {
    SourceResearchRequest: {
        ...object({ analysis_id: { type: 'integer', minimum: 1 }, template_id: string, template_version: string,
            request_id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{8,100}$' },
            accepted_cost_usd: { type: 'number', const: 1.2 }, expected_ticker: string }), additionalProperties: false,
    },
    ResearchSource: object({ title: string, source_type: string, url: { type: ['string', 'null'] }, date: string,
        named_source: string, factual_summary: { type: 'array', items: string, minItems: 1 }, relevance: string }),
    ResearchSourcePacket: object({ company: string, ticker: string, exchange: string, asset_class: string,
        retrieval_date: { type: 'string', format: 'date' }, source_count: { type: 'integer', minimum: 1, maximum: 100 },
        sources: { type: 'array', minItems: 1, maxItems: 100, items: ref('ResearchSource') },
        rejected_sources: { type: 'array', items: object({ title: string, url: { type: ['string', 'null'] }, reason: string }, ['title','reason']) },
        known_gaps: { type: 'array', items: string } }),
    SourceResearchJob: object({
        ...Object.fromEntries('id request_id company ticker exchange asset_class template_id template_version provider processor provider_run_id created_at updated_at'.split(' ').map(key => [key, string])),
        analysis_id: { type: 'integer' }, estimated_cost_usd: { type: 'number' },
        status: { enum: ['queued','submitting','running','succeeded','failed','uncertain','review'] },
        error: string, packet: ref('ResearchSourcePacket'), provider_result: {},
    }, ['id','request_id','analysis_id','company','ticker','exchange','asset_class','template_id','template_version','provider','processor','estimated_cost_usd','provider_run_id','status','created_at','updated_at']),
};
export const sourceResearchContracts = {
    'GET /api/source-research/templates': {
        description: 'Read-only embedded retrieval catalogue, configuration presence and estimated successful-task USD price. No provider request. Prompt versions are SHA-256 hashes; secrets and prompt bodies are omitted.',
        responses: { 200: json(object({ configured: { type: 'boolean' }, processor: { const: 'ultra4x' }, estimated_cost_usd: { type: 'number' },
            templates: { type: 'array', items: object({ id: string, label: string, version: string }) } }), 'Source research catalogue.'), 401: errors[401] },
    },
    'GET /api/source-research/jobs': {
        parameters: [{ in: 'query', name: 'analysis_id', required: true, schema: { type: 'integer', minimum: 1 } }],
        description: 'Read-only latest 20 runs for one saved Analysis row, newest first. Packets and raw provider results are omitted. Does not poll Parallel or create a run.',
        responses: { 200: json({ type: 'array', maxItems: 20, items: ref('SourceResearchJob') }, 'Saved job summaries.'), 400: errors[400], 401: errors[401], 500: errors[500] },
    },
    'POST /api/source-research/jobs': {
        description: 'Explicit paid source retrieval. Max 4 KiB. Reads the company, exchange-qualified ticker and class from stock_analysis; only STOCK records. expected_ticker must match. Uses a supported server-side template, current template version and accepted price; client prompts, processor changes and arbitrary provider URLs are not accepted. Persists the job before provider submission. The same request_id and inputs return the same run even after completion; one active run per security and three globally. No holdings, classifications, scores or Council jobs are changed. An uncertain response must be recovered by listing runs or explicitly replaying exactly the same request ID and body, never a new ID.',
        requestBody: { required: true, content: { 'application/json': { schema: ref('SourceResearchRequest') } } },
        responses: { 200: json(ref('SourceResearchJob'), 'Existing request, no new provider submission.'), 202: json(ref('SourceResearchJob'), 'Queued durably; provider not necessarily called yet.'), ...errors },
    },
    'GET /api/source-research/jobs/{id}': {
        description: 'Read-only saved run. A succeeded run includes the validated source packet. A review run includes provider_result for explicit download/inspection, never automatic Council use. Validation is structural and identity-based, not independent fact checking. Authentication required.',
        responses: { 200: json(ref('SourceResearchJob'), 'Saved detail and available evidence.'), 401: errors[401], 404: errors[404], 500: errors[500] },
    },
    'POST /api/source-research/jobs/{id}/recover': {
        description: 'For an uncertain submission only. Performs a provider GET and requires matching local_job_id metadata and processor, then links the existing provider run. Never issues another paid POST. Max 1 KiB.',
        requestBody: { required: true, content: { 'application/json': { schema: object({ provider_run_id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{8,100}$' } }) } } },
        responses: { 200: json(object({ recovered: { const: true } }), 'Existing provider run linked; result polling resumes.'), 400: errors[400], 401: errors[401], 409: errors[409] },
    },
};
