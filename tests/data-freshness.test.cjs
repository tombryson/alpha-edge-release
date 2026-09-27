const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const ts = require('typescript');
const exportsObject = {};
new Function('exports', ts.transpileModule(readFileSync('lib/data-freshness.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(exportsObject);
const { DATASET_LABELS, datasetFreshness, dataFreshnessIssues, createFreshnessResource } = exportsObject;
const complete = { id: 1, dataset: 'ETF_MOMENTUM', status: 'COMPLETE', update_mode: 'SCHEDULED_CALCULATION', coverage_complete: true, records_expected: 15, records_updated: 15, error_count: 0, data_fresh_through: '2026-09-14', stale_after_days: 4 };
const response = { generated_at: '2026-09-14T00:00:00Z', scheduler: {}, datasets: [complete] };

test('freshness distinguishes missing, partial, stale and failed evidence without guessing from event age', () => {
    assert.equal(datasetFreshness(complete).label, 'Current');
    for (const [patch, label] of [[{ status: 'STALE' }, 'Stale'], [{ status: 'FAILED' }, 'Failed'], [{ records_updated: 14 }, 'Incomplete'], [{ coverage_complete: false }, 'Incomplete'], [{ data_fresh_through: undefined }, 'Date unavailable'], [{ status: 'NEVER_RUN' }, 'Not loaded'], [{ status: 'RUNNING' }, 'Updating']]) assert.equal(datasetFreshness({ ...complete, ...patch }).label, label);
    assert.equal(datasetFreshness().label, 'Unavailable');
    assert.equal(datasetFreshness({ ...complete, dataset: 'TRADINGVIEW_SIGNALS', update_mode: 'EVENT_INGESTION', data_fresh_through: '2020-01-01', stale_after_days: 0 }).label, 'Received');
});

test('issue list hides healthy and quiet event feeds, retains missing data and orders failures before stale or partial data', () => {
    const data = { ...response, datasets: Object.keys(DATASET_LABELS).map(dataset => ({ ...complete, dataset })) };
    data.datasets.find(row => row.dataset === 'NEWS_DAILY').status = 'FAILED';
    data.datasets.find(row => row.dataset === 'ANALYSIS_PRICE_HISTORY').status = 'STALE';
    data.datasets.find(row => row.dataset === 'LISTING_VERIFICATION').coverage_complete = false;
    Object.assign(data.datasets.find(row => row.dataset === 'BROKER_STATEMENTS'), { update_mode: 'EVENT_INGESTION', data_fresh_through: '2020-01-01' });
    Object.assign(data.datasets.find(row => row.dataset === 'TRADINGVIEW_SIGNALS'), { update_mode: 'EVENT_INGESTION', status: 'NEVER_RUN' });
    assert.deepEqual(dataFreshnessIssues(data).map(issue => issue.dataset), ['NEWS_DAILY', 'ANALYSIS_PRICE_HISTORY', 'LISTING_VERIFICATION']);
    assert.deepEqual(dataFreshnessIssues(null), []);
    assert.equal(dataFreshnessIssues({ ...data, datasets: [] }).length, 8);
});

test('multiple consumers share one in-flight request and timer, retain evidence on failed reads, clean up on unmount', async t => {
    t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 100000 });
    let calls = 0, fail = false;
    const resource = createFreshnessResource(async () => { calls++; if (fail) throw new Error('offline'); return response; }, 1000);
    const first = resource.subscribe(() => {}), second = resource.subscribe(() => {});
    const a = resource.refresh(), b = resource.refresh();
    assert.equal(a, b);
    await a;
    assert.equal(calls, 1);
    fail = true;
    t.mock.timers.tick(1000);
    await resource.refresh();
    assert.equal(calls, 2);
    assert.equal(resource.getSnapshot().data, response);
    assert.equal(resource.getSnapshot().error, 'Freshness check unavailable');
    first(); second();
    t.mock.timers.tick(3000);
    assert.equal(calls, 2);
});

test('reset prevents an old authenticated response overwriting a new session', async () => {
    let resolveOld;
    let calls = 0;
    const resource = createFreshnessResource(() => ++calls === 1 ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve(response));
    const old = resource.refresh();
    await Promise.resolve();
    resource.reset();
    await resource.refresh();
    resolveOld({ ...response, datasets: [] });
    await old;
    assert.equal(resource.getSnapshot().data, response);
});

test('hidden tabs pause automatic reads and visible tabs resume only when due', async t => {
    t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 100000 });
    const previousWindow = global.window, previousDocument = global.document;
    const windowEvents = new Map(), documentEvents = new Map();
    const surface = events => ({ addEventListener: (name, callback) => events.set(name, callback), removeEventListener: name => events.delete(name) });
    global.window = surface(windowEvents);
    global.document = { ...surface(documentEvents), visibilityState: 'hidden' };
    t.after(() => { global.window = previousWindow; global.document = previousDocument; });
    let calls = 0;
    const resource = createFreshnessResource(async () => { calls++; return response; }, 1000);
    const unsubscribe = resource.subscribe(() => {});
    t.mock.timers.tick(2000);
    await Promise.resolve();
    assert.equal(calls, 0);
    global.document.visibilityState = 'visible';
    documentEvents.get('visibilitychange')();
    await resource.refresh();
    assert.equal(calls, 1);
    windowEvents.get('focus')();
    await Promise.resolve();
    assert.equal(calls, 1);
    unsubscribe();
    assert.equal(windowEvents.size, 0);
    assert.equal(documentEvents.size, 0);
});
