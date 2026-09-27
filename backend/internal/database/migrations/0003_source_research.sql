CREATE TABLE source_research_jobs (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    analysis_id INTEGER NOT NULL,
    company TEXT NOT NULL,
    ticker TEXT NOT NULL,
    exchange TEXT NOT NULL,
    asset_class TEXT NOT NULL,
    template_id TEXT NOT NULL,
    template_version TEXT NOT NULL,
    prompt TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'parallel',
    processor TEXT NOT NULL DEFAULT 'ultra4x',
    estimated_cost_usd REAL NOT NULL,
    provider_run_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK(status IN ('queued','submitting','running','succeeded','failed','uncertain','review')),
    error TEXT NOT NULL DEFAULT '',
    packet_json TEXT NOT NULL DEFAULT '',
    provider_result_json TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX source_research_by_security ON source_research_jobs(analysis_id, created_at DESC);
CREATE UNIQUE INDEX source_research_one_active ON source_research_jobs(analysis_id)
    WHERE status IN ('queued','submitting','running','uncertain');
CREATE UNIQUE INDEX source_research_provider_run ON source_research_jobs(provider_run_id)
    WHERE provider_run_id <> '';
