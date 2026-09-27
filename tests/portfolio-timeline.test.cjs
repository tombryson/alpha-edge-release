const test = require('node:test');
const assert = require('node:assert/strict');
const root = '/tmp/alpha-edge-timeline';
const {
    intelligencePortfolioMemo,
    memoHistoryEntry,
    mergePortfolioArchive,
    memoBasedExamples,
    compareTimelineRows,
    memoAllocationRows,
} = require(`${root}/lib/portfolio-timeline.js`);
const route = require(`${root}/app/api/council/portfolio-memos/route.js`);
const artifact = (id = 'run-1.json', gold = 40) => ({
    id,
    analysis_kind: 'portfolio_positioning',
    updated_at: '2026-09-01',
    structured_data: {
        analysis_date: '2026-08-30',
        strategic_view: { primary_theme: 'Fixture theme' },
        executive_summary: 'Fixture evidence',
        asset_class_targets: [
            {
                asset_class: 'GOLD_MINERS',
                display_name: 'Gold Miners',
                target_pct: gold,
            },
            {
                asset_class: 'CASH',
                display_name: 'Cash',
                target_pct: 100 - gold,
            },
        ],
    },
    analyst_document: { content_markdown: '# Analyst\nEvidence' },
    chairman_memo_markdown: '# Conclusion\nDecision',
});

test('Intelligence artifacts preserve date, allocation, documents and stable run identity', () => {
    const memo = intelligencePortfolioMemo(artifact());
    assert.equal(memo.memo_job_id, 'intelligence:run-1.json');
    assert.equal(memo.run_id, 'run-1.json');
    assert.equal(memo.primary_theme, 'Fixture theme');
    assert.equal(memo.analysis_date, '2026-08-30');
    assert.match(memo.analyst_memo_markdown, /Analyst/);
    assert.equal(memoAllocationRows(memo)[0].weight_pct, 40);
    assert.throws(() =>
        intelligencePortfolioMemo({ id: 'stock.json', analysis_kind: 'stock' }),
    );
});

test('archive deduplicates saved run IDs and only explicit plans link approvals', () => {
    const memo = intelligencePortfolioMemo(artifact());
    const saved = {
        ...memoHistoryEntry(memo),
        id: 'memo:original-job',
        memo_job_id: 'original-job',
    };
    const manual = {
        id: 'shape:1',
        kind: 'shape',
        occurred_at: '2026-09-01',
        rows: [],
    };
    const linked = { ...manual, id: 'shape:2', plan_id: 12 };
    const target = {
        ...manual,
        id: 'target:12',
        kind: 'target',
        plan_id: 12,
        memo_job_id: 'original-job',
    };
    const result = mergePortfolioArchive(
        [saved, manual, linked, target],
        [memo],
    );
    assert.equal(result.filter((e) => e.kind === 'memo').length, 1);
    assert.equal(result.find((e) => e.id === 'shape:1').memo_job_id, undefined);
    assert.equal(
        result.find((e) => e.id === 'shape:2').memo_job_id,
        'original-job',
    );
    assert.equal(linked.memo_job_id, undefined, 'input must not be mutated');
});

test('memo examples reproduce supplied weights without inventing dates, normalization or actual approval', () => {
    const a = intelligencePortfolioMemo(artifact());
    const b = intelligencePortfolioMemo(artifact('run-2.json', 20));
    b.asset_class_targets[1].target_pct = 70;
    const examples = memoBasedExamples([a, b]);
    assert.equal(examples.length, 2);
    assert.ok(
        examples.every(
            (e) =>
                e.status === 'EXAMPLE' &&
                !e.snapshot_id &&
                e.id.startsWith('memo-preview:'),
        ),
    );
    assert.equal(
        examples
            .find((e) => e.memo_job_id === b.memo_job_id)
            .rows.reduce((n, r) => n + r.weight_pct, 0),
        90,
    );
    assert.equal(examples[0].occurred_at, '2026-08-30');
    assert.notDeepEqual(examples[0].rows, examples[1].rows);
});

test('comparison includes removed classes and never aliases unknown classes into broad equity', () => {
    const row = (code, n) => ({
        asset_class: code,
        display_name: code,
        weight_pct: n,
    });
    const rows = compareTimelineRows(
        [row('ENERGYPRODUCERS', 20), row('CUSTOM_ALPHA', 3)],
        [row('ENERGY', 30), row('CUSTOM_BETA', 7)],
    );
    assert.equal(rows.length, 3);
    assert.equal(rows[0].difference, -10);
    assert.equal(
        rows.find((r) => r.asset_class === 'CUSTOM_BETA').difference,
        -7,
    );
});

test('missing, negative and nonnumeric targets are not silently represented as zero', () => {
    const memo = intelligencePortfolioMemo(artifact());
    memo.asset_class_targets = [
        null,
        '',
        ' ',
        'NaN',
        -2,
        undefined,
        false,
        true,
    ].map((target_pct) => ({ asset_class: 'CASH', target_pct }));
    assert.deepEqual(memoAllocationRows(memo), []);
});

test('archive proxy authenticates, separates credentials, reads artifacts only and reports partial failures', async (t) => {
    const original = global.fetch;
    const env = { ...process.env };
    t.after(() => {
        global.fetch = original;
        process.env = env;
    });
    process.env.COUNCIL_API_TOKEN = 'service-token';
    process.env.NEXT_PUBLIC_API_URL = 'https://backend.test/api';
    const calls = [];
    global.fetch = async (url, init) => {
        calls.push(url);
        assert.ok(!init.method || init.method === 'GET');
        if (url.endsWith('/auth/check')) {
            assert.equal(init.headers.Authorization, 'Bearer caller');
            return new Response(null, { status: 204 });
        }
        assert.equal(init.headers.get('Authorization'), 'Bearer service-token');
        if (url.includes('?limit='))
            return Response.json({
                runs: [{ id: 'run-1.json' }, { id: 'missing.json' }],
            });
        if (url.endsWith('missing.json'))
            return new Response('', { status: 404 });
        return Response.json(artifact());
    };
    const missing = await route.GET(
        new Request('https://terminal.test/api/council/portfolio-memos'),
    );
    assert.equal(missing.status, 401);
    assert.equal(calls.length, 0);
    const result = await route.GET(
        new Request('https://terminal.test/api/council/portfolio-memos', {
            headers: { Authorization: 'Bearer caller' },
        }),
    );
    const body = await result.json();
    assert.equal(body.memos.length, 1);
    assert.deepEqual(body.unavailable, ['missing.json']);
    assert.ok(calls.every((url) => !url.includes('/analysis-jobs/')));
    assert.doesNotMatch(JSON.stringify(body), /service-token|caller/);
});
