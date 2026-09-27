'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
    ArrowLeft,
    ArrowRight,
    BookOpen,
    Columns2,
    Eye,
    EyeOff,
    Layers3,
    LayoutList,
    Target,
    ChartNoAxesColumnIncreasing,
} from 'lucide-react';
import {
    api,
    apiFetch,
    type PortfolioHistoryEntry,
    type PortfolioMemoRun,
} from '@/lib/api';
import { getPortfolioAssetClassColor } from '@/lib/portfolio-composition-colors';
import {
    compareTimelineRows,
    mergePortfolioArchive,
    memoAllocationRows,
    timelineClassKey,
} from '@/lib/portfolio-timeline';
import { PortfolioMemoDocument } from './portfolio-memo-document';
import s from './portfolio-timeline-view.module.css';
import { usePortfolioCycle } from '@/lib/use-portfolio-cycle';
import { normalizeAssetClassCode } from '@/lib/asset-class';
import { CycleReturn, PortfolioCycleSummary } from './portfolio-cycle-summary';

type View = 'shape' | 'bars' | 'staircase';
const views = [
    [Layers3, 'shape', 'Shape'],
    [LayoutList, 'bars', 'Bars'],
    [ChartNoAxesColumnIncreasing, 'staircase', 'Staircase'],
] as const;
const date = (value: string) =>
    Number.isFinite(Date.parse(value))
        ? new Date(value).toLocaleDateString('en-AU', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
          })
        : 'Date unavailable';
const total = (entry: PortfolioHistoryEntry) =>
    entry.rows.reduce((sum, row) => sum + row.weight_pct, 0);
const timestamp = (value: string) =>
    Number.isFinite(Date.parse(value)) && value.includes('T')
        ? `${date(value)} · ${new Date(value).toLocaleTimeString('en-AU', { hour12: false })}`
        : date(value);
const stage = (entry: PortfolioHistoryEntry) =>
    entry.status === 'EXAMPLE'
        ? 'Example'
        : {
              shape: 'Approved',
              target: 'Target',
              memo: 'Memo',
              actual: 'Actual',
          }[entry.kind];
const label = (entry: PortfolioHistoryEntry) =>
    `${stage(entry)}${entry.snapshot_id ? ` v${entry.snapshot_id}` : entry.plan_id && entry.kind === 'target' ? ` v${entry.plan_id}` : ''}`;
