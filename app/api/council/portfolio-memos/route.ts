import { NextResponse } from 'next/server';
import { authorizeCouncilRequest, fetchCouncilJson } from '../_lib';
import { intelligencePortfolioMemo } from '../../../../lib/portfolio-timeline';
import type { PortfolioMemoRun } from '../../../../lib/api';

// Read saved artifacts, not job results: jobs can expire while memo files remain.
export async function GET(request: Request) {
    const denied = await authorizeCouncilRequest(request);
    if (denied) return denied;
    const listing = await fetchCouncilJson(
        '/api/portfolio-positioning-runs?limit=50',
        { method: 'GET' },
        { retries: 0, timeoutMs: 12000 },
    );
    if (listing.status !== 200)
        return NextResponse.json(
            {
                detail: 'Intelligence memo archive is unavailable.',
                code: listing.body?.code,
            },
            { status: listing.status },
        );
    if (!Array.isArray(listing.body?.runs))
        return NextResponse.json(
            { detail: 'Intelligence returned an invalid memo archive.' },
            { status: 502 },
        );
    const runs = listing.body.runs.slice(0, 50);
    const memos: PortfolioMemoRun[] = [];
    const unavailable: string[] = [];
    let cursor = 0;
    await Promise.all(
        Array.from({ length: Math.min(4, runs.length) }, async () => {
            while (cursor < runs.length) {
                const run = runs[cursor++];
                const id = String(run?.id || '');
                if (!id || /[\/\\]/.test(id)) {
                    unavailable.push(id || 'Unknown artifact');
                    continue;
                }
                const response = await fetchCouncilJson(
                    `/api/portfolio-positioning-runs/${encodeURIComponent(id)}`,
                    { method: 'GET' },
                    { retries: 0, timeoutMs: 12000 },
                );
                try {
                    if (response.status !== 200 || response.body?.id !== id)
                        throw new Error('Unavailable artifact');
                    memos.push(intelligencePortfolioMemo(response.body));
                } catch {
                    unavailable.push(id);
                }
            }
        }),
    );
    memos.sort(
        (a, b) =>
            Date.parse(b.analysis_date) - Date.parse(a.analysis_date) ||
            b.run_id.localeCompare(a.run_id),
    );
    return NextResponse.json(
        { memos, unavailable, limit_reached: runs.length === 50 },
        { headers: { 'Cache-Control': 'private, no-store' } },
    );
}
