import type {
    PortfolioHistoryEntry,
    PortfolioHistoryAllocationRow,
    PortfolioMemoRun,
} from './api';
import {
    PORTFOLIO_TARGET_CLASSES,
    mapCurrentAssetClassToPortfolioTarget,
} from './portfolio-target-taxonomy';

const record = (value: unknown): Record<string, any> =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, any>)
        : {};
const compact = (value: string) =>
    value.toUpperCase().replace(/[^A-Z0-9]/g, '');
const classNames = new Map(
    PORTFOLIO_TARGET_CLASSES.flatMap((row) => [
        [compact(row.id), row.id.toUpperCase()],
        [compact(row.displayName), row.id.toUpperCase()],
    ]),
);

// Archive comparisons share taxonomy aliases, but unknown classes stay distinct.
export function timelineClassKey(code: string): string {
    const named = classNames.get(compact(code));
    if (named) return named;
    const mapped = mapCurrentAssetClassToPortfolioTarget(code);
    return mapped === 'BROAD_EQUITY' ? compact(code) : mapped;
}

export function memoAllocationRows(
    memo: PortfolioMemoRun,
): PortfolioHistoryAllocationRow[] {
    return memo.asset_class_targets.flatMap((row, index) => {
        const code = String(row.asset_class || row.display_name || '').trim();
        const weight = row.target_pct;
        if (
            !code ||
            !['number', 'string'].includes(typeof weight) ||
            String(weight).trim() === '' ||
            !Number.isFinite(Number(weight)) ||
            Number(weight) < 0
        )
            return [];
        return [
            {
                asset_class: code,
                display_name: String(row.display_name || code),
                display_order: index,
                weight_pct: Number(weight),
            },
        ];
    });
}

export function intelligencePortfolioMemo(value: unknown): PortfolioMemoRun {
    const source = record(value);
    if (source.analysis_kind !== 'portfolio_positioning' || !source.id)
        throw new Error('Not a portfolio memo artifact');
    const structured = record(source.structured_data);
    const strategic = record(structured.strategic_view);
    const summary = record(source.summary_fields);
    const targets =
        structured.asset_class_targets ??
        record(source.macro_positioning).asset_class_targets;
    return {
        id: 0,
        memo_job_id: `intelligence:${source.id}`,
        run_id: String(source.id),
        status: 'SUCCEEDED',
        mode: String(structured.mode || '').toUpperCase(),
        model: '',
        analysis_date: String(
            structured.analysis_date ||
                summary.analysis_date ||
                source.updated_at ||
                '',
        ),
        primary_theme: String(
            strategic.primary_theme || summary.primary_theme || '',
        ),
        secondary_theme: String(
            strategic.secondary_theme || summary.secondary_theme || '',
        ),
        overall_conviction: String(
            record(source.allocator_commentary).overall_conviction ||
                structured.overall_conviction ||
                '',
        ),
        executive_summary: String(structured.executive_summary || ''),
        analyst_memo_markdown: String(
            source.analyst_memo_markdown ||
                record(source.analyst_document).content_markdown ||
                '',
        ),
        chairman_memo_markdown: String(
            source.chairman_memo_markdown ||
                source.memo_markdown ||
                record(source.chairman_document).content_markdown ||
                '',
        ),
        asset_class_targets: Array.isArray(targets)
            ? targets.filter(
                  (row) =>
                      row && typeof row === 'object' && !Array.isArray(row),
              )
            : [],
        created_at: String(source.updated_at || ''),
        updated_at: String(source.updated_at || ''),
    };
}

export function memoHistoryEntry(
    memo: PortfolioMemoRun,
): PortfolioHistoryEntry {
    return {
        id: `memo:${memo.memo_job_id}`,
        kind: 'memo',
        status: memo.status,
        occurred_at: memo.analysis_date || memo.created_at,
        title: 'Portfolio analysis',
        subtitle: memo.primary_theme,
        source: 'Alpha Edge Intelligence',
        memo_job_id: memo.memo_job_id,
        rows: memoAllocationRows(memo),
        memo,
    };
}

export function mergePortfolioArchive(
    history: PortfolioHistoryEntry[],
    memos: PortfolioMemoRun[],
): PortfolioHistoryEntry[] {
    const result = history.map((entry) => ({ ...entry }));
    for (const memo of memos) {
        const existing = result.find(
            (entry) =>
                entry.kind === 'memo' &&
                (entry.memo_job_id === memo.memo_job_id ||
                    entry.memo?.run_id === memo.run_id),
        );
        if (existing) {
            if (!existing.rows.length) existing.rows = memoAllocationRows(memo);
        } else result.push(memoHistoryEntry(memo));
    }
    // A plan link is evidence; date proximity is not. Never infer a source memo from a date.
    for (const entry of result) {
        if (entry.kind === 'shape' && entry.plan_id && !entry.memo_job_id) {
            entry.memo_job_id = result.find(
                (candidate) =>
                    candidate.kind === 'target' &&
                    candidate.plan_id === entry.plan_id,
            )?.memo_job_id;
        }
    }
    return result.sort(
        (a, b) =>
            Date.parse(b.occurred_at) - Date.parse(a.occurred_at) ||
            b.id.localeCompare(a.id),
    );
}

export function memoBasedExamples(
    memos: PortfolioMemoRun[],
): PortfolioHistoryEntry[] {
    return memos
        .flatMap((memo) => {
            const rows = memoAllocationRows(memo);
            if (!rows.length) return [];
            return [
                {
                    ...memoHistoryEntry(memo),
                    id: `memo-preview:${memo.run_id || memo.memo_job_id}`,
                    kind: 'shape' as const,
                    status: 'EXAMPLE',
                    title: 'Memo-based shape',
                    source: 'Hypothetical approval',
                    rows,
                },
            ];
        })
        .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
}

export function compareTimelineRows(
    current: PortfolioHistoryAllocationRow[],
    previous: PortfolioHistoryAllocationRow[],
) {
    const before = new Map(
        previous.map((row) => [timelineClassKey(row.asset_class), row]),
    );
    const after = new Map(
        current.map((row) => [timelineClassKey(row.asset_class), row]),
    );
    return [...new Set([...after.keys(), ...before.keys()])]
        .map((key) => {
            const row = after.get(key) || before.get(key)!;
            const weight = after.get(key)?.weight_pct ?? 0;
            const reference = before.get(key)?.weight_pct ?? 0;
            return {
                ...row,
                key,
                weight,
                reference,
                difference: weight - reference,
            };
        })
        .sort(
            (a, b) =>
                b.weight - a.weight ||
                b.reference - a.reference ||
                a.key.localeCompare(b.key),
        );
}
