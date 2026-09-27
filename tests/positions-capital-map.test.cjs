const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const file = path.join(__dirname, '../lib/positions-capital-map.ts');
const compiled = new Module(file, module);
compiled._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { buildPositionsCapitalMap, capitalMapShare, capitalMapMatches, capitalMapAxisTicks, capitalMapPerformanceLevel } = compiled.exports;
const holding = (id, value, classCode = 'GOLD_MINERS') => ({ id, value, classCode, className: classCode === 'GOLD_MINERS' ? 'Gold Miners' : classCode, name: `Holding ${id}`, ticker: `ASX:X${id}`, isETF: id === 1 });

test('performance colour uses a fixed symmetric 50% scale, without inventing missing returns', () => {
    assert.deepEqual([-100, -50, -25, -5, 0, 5, 25, 50, 200].map(capitalMapPerformanceLevel), [-1, -1, -.5, -.1, 0, .1, .5, 1, 1]);
    for (const missing of [null, undefined, NaN, Infinity, -Infinity, '25']) assert.equal(capitalMapPerformanceLevel(missing), null);
});

test('map values are held capital, counted once, with ETFs retained in their actual classes', () => {
    const rows = [holding(1, 1000), holding(2, 3000), holding(3, 6000, 'SILVER_MINERS')];
    const original = JSON.stringify(rows);
    const model = buildPositionsCapitalMap(rows);
    assert.equal(model.total, 10000);
    assert.deepEqual(model.classes.map(group => [group.code, group.value]), [['SILVER_MINERS', 6000], ['GOLD_MINERS', 4000]]);
    assert.equal(model.classes[1].children[1].isETF, true);
    assert.equal(model.holdings.length, 3);
    assert.equal(JSON.stringify(rows), original, 'building the map must not mutate source positions or ordering');
    assert.equal(capitalMapShare(rows[0].value, 20000), 5, 'portfolio cash remains in the percentage denominator, not the holding area');
});

test('holding detail evidence survives grouping without changing capital weights', () => {
    const rows = [
        { ...holding(1, 1000), profitLossPercent: -12.34, trend: 'SELL' },
        { ...holding(2, 3000), profitLossPercent: 0, trend: 'BUY' },
        { ...holding(3, 6000), profitLossPercent: null, trend: null },
    ];
    const model = buildPositionsCapitalMap(rows);
    assert.equal(model.total, 10000);
    for (const row of rows) assert.deepEqual(model.holdings.find(item => item.id === row.id), row);
});

test('zero, negative and unavailable values do not create invented tile areas; small holdings stay exact', () => {
    const rows = [holding(1, 1000), holding(2, .01), holding(3, 0), holding(4, -200), holding(5, NaN), holding(6, Infinity)];
    const model = buildPositionsCapitalMap(rows);
    assert.equal(model.total, 1000.01);
    assert.deepEqual(model.holdings.map(row => row.value), [1000, .01]);
    assert.deepEqual(model.unplotted.map(row => row.id), [3, 4, 5, 6]);
    assert.deepEqual(buildPositionsCapitalMap([]), { classes: [], holdings: [], unplotted: [], total: 0 });
    assert.equal(capitalMapShare(100, 0), null);
    assert.equal(capitalMapShare(100, NaN), null);
    assert.equal(capitalMapShare(NaN, 1000), null);
});

test('class identity uses source codes, never names or order; stable ties and custom classes remain distinct', () => {
    const model = buildPositionsCapitalMap([holding(3, 100, 'MYCLASS'), holding(2, 100, 'MY_CLASS'), holding(1, 100, 'MY_CLASS'), holding(4, 10, '')]);
    assert.equal(model.classes.length, 3);
    assert.deepEqual(model.classes.find(group => group.code === 'MY_CLASS').children.map(row => row.id), [1, 2]);
    assert.ok(model.classes.some(group => group.code === 'UNASSIGNED'));
    assert.equal(model.holdings.length, 4);
});

test('search matches ticker, company and class without altering allocation weights', () => {
    const row = { ...holding(1, 100), name: 'Northern Gold Resources' };
    assert.equal(capitalMapMatches(row, 'asx:x1'), true);
    assert.equal(capitalMapMatches(row, 'gold northern'), true);
    assert.equal(capitalMapMatches(row, 'miners'), true);
    assert.equal(capitalMapMatches(row, 'silver'), false);
    assert.equal(capitalMapMatches(row, ''), true);
});

test('1D axis measures cumulative whole-portfolio share, not a rebased share of plotted holdings', () => {
    const ticks = capitalMapAxisTicks(9000, 10000);
    assert.deepEqual(ticks.map(tick => tick.percentage), [0, 25, 50, 75]);
    assert.equal(ticks[1].offset, 2500 / 9000);
    assert.equal(ticks[3].offset, 7500 / 9000);
    assert.deepEqual(capitalMapAxisTicks(10000, 10000).at(-1), { percentage: 100, offset: 1 });
});

test('1D axis adapts intervals for class focus while retaining the whole-portfolio denominator', () => {
    const ticks = capitalMapAxisTicks(2000, 10000);
    assert.deepEqual(ticks.map(tick => tick.percentage), [0, 5, 10, 15, 20]);
    assert.equal(ticks[1].offset, 500 / 2000);
    assert.deepEqual(capitalMapAxisTicks(5, 10000).map(tick => tick.percentage), [0, .02, .04]);
    assert.deepEqual(capitalMapAxisTicks(15000, 10000).map(tick => tick.percentage), [0, 50, 100, 150]);
});

test('1D axis does not fabricate percentages for absent or invalid totals', () => {
    for (const [visible, portfolio] of [[0, 100], [-1, 100], [100, 0], [100, -1], [NaN, 100], [100, NaN], [100, Infinity], [Infinity, 100], [1e308, 1e-308]]) {
        assert.deepEqual(capitalMapAxisTicks(visible, portfolio), []);
    }
});
