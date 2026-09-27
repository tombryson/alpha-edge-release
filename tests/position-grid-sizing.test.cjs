const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const file = resolve('components/stock-table/position-grid-sizing.ts');
const loaded = new Module(file, module);
loaded._compile(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, file);
const { resolvePositionGridColumns: layout, parsePositionColumnWidths: parse, migratePositionColumnWidths: migrate, clampPositionColumnWidth: clamp } = loaded.exports;
const columns = [
    { key: 'name', widthPx: 224, minWidthPx: 190, manualMinWidthPx: 128, manualMaxWidthPx: 1200, fillWeight: 1 },
    { key: 'cdf', widthPx: 65, minWidthPx: 65, manualMinWidthPx: 38, growWeight: .2 },
    { key: 'mktValue', widthPx: 90, minWidthPx: 80, manualMinWidthPx: 58, fillWeight: .5 },
];
const sizes = result => result.map(column => column.widthPx);

test('automatic defaults fill wide panels, shrink only to readable minima, then overflow', () => {
    for (const width of [500, 780, 1366, 2560]) {
        const result = layout(columns, width, {}, 'normal');
        assert.equal(sizes(result).reduce((a, b) => a + b), width);
        assert.ok(result.every(column => Number.isInteger(column.widthPx)));
    }
    assert.deepEqual(sizes(layout(columns, 280, {}, 'normal')), [190, 65, 80]);
});

test('saved pixels do not change with panel size, data-derived bases or visible neighbours', () => {
    const widths = { 'normal:name': 350, 'normal:cdf': 130, 'normal:mktValue': 200 };
    for (const panel of [280, 800, 2560]) assert.deepEqual(sizes(layout(columns, panel, widths, 'normal')), [350, 130, 200]);
    assert.deepEqual(sizes(layout(columns.map(column => ({ ...column, widthPx: column.widthPx + 80, minWidthPx: column.minWidthPx + 10 })), 800, widths, 'normal')), [350, 130, 200]);
    assert.deepEqual(sizes(layout([columns[2], columns[0]], 800, widths, 'normal')), [200, 350]);
});

test('resizing remains valid at the exact base width and accepts narrow explicit widths', () => {
    const widths = { 'normal:name': 224, 'normal:cdf': 38, 'normal:mktValue': 58 };
    assert.deepEqual(sizes(layout(columns, 1200, widths, 'normal')), [224, 38, 58]);
    assert.equal(clamp(columns[0], -1000), 128);
    assert.equal(clamp(columns[0], 2000), 1200);
});

test('saving an automatically wide numeric column does not shrink it to its default drag limit', () => {
    assert.deepEqual(sizes(layout(columns, 1000, { 'normal:name': 250, 'normal:cdf': 90, 'normal:mktValue': 660 }, 'normal')), [250, 90, 660]);
});

test('new or reset automatic columns use free space without changing saved columns', () => {
    const result = layout(columns, 700, { 'normal:name': 300, 'normal:cdf': null }, 'normal');
    assert.equal(result[0].widthPx, 300);
    assert.equal(sizes(result).reduce((a, b) => a + b), 700);
    assert.equal(layout(columns, 200, { 'normal:name': 300 }, 'normal')[0].widthPx, 300);
});

test('old deltas migrate once; explicit resets and other modes remain independent', () => {
    const legacy = { 'normal:name': -24, 'normal:cdf': 0, 'normal:mktValue': 80, 'review:name': 50 };
    assert.deepEqual(migrate(columns, 'normal', {}, legacy), { 'normal:name': 200, 'normal:cdf': 65, 'normal:mktValue': 170 });
    const current = { 'normal:name': null, 'normal:cdf': 95 };
    assert.deepEqual(migrate(columns, 'normal', current, legacy), { ...current, 'normal:mktValue': 170 });
    assert.deepEqual(migrate(columns, 'normal-mobile', {}, legacy), {});
});

test('invalid storage cannot produce negative, NaN or unbounded table widths', () => {
    for (const raw of ['{', '[]', 'null', 'false']) assert.deepEqual(parse(raw), {});
    assert.deepEqual(parse('{"normal:name":300,"normal:cdf":null,"bad":-200,"zero":0,"huge":1e99,"text":"300"}'), { 'normal:name': 300, 'normal:cdf': null });
});
