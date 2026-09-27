const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { buildPortfolioRadialModel, radialPoint, radialSelectedIndex, radialSegments, radialOutline, spaceRadialLabels, wrapRadialLabel } = require(
    path.join(process.env.PORTFOLIO_RADIAL_BUILD_DIR || '/tmp/alpha-edge-portfolio-radial', 'lib/portfolio-radial.js'),
);

const datum = (code, current, target = null) => ({ code, name: code, current, target, color: '#123456' });

test('axes use stable canonical identity order, not input order, weights or names', () => {
    const a = [datum('SILVER_MINERS', 10, 20), datum('GOLD_MINERS', 60, 50), datum('CASH', 30, 30)];
    const b = [...a].reverse().map(row => ({ ...row, current: 100 - row.current, name: 'Renamed ' + row.name }));
    assert.deepEqual(buildPortfolioRadialModel(a).rows.map(row => row.code), buildPortfolioRadialModel(b).rows.map(row => row.code));
    assert.deepEqual(a.map(row => row.code), ['SILVER_MINERS', 'GOLD_MINERS', 'CASH']);
});

test('uses one absolute percent scale including the approved overlay', () => {
    const model = buildPortfolioRadialModel([datum('GOLD', 8, 34), datum('CASH', 1, 0)]);
    assert.equal(model.scaleMax, 40);
    assert.deepEqual(model.ticks, [10, 20, 30, 40]);
    assert.equal(model.rows.find(row => row.code === 'GOLD').current, 8);
});

test('does not normalize partial totals or invent missing classes', () => {
    const model = buildPortfolioRadialModel([datum('GOLD', 23, 25), datum('CASH', 2, 4)]);
    assert.equal(model.rows.length, 2);
    assert.equal(model.rows.reduce((sum, row) => sum + row.current, 0), 25);
    assert.equal(model.rows.reduce((sum, row) => sum + row.target, 0), 29);
});

test('keeps a missing target distinct from an approved zero', () => {
    const model = buildPortfolioRadialModel([datum('A', 4, 0), datum('B', 3), datum('C', 1, 5)]);
    assert.equal(model.rows[0].target, 0);
    assert.equal(model.rows[1].target, null);
    assert.equal(model.completeTarget, false);
});

test('invalid weights remain unavailable, not plotted at the centre', () => {
    const model = buildPortfolioRadialModel([datum('A', NaN, Infinity), datum('B', -2, -5)]);
    assert.ok(model.rows.every(row => row.current === null && row.target === null));
    assert.ok(Number.isFinite(model.scaleMax) && model.scaleMax > 0);
});

test('keeps all real classes, including target-only and cash rows', () => {
    const model = buildPortfolioRadialModel([datum('GOLD', 0, 10), datum('CASH', 100, 90)]);
    assert.deepEqual(model.rows.map(row => row.code), ['CASH', 'GOLD']);
    assert.equal(model.scaleMax, 100);
});

test('empty and all-zero portfolios have a finite nonzero axis', () => {
    assert.equal(buildPortfolioRadialModel([]).scaleMax, 10);
    assert.equal(buildPortfolioRadialModel([datum('A', 0, 0)]).scaleMax, 10);
    assert.equal(buildPortfolioRadialModel([]).completeTarget, false);
});

test('complete targets remain complete even with fewer than three classes', () => {
    assert.equal(buildPortfolioRadialModel([datum('A', 0, 0), datum('B', 0, 0)]).completeTarget, true);
    assert.equal(buildPortfolioRadialModel([datum('A', 0, 0), datum('B', 0, 0), datum('C', 0, 0)]).completeTarget, true);
});

test('missing observations break both adjacent segments, including the closing edge', () => {
    assert.deepEqual(radialSegments([null, 10, 20, 30]), [{ from: 1, to: 2 }, { from: 2, to: 3 }]);
    assert.deepEqual(radialSegments([10, null, 30, 40]), [{ from: 2, to: 3 }, { from: 3, to: 0 }]);
    assert.deepEqual(radialSegments([0, 0, 0]).length, 3);
    assert.deepEqual(radialSegments([10]), []);
});

test('radius is linear and clockwise axes start at the top', () => {
    assert.deepEqual(radialPoint(0, 4, 100, 200, 200), { x: 200, y: 100 });
    assert.deepEqual(radialPoint(1, 4, 100, 200, 200), { x: 300, y: 200 });
    const half = radialPoint(1, 4, 50, 200, 200);
    assert.equal(half.x - 200, 50);
});

test('pointer selection wraps correctly and ignores the ambiguous centre', () => {
    assert.equal(radialSelectedIndex(0, -100, 4), 0);
    assert.equal(radialSelectedIndex(100, 0, 4), 1);
    assert.equal(radialSelectedIndex(0, 100, 4), 2);
    assert.equal(radialSelectedIndex(-100, 0, 4), 3);
    assert.equal(radialSelectedIndex(0, 0, 4), null);
    assert.equal(radialSelectedIndex(100, 0, 0), null);
});

