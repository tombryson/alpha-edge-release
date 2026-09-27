const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { readFileSync } = require('node:fs');
function load(path) {
    const result = {};
    new Function('exports', ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(result);
    return result;
}
const { createPollingCoordinator } = load('lib/polling.ts');
const { createSharedAPIReads } = load('lib/shared-api-reads.ts');
const flush = () => new Promise(resolve => setImmediate(resolve));
const base = 'http://localhost:3100/api/trading';
const options = { headers: { Authorization: 'Bearer fixture' } };

test('shared clock deduplicates store callbacks, preserves cadences and cleans up', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 100000 });
    const polling = createPollingCoordinator();
    let alerts = 0, holdings = 0;
    const readAlerts = async () => { alerts++; };
    const a = polling.subscribe(readAlerts, 30000);
    const b = polling.subscribe(readAlerts, 30000);
    const c = polling.subscribe(async () => { holdings++; }, 120000);
    await flush();
    assert.equal(alerts, 1);
    assert.equal(holdings, 1);
    for (let i = 0; i < 4; i++) { t.mock.timers.tick(30000); await flush(); }
    assert.equal(alerts, 5);
    assert.equal(holdings, 2);
    a(); b(); c();
    t.mock.timers.tick(120000); await flush();
    assert.equal(alerts, 5);
    assert.equal(holdings, 2);
});

test('slow requests do not overlap and disposed callbacks do not start', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 100000 });
    const polling = createPollingCoordinator();
    let calls = 0, finish;
    const stop = polling.subscribe(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, 5000);
    await flush();
    t.mock.timers.tick(30000); await flush();
    assert.equal(calls, 1);
    finish(); await flush();
    t.mock.timers.tick(1000); await flush();
    assert.equal(calls, 2);
    stop(); finish();
    polling.subscribe(() => { throw new Error('Disposed callback ran'); }, 5000)();
    await flush();
});

test('staggered mounts join the same cadence boundary instead of duplicating out-of-phase polls', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 120000 });
    const polling = createPollingCoordinator();
    const starts = [];
    const a = polling.subscribe(async () => { starts.push(['a', Date.now()]); }, 30000);
    await flush();
    t.mock.timers.tick(7000);
    const b = polling.subscribe(async () => { starts.push(['b', Date.now()]); }, 30000);
    await flush();
    starts.length = 0;
    t.mock.timers.tick(23000); await flush();
    assert.deepEqual(starts, [['a', 150000], ['b', 150000]]);
    a(); b();
});

test('hidden pages stop polling and resume due work once, without focus storms', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 100000 });
    const oldWindow = global.window, oldDocument = global.document;
    const events = new Map();
    const surface = prefix => ({ addEventListener: (key, fn) => events.set(prefix + key, fn), removeEventListener: key => events.delete(prefix + key) });
    global.window = surface('w'); global.document = { ...surface('d'), hidden: false };
    t.after(() => { global.window = oldWindow; global.document = oldDocument; });
    let calls = 0;
    const stop = createPollingCoordinator().subscribe(async () => { calls++; }, 30000);
    await flush();
    global.document.hidden = true; events.get('dvisibilitychange')();
    t.mock.timers.tick(120000); await flush();
    assert.equal(calls, 1);
    global.document.hidden = false;
    events.get('dvisibilitychange')(); events.get('wfocus')();
    await flush();
    assert.equal(calls, 2);
    events.get('wfocus')(); await flush();
    assert.equal(calls, 2);
    stop(); assert.equal(events.size, 0);
});

test('identical overlapping GETs share transport but have independently readable bodies and no cache', async () => {
    const reads = createSharedAPIReads(); let calls = 0;
    const loader = async () => { calls++; return Response.json({ value: 1 }); };
    const [a, b] = await Promise.all([reads.fetch(base + '/etf/allocation-ledger', options, loader, base), reads.fetch(base + '/etf/allocation-ledger', options, loader, base)]);
    assert.equal(calls, 1);
    assert.deepEqual(await a.json(), { value: 1 }); assert.deepEqual(await b.json(), { value: 1 });
    await reads.fetch(base + '/etf/allocation-ledger', options, loader, base);
    assert.equal(calls, 2);
});

test('query, credentials, cancellation and unrelated origins do not share reads', async () => {
    const reads = createSharedAPIReads(); let calls = 0;
    const loader = async () => { calls++; return Response.json([]); };
    await Promise.all([
        reads.fetch(base + '/security-actions?ticker=A', options, loader, base),
        reads.fetch(base + '/security-actions?ticker=B', options, loader, base),
        reads.fetch(base + '/security-actions?ticker=A', { headers: { Authorization: 'Bearer other' } }, loader, base),
        reads.fetch(base + '/security-actions?ticker=A', { ...options, signal: new AbortController().signal }, loader, base),
        reads.fetch('http://other/api/trading/security-actions?ticker=A', options, loader, base),
        reads.fetch(base + '/unknown', options, loader, base),
        reads.fetch(base + '/unknown', options, loader, base),
    ]);
    assert.equal(calls, 7);
});

test('writes invalidate both before and after completion; old response cannot evict a new read', async () => {
    const reads = createSharedAPIReads(); let finishOld, finishWrite, finishNew, calls = 0;
    const old = reads.fetch(base + '/portfolio', options, () => new Promise(resolve => { finishOld = resolve; }), base);
    await flush();
    const write = reads.fetch(base + '/settings', { ...options, method: 'PUT' }, () => new Promise(resolve => { finishWrite = resolve; }), base);
    await flush();
    const during = reads.fetch(base + '/portfolio', options, async () => { calls++; return Response.json({ revision: 1 }); }, base);
    await during;
    finishWrite(Response.json({})); await write;
    const current = reads.fetch(base + '/portfolio', options, () => { calls++; return new Promise(resolve => { finishNew = resolve; }); }, base);
    await flush();
    finishOld(Response.json({ revision: 0 })); await old;
    const joined = reads.fetch(base + '/portfolio', options, async () => { throw new Error('New request was incorrectly evicted'); }, base);
    finishNew(Response.json({ revision: 2 }));
    assert.deepEqual(await (await current).json(), { revision: 2 });
    assert.deepEqual(await (await joined).json(), { revision: 2 });
    assert.equal(calls, 2);
});

test('failed reads are not cached and failed writes are not retried or coalesced', async () => {
    const reads = createSharedAPIReads(); let calls = 0;
    const fail = async () => { calls++; throw new Error('offline'); };
    const failures = await Promise.allSettled([reads.fetch(base + '/portfolio', options, fail, base), reads.fetch(base + '/portfolio', options, fail, base)]);
    assert.equal(calls, 1); assert.ok(failures.every(result => result.status === 'rejected'));
    await assert.rejects(reads.fetch(base + '/portfolio', options, fail, base));
    await Promise.allSettled([reads.fetch(base + '/settings', { method: 'PUT' }, fail, base), reads.fetch(base + '/settings', { method: 'PUT' }, fail, base)]);
    assert.equal(calls, 4);
});
