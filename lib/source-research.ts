export type SourcePacket = {
    company: string; ticker: string; exchange: string; asset_class: string;
    retrieval_date: string; source_count: number;
    sources: Array<{ title: string; source_type: string; url: string | null; date: string;
        named_source: string; factual_summary: string[]; relevance: string }>;
    rejected_sources: Array<{ title: string; url: string | null; reason: string }>;
    known_gaps: string[];
};

export type SourceResearchJob = {
    id: string; request_id: string; analysis_id: number; company: string; ticker: string;
    exchange: string; asset_class: string; template_id: string; template_version: string;
    provider: string; processor: string; estimated_cost_usd: number; provider_run_id: string;
    status: 'queued' | 'submitting' | 'running' | 'succeeded' | 'failed' | 'uncertain' | 'review';
    error?: string; packet?: SourcePacket; provider_result?: unknown; created_at: string; updated_at: string;
};

export type SourceResearchCatalogue = {
    configured: boolean; processor: string; estimated_cost_usd: number;
    templates: Array<{ id: string; label: string; version: string }>;
};

export type SourceResearchRequest = {
    analysis_id: number; template_id: string; template_version: string;
    accepted_cost_usd: number; request_id: string; expected_ticker: string;
};

export const researchActive = (job: SourceResearchJob) =>
    ['queued', 'submitting', 'running', 'uncertain'].includes(job.status);

export const researchStatusLabel: Record<SourceResearchJob['status'], string> = {
    queued: 'Queued', submitting: 'Submitting', running: 'Retrieving sources',
    succeeded: 'Ready', failed: 'Failed', uncertain: 'Check submission', review: 'Needs review',
};

export function sourcePacketAttachment(job: SourceResearchJob): string {
    if (job.status !== 'succeeded' || !job.packet) throw new Error('No validated source packet available.');
    return JSON.stringify({
        provenance: { job_id: job.id, provider: job.provider, processor: job.processor,
            provider_run_id: job.provider_run_id, template_id: job.template_id,
            template_version: job.template_version, requested_at: job.created_at,
            saved_at: job.updated_at, asset_class: job.asset_class },
        source_packet: job.packet,
    }, null, 2);
}