test('dense, multiline axis names have separate vertical slots', () => {
    const labels = Array.from({ length: 8 }, (_, index) => ({ index, y: 300 + index, height: index % 2 ? 32 : 16 }));
    const spaced = spaceRadialLabels(labels, 12, 328);
    assert.ok(spaced[0].y - spaced[0].height / 2 >= 12);
    assert.ok(spaced.at(-1).y + spaced.at(-1).height / 2 <= 328);
    for (let i = 1; i < spaced.length; i++) {
        assert.ok(spaced[i].y - spaced[i - 1].y >= (spaced[i].height + spaced[i - 1].height) / 2 + 6);
    }
});

test('the two-percent filter is strict and includes approved targets not yet held', () => {
    const input = [datum('A', 2, 2), datum('B', 2.001, 0), datum('C', 0, 4), datum('D', 1, 1)];
    const model = buildPortfolioRadialModel(input, 2);
    assert.deepEqual(model.rows.map(row => row.code), ['B', 'C']);
    assert.equal(model.totalClasses, 4);
    assert.equal(model.heldCoverage, 2.001);
    assert.equal(buildPortfolioRadialModel(input).rows.length, 4);
});

test('filtering changes only displayed classes, not weights or the shared radial scale', () => {
    const input = [datum('A', 33.7, 31), datum('B', 18, 21), datum('C', 1.9, 1.8), datum('D', 0, 4)];
    const all = buildPortfolioRadialModel(input);
    const filtered = buildPortfolioRadialModel(input, 2);
    assert.deepEqual(filtered.ticks, all.ticks);
    assert.equal(filtered.scaleMax, all.scaleMax);
    assert.equal(filtered.rows[0].current, 33.7);
    assert.equal(filtered.rows[0].target, 31);
    assert.equal(filtered.heldCoverage, 51.7);
    assert.deepEqual(filtered.rows.map(row => row.code), ['A', 'B', 'D']);
});

test('a class with unavailable holdings is not silently treated as negligible', () => {
    const model = buildPortfolioRadialModel([datum('A', null, 1), datum('B', 1), datum('C', 0, 5)], 2);
    assert.deepEqual(model.rows.map(row => row.code), ['A', 'C']);
    assert.equal(model.heldCoverage, null);
});

test('filtering to no classes leaves an empty result and the original scale', () => {
    const model = buildPortfolioRadialModel([datum('A', 2, 2), datum('B', 1.9, null)], 2);
    assert.deepEqual(model.rows, []);
    assert.equal(model.heldCoverage, 0);
    assert.equal(model.totalClasses, 2);
    assert.equal(model.scaleMax, 10);
});

test('complete outlines are a single closed path with joined vertices', () => {
    assert.equal(radialOutline([{ x: 0, y: 1 }, { x: 2, y: 3 }, { x: 4, y: 5 }]), 'M 0 1 L 2 3 L 4 5 Z');
    assert.equal(radialOutline([{ x: 0, y: 1 }, { x: 2, y: 3 }]), 'M 0 1 L 2 3');
    assert.equal(radialOutline([{ x: 0, y: 1 }]), '');
    assert.equal(radialOutline([]), '');
});

test('partial outlines connect around the wrap but never bridge missing observations', () => {
    const a = { x: 1, y: 2 }, b = { x: 3, y: 4 }, c = { x: 5, y: 6 };
    assert.equal(radialOutline([a, null, b, c]), 'M 3 4 L 5 6 L 1 2');
    assert.equal(radialOutline([null, a, b, null, c]), 'M 1 2 L 3 4 M 5 6');
    assert.equal(radialOutline([null, null, null]), '');
});

test('full asset-class names wrap within available space without replacing or truncating them', () => {
    const names = ['Base Metals Miners', 'Energy Producers', 'Rare Earths & Critical Minerals', 'Telecommunications'];
    const measure = text => text.length * 7;
    for (const width of [70, 110, 150]) {
        for (const name of names) {
            const lines = wrapRadialLabel(name, width, measure);
            assert.equal(lines.join('').replace(/\s/g, ''), name.replace(/\s/g, ''));
            assert.ok(lines.every(line => measure(line) <= width));
        }
    }
});

test('normal chart labels retain their existing balanced full-name presentation', () => {
    assert.deepEqual(wrapRadialLabel('Rare Earths & Critical Minerals', 150, text => text.length * 7), ['Rare Earths &', 'Critical Minerals']);
    assert.deepEqual(wrapRadialLabel('Gold Miners', 150, text => text.length * 7), ['Gold Miners']);
});