const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)}`;

function Tool({
    name,
    active,
    children,
    ...props
}: {
    name: string;
    active?: boolean;
    children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
        <button
            type="button"
            className={s.tool}
            title={name}
            aria-label={name}
            aria-pressed={active}
            {...props}
        >
            {children}
        </button>
    );
}

function Ribbon({
    entry,
    order,
}: {
    entry: PortfolioHistoryEntry;
    order?: string[];
}) {
    const rows = [...entry.rows]
        .filter((row) => row.weight_pct > 0)
        .sort((a, b) =>
            order
                ? order.indexOf(timelineClassKey(a.asset_class)) -
                  order.indexOf(timelineClassKey(b.asset_class))
                : b.weight_pct - a.weight_pct,
        );
    const scale = Math.max(100, total(entry));
    return (
        <div
            className={s.ribbon}
            role="img"
            aria-label={`${label(entry)} allocation: ${total(entry).toFixed(1)}%`}
        >
            {rows.map((row, index) => (
                <span
                    key={`${row.asset_class}:${index}`}
                    title={`${row.display_name}: ${row.weight_pct.toFixed(1)}%`}
                    style={{
                        width: `${(row.weight_pct / scale) * 100}%`,
                        background: getPortfolioAssetClassColor(
                            row.asset_class,
                        ),
                    }}
                />
            ))}
        </div>
    );
}

function MemoReader({
    memo,
    loading,
    error,
    onRetry,
}: {
    memo?: PortfolioMemoRun;
    loading: boolean;
    error?: string;
    onRetry: () => void;
}) {
    const [document, setDocument] = useState<'chairman' | 'analyst'>(
        'chairman',
    );
    const chairman = memo?.chairman_memo_markdown;
    const analyst = memo?.analyst_memo_markdown;
    const distinct = chairman && analyst && chairman.trim() !== analyst.trim();
    return (
        <section className={s.reader} aria-label="Portfolio memo">
            <div className={s.readerHeading}>
                <h3>
                    <BookOpen size={17} /> Portfolio memo
                </h3>
                {distinct && (
                    <div className={s.segment} aria-label="Memo document">
                        <button
                            type="button"
                            aria-pressed={document === 'chairman'}
                            onClick={() => setDocument('chairman')}
                        >
                            Chairman
                        </button>
                        <button
                            type="button"
                            aria-pressed={document === 'analyst'}
                            onClick={() => setDocument('analyst')}
                        >
                            Analyst
                        </button>
                    </div>
                )}
            </div>
            {loading ? (
                <p role="status">Loading saved memo...</p>
            ) : error ? (
                <p role="alert">
                    {error}{' '}
                    <button type="button" onClick={onRetry}>
                        Retry
                    </button>
                </p>
            ) : memo ? (
                <>
                    <p className={s.memoMeta}>
                        {date(memo.analysis_date)}
                        {memo.mode ? ` · ${memo.mode}` : ''}
                        {memo.overall_conviction
                            ? ` · ${memo.overall_conviction} conviction`
                            : ''}
                    </p>
                    <PortfolioMemoDocument
                        text={
                            (distinct
                                ? document === 'chairman'
                                    ? chairman
                                    : analyst
                                : chairman || analyst) ||
                            memo.executive_summary ||
                            'No memo text was saved with this record.'
                        }
                    />
                </>
            ) : (
                <p>No source memo is linked to this record.</p>
            )}
        </section>
    );
}

export function PortfolioTimelineView({
    refreshKey,
    focusMemoJobId,
    onBackToShape,
    onCreateTargetFromMemo,
}: {
    refreshKey?: string;
    focusMemoJobId?: string | null;
    onBackToShape?: () => void;
    onCreateTargetFromMemo: (memo: PortfolioMemoRun) => void | Promise<void>;
}) {
    const [history, setHistory] = useState<PortfolioHistoryEntry[]>([]);
    const [archive, setArchive] = useState<PortfolioMemoRun[]>([]);
    const [details, setDetails] = useState<Record<string, PortfolioMemoRun>>(
        {},
    );
    const [view, setView] = useState<View>('shape');
    const [selectedId, setSelectedId] = useState('');
    const [comparisonId, setComparisonId] = useState('');
    const [compare, setCompare] = useState(false);
    const [ribbons, setRibbons] = useState(true);
    const [loading, setLoading] = useState(true);
    const [archiveLoading, setArchiveLoading] = useState(true);
    const [error, setError] = useState('');
    const [archiveError, setArchiveError] = useState('');
    const [memoErrors, setMemoErrors] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');
    const [reload, setReload] = useState(0);
    const rail = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let alive = true;
        setLoading(true);
        setArchiveLoading(true);
        setError('');
        setArchiveError('');
        void api
            .getPortfolioHistory(250)
            .then((response) => {
                if (alive) setHistory(response.entries || []);
            })
            .catch(() => {
                if (alive) setError('Terminal history could not be loaded.');
            })
            .finally(() => {
                if (alive) setLoading(false);
            });
        void apiFetch('/api/council/portfolio-memos', {
            signal: AbortSignal.timeout(175000),
        })
            .then(async (response) => {
                if (!response.ok)
                    throw new Error(
                        'Intelligence memos could not be loaded. Saved Terminal records remain available.',
                    );
                const result = await response.json();
                if (!Array.isArray(result.memos))
                    throw new Error(
                        'Intelligence returned an invalid memo archive.',
                    );
                if (alive) {
                    setArchive(result.memos);
                    const warnings = [];
                    if (result.unavailable?.length)
                        warnings.push(
                            `${result.unavailable.length} memo files are unavailable.`,
                        );
                    if (result.limit_reached)
                        warnings.push(
                            'Showing the latest 50 Intelligence memos.',
                        );
                    setArchiveError(warnings.join(' '));
                }
            })
            .catch((reason) => {
                if (alive)
                    setArchiveError(
                        reason instanceof Error
                            ? reason.message
                            : 'Intelligence is unavailable.',
                    );
            })
            .finally(() => {
                if (alive) setArchiveLoading(false);
            });
        return () => {
            alive = false;
        };
    }, [refreshKey, reload]);

    const entries = useMemo(
        () => mergePortfolioArchive(history, archive),
        [history, archive],
    );
    const visible = useMemo(
        () => entries.filter((entry) => entry.kind !== 'actual'),
        [entries],
    );
    const selected =
        visible.find((entry) => entry.id === selectedId) || visible[0];
    const cycleId = selected?.kind === 'shape' && selected.status !== 'EXAMPLE' ? selected.snapshot_id ?? undefined : undefined;
    const cycle = usePortfolioCycle(cycleId, refreshKey);
    const cycleByClass = new Map(cycle.data?.classes.map(row => [normalizeAssetClassCode(row.asset_class), row]));
    const choices = entries.filter(
        (entry) => entry.id !== selected?.id,
    );
    const autoReference = choices.find(
        (entry) =>
            entry.kind === (selected?.kind === 'memo' ? 'memo' : 'shape') &&
            Date.parse(entry.occurred_at) <=
                Date.parse(selected?.occurred_at || ''),
    );
    const reference = compare
        ? choices.find((entry) => entry.id === comparisonId) ||
          autoReference ||
          choices[0]
        : undefined;
    const rows = compareTimelineRows(
        selected?.rows || [],
        reference?.rows || [],
    );
    const order = [
        ...new Set([
            ...rows.map((row) => row.key),
            ...visible
                .flatMap((entry) =>
                    entry.rows.map((row) => timelineClassKey(row.asset_class)),
                )
                .sort(),
        ]),
    ];
    const findMemo = (entry?: PortfolioHistoryEntry) => {
        if (!entry?.memo_job_id) return undefined;
        const runId =
            entry.memo?.run_id ||
            entries.find(
                (row) =>
                    row.kind === 'memo' &&
                    row.memo_job_id === entry.memo_job_id,
            )?.memo?.run_id;
        if (details[entry.memo_job_id]) return details[entry.memo_job_id];
        const source = archive.find(
            (memo) =>
                memo.memo_job_id === entry.memo_job_id || memo.run_id === runId,
        );
        return source
            ? { ...source, memo_job_id: entry.memo_job_id }
            : undefined;
    };
    const selectedMemo = findMemo(selected);
    const pendingKey = [selected, reference]
        .filter((entry) => entry?.memo_job_id && !findMemo(entry))
        .map((entry) => entry!.memo_job_id!)
        .join('|');
    useEffect(() => {
        let alive = true;
        for (const id of pendingKey.split('|').filter(Boolean)) {
            if (memoErrors[id]) continue;
            void api
                .getPortfolioMemo(id)
                .then((result) => {
                    if (!result.memo) throw new Error('Missing memo');
                    if (alive)
                        setDetails((current) => ({
                            ...current,
                            [id]: result.memo!,
                        }));
                })
                .catch(() => {
                    if (alive)
                        setMemoErrors((current) => ({
                            ...current,
                            [id]: 'The linked memo is unavailable.',
                        }));
                });
        }
        return () => {
            alive = false;
        };
    }, [pendingKey, memoErrors]);
    useEffect(() => {
        if (!focusMemoJobId) return;
        const entry = entries.find(
            (row) => row.kind === 'memo' && row.memo_job_id === focusMemoJobId,
        );
        if (entry) {
            setSelectedId(entry.id);
        }
    }, [focusMemoJobId, entries]);
    useEffect(() => {
        const track = rail.current;
        if (!track) return;
        const alignSelection = () => {
            const button = track.querySelector<HTMLElement>('[aria-pressed="true"]');
            if (!button) return;
            // Leave the preceding record visible instead of pinning selection to the left edge.
            const anchor = button.previousElementSibling || button;
            track.scrollTo({ left: Math.max(0, track.scrollLeft + anchor.getBoundingClientRect().left - track.getBoundingClientRect().left) });
        };
        alignSelection();
        const observer = new ResizeObserver(alignSelection);
        observer.observe(track);
        return () => observer.disconnect();
    }, [selected?.id, visible]);
    const choose = (id: string) => {
        setSelectedId(id);
        setComparisonId('');
        setSaveError('');
    };
    const move = (direction: number) => {
        const index = visible.findIndex((entry) => entry.id === selected?.id);
        if (visible[index + direction]) choose(visible[index + direction].id);
    };
    const retryMemo = (id?: string) => {
        if (id)
            setMemoErrors((current) => {
                const next = { ...current };
                delete next[id];
                return next;
            });
    };
    const createTarget = async () => {
        if (!selectedMemo || saving) return;
        setSaving(true);
        setSaveError('');
        try {
            // Persist evidence before the draft references it. Browsing never writes.
            await api.savePortfolioMemo({ ...selectedMemo });
            await onCreateTargetFromMemo(selectedMemo);
        } catch {
            setSaveError(
                'The source memo could not be saved. No target was created.',
            );
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className={`${s.timeline} terminal-workspace-controls`} data-testid="portfolio-timeline">
            <header className={s.toolbar}>
                <div className={s.identity}>
                    {onBackToShape && <button type="button" className={s.backButton} aria-label="Back to shape" onClick={onBackToShape}><ArrowLeft size={17} aria-hidden="true" />Back</button>}
                    <h1>Portfolio timeline</h1>
                </div>
            </header>
            {error && (
                <div className={s.notice} role="status">
                    {error}
                    <button
                        type="button"
                        onClick={() => setReload((value) => value + 1)}
                    >
                        Retry
                    </button>
                </div>
            )}
            {(loading || archiveLoading) && !selected ? (
                <div className={s.empty} role="status">
                    Loading portfolio history...
                </div>
            ) : !selected ? (
                <div className={s.empty}>
                    <h3>No saved portfolio records</h3>
                    {archiveError && <p role="status">Memo archive unavailable. <button type="button" onClick={() => setReload(value => value + 1)}>Retry</button></p>}
                </div>
            ) : (
                <>
                    <div className={s.recordNavigation}>
                        <Tool
                            name="Newer record"
                            disabled={visible[0]?.id === selected.id}
                            onClick={() => move(-1)}
                        >
                            <ArrowLeft size={16} />
                        </Tool>
                        <div
                            className={s.recordRail}
                            ref={rail}
                            aria-label="Portfolio records"
                        >
                            {visible.map((entry) => (
                                <button
                                    type="button"
                                    key={entry.id}
                                    aria-pressed={entry.id === selected.id}
                                    onClick={() => choose(entry.id)}
                                >
                                    <span title={entry.occurred_at}>
                                        {date(entry.occurred_at)}
                                    </span>
                                    <strong title={entry.subtitle}>
                                        {label(entry)}
                                    </strong>
                                    <Ribbon entry={entry} order={order} />
                                </button>
                            ))}
                        </div>
                        <Tool
                            name="Older record"
                            disabled={visible.at(-1)?.id === selected.id}
                            onClick={() => move(1)}
                        >
                            <ArrowRight size={16} />
                        </Tool>
                    </div>
                    <div className={s.viewbar}>
                        <div className={s.segment} aria-label="History display">
                            {views.map(([Icon, key, title]) => (
                                <button
                                    key={key}
                                    type="button"
                                    aria-pressed={view === key}
                                    onClick={() => setView(key)}
                                >
                                    <Icon size={16} />
                                    {title}
                                </button>
                            ))}
                        </div>
                        <div className={s.tools}>
                            <Tool
                                name={
                                    ribbons
                                        ? 'Hide shape ribbons'
                                        : 'Show shape ribbons'
                                }
                                active={ribbons}
                                onClick={() => setRibbons(!ribbons)}
                            >
                                {ribbons ? (
                                    <Eye size={17} />
                                ) : (
                                    <EyeOff size={17} />
                                )}
                            </Tool>
                            <button
                                type="button"
                                className={s.compareButton}
                                aria-pressed={compare}
                                disabled={!choices.length}
                                onClick={() => setCompare(!compare)}
                            >
                                <Columns2 size={16} />
                                Compare
                            </button>
                        </div>
                        {compare && (
                            <label className={s.comparisonSelect}>
                                Compare with
                                <select
                                    value={reference?.id || ''}
                                    onChange={(event) =>
                                        setComparisonId(event.target.value)
                                    }
                                >
                                    {choices.map((entry) => (
                                        <option key={entry.id} value={entry.id}>
                                            {timestamp(entry.occurred_at)} ·{' '}
                                            {label(entry)}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}
                    </div>
                    <div
                        className={s.body}
                        data-testid="portfolio-timeline-content"
                    >
                        {view === 'bars' && (
                            <div
                                className={s.archive}
                                aria-label="Shape bar archive"
                            >
                                {visible.map((entry) => (
                                    <button
                                        type="button"
                                        key={entry.id}
                                        aria-pressed={entry.id === selected.id}
                                        onClick={() => choose(entry.id)}
                                    >
                                        <time>{date(entry.occurred_at)}</time>
                                        <span>{label(entry)}</span>
                                        <Ribbon entry={entry} order={order} />
                                        <span>
                                            {entry.rows.length
                                                ? `${total(entry).toFixed(1)}%`
                                                : 'No weights'}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                        <div
                            className={s.recordHeadings}
                            data-comparison={Boolean(reference)}
                        >
                            {[selected, reference]
                                .filter(Boolean)
                                .map((entry) => (
                                    <div
                                        className={s.recordHeading}
                                        key={entry!.id}
                                    >
                                        {entry!.kind === 'shape' ? <>
                                            <h2>{label(entry!)}</h2>
                                            <time className={s.recordMeta} dateTime={entry!.occurred_at}>
                                                {timestamp(entry!.occurred_at)}
                                            </time>
                                        </> : <>
                                            <div className={s.recordMeta}>
                                                <span>{label(entry!)}</span>
                                                <time dateTime={entry!.occurred_at}>
                                                    {timestamp(entry!.occurred_at)}
                                                </time>
                                            </div>
                                            <h2>
                                                {entry!.kind === 'memo'
                                                    ? 'Portfolio analysis'
                                                    : entry!.title}
                                            </h2>
                                            <p>
                                                {entry!.memo_job_id
                                                    ? 'Source: Portfolio memo'
                                                    : `${entry!.source} · No memo linked`}
                                            </p>
                                            {entry!.subtitle && (
                                                <p className={s.theme}>
                                                    {entry!.subtitle}
                                                </p>
                                            )}
                                        </>}
                                        {ribbons && (
                                            <Ribbon
                                                entry={entry!}
                                                order={order}
                                            />
                                        )}
                                        {Math.abs(total(entry!) - 100) >
                                            0.5 && (
                                            <p className={s.warning}>
                                                Recorded weights total{' '}
                                                {total(entry!).toFixed(1)}%.
                                                Values are shown unchanged.
                                            </p>
                                        )}
                                    </div>
                                ))}
                        </div>
                        {saveError && (
                            <p role="alert" className={s.warning}>
                                {saveError}
                            </p>
                        )}
                        {selectedMemo && (
                            <div className={s.draftAction}>
                                <button
                                    type="button"
                                    disabled={
                                        saving ||
                                        !memoAllocationRows(selectedMemo).length
                                    }
                                    onClick={() => void createTarget()}
                                >
                                    <Target size={16} />
                                    {saving
                                        ? 'Saving source...'
                                        : 'Create target draft'}
                                </button>
                            </div>
                        )}
                        <div
                            className={s.recordContent}
                            data-reading={Boolean(
                                selected.memo_job_id && !reference,
                            )}
                        >
                            <div className={s.allocation}>
                                <div className={s.tableHeading}>
                                    <h3>
                                        {view === 'staircase'
                                            ? 'Concentration staircase'
                                            : 'Asset class weights'}
                                    </h3>
                                    {reference && (
                                        <span>
                                            {rows.every(
                                                (row) =>
                                                    Math.abs(row.difference) <
                                                    0.005,
                                            )
                                                ? 'No allocation change'
                                                : 'Change in percentage points'}
                                        </span>
                                    )}
                                </div>
                                {cycleId && <PortfolioCycleSummary {...cycle} />}
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Asset class</th>
                                            <th>
                                                {label(selected)}
                                                {reference && (
                                                    <small>
                                                        {date(
                                                            selected.occurred_at,
                                                        )}
                                                    </small>
                                                )}
                                            </th>
                                            {cycleId && <th title="Return over the selected approval's cycle">Return %</th>}
                                            {reference && (
                                                <>
                                                    <th>
                                                        {label(reference)}
                                                        <small>
                                                            {date(
                                                                reference.occurred_at,
                                                            )}
                                                        </small>
                                                    </th>
                                                    <th>Change</th>
                                                </>
                                            )}
                                            {view === 'staircase' && (
                                                <th>Cumulative</th>
                                            )}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((row, index) => (
                                            <tr key={row.key}>
                                                <td>
                                                    <span
                                                        className={s.className}
                                                    >
                                                        <i
                                                            style={{
                                                                background:
                                                                    getPortfolioAssetClassColor(
                                                                        row.asset_class,
                                                                    ),
                                                            }}
                                                        />
                                                        {row.display_name}
                                                    </span>
                                                </td>
                                                <td>
                                                    {row.weight.toFixed(1)}%
                                                </td>
                                                {cycleId && <td><CycleReturn row={cycleByClass.get(normalizeAssetClassCode(row.asset_class))} unavailable={cycle.error || cycle.data?.reason} /></td>}
                                                {reference && (
                                                    <>
                                                        <td>
                                                            {row.reference.toFixed(
                                                                1,
                                                            )}
                                                            %
                                                        </td>
                                                        <td
                                                            data-direction={
                                                                Math.abs(
                                                                    row.difference,
                                                                ) < 0.05
                                                                    ? 'neutral'
                                                                    : row.difference >
                                                                        0
                                                                      ? 'up'
                                                                      : 'down'
                                                            }
                                                        >
                                                            {signed(
                                                                row.difference,
                                                            )}
                                                            pp
                                                        </td>
                                                    </>
                                                )}
                                                {view === 'staircase' && (
                                                    <td
                                                        className={s.cumulative}
                                                    >
                                                        <div>
                                                            <span
                                                                style={{
                                                                    width: `${Math.min(
                                                                        100,
                                                                        rows
                                                                            .slice(
                                                                                0,
                                                                                index +
                                                                                    1,
                                                                            )
                                                                            .reduce(
                                                                                (
                                                                                    sum,
                                                                                    item,
                                                                                ) =>
                                                                                    sum +
                                                                                    item.weight,
                                                                                0,
                                                                            ),
                                                                    )}%`,
                                                                    background:
                                                                        getPortfolioAssetClassColor(
                                                                            row.asset_class,
                                                                        ),
                                                                }}
                                                            />
                                                        </div>
                                                        <span>
                                                            {rows
                                                                .slice(
                                                                    0,
                                                                    index + 1,
                                                                )
                                                                .reduce(
                                                                    (
                                                                        sum,
                                                                        item,
                                                                    ) =>
                                                                        sum +
                                                                        item.weight,
                                                                    0,
                                                                )
                                                                .toFixed(1)}
                                                            %
                                                        </span>
                                                    </td>
                                                )}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div
                                className={s.documents}
                                data-comparison={Boolean(
                                    reference?.memo_job_id &&
                                    selected.memo_job_id,
                                )}
                            >
                                {[selected, reference]
                                    .filter((entry) => entry?.memo_job_id)
                                    .map((entry) => (
                                        <MemoReader
                                            key={entry!.id}
                                            memo={findMemo(entry!)}
                                            loading={
                                                !findMemo(entry!) &&
                                                !memoErrors[entry!.memo_job_id!]
                                            }
                                            error={
                                                findMemo(entry!)
                                                    ? undefined
                                                    : memoErrors[
                                                          entry!.memo_job_id!
                                                      ]
                                            }
                                            onRetry={() =>
                                                retryMemo(entry!.memo_job_id)
                                            }
                                        />
                                    ))}
                            </div>
                        </div>
                    </div>
                </>
            )}
        </section>
    );
}
