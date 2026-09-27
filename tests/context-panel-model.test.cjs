const { test } = require('node:test');
const assert = require('node:assert/strict');
const model = require('/tmp/alpha-edge-context-panel/lib/context-panel-model.js');

test('saved ETF views persist; unsupported modes migrate to line', () => {
    for (const mode of ['numbers', null, undefined, 'invalid']) assert.equal(model.restoreAllocationView(mode), 'line');
    assert.equal(model.restoreAllocationView('map'), 'map');
    assert.equal(model.restoreAllocationView('ring'), 'ring');
    assert.equal(model.restorePanelView(undefined), 'etf');
    assert.equal(model.restorePanelView('class'), 'etf');
    assert.equal(model.restorePanelView('security'), 'security');
});
test('fill geometry is proportional, empty is empty, zero differs from unknown', () => {
    assert.deepEqual(model.allocationFill(0, 100), { funded: 0, excess: 0, unknown: false, ratio: 0 });
    assert.equal(model.allocationFill(50, 100).funded, 50);
    assert.equal(model.allocationFill(200, 100).excess, 50);
    assert.equal(model.allocationFill(1000, 100).excess, 90);
    assert.equal(model.allocationFill(100, 0).excess, 100);
    assert.equal(model.allocationFill(100, null).excess, 0);
    assert.equal(model.allocationFill(100, null).unknown, true);
});
test('fund matching does not collapse different exchanges or ambiguous bare symbols', () => {
    const rows = [{ ticker: 'ASX:ETF' }, { ticker: 'LSE:ETF' }];
    assert.equal(model.findByTicker(rows, 'ETF', row => row.ticker), undefined);
    assert.equal(model.findByTicker(rows, 'ASX:ETF', row => row.ticker), rows[0]);
    assert.equal(model.findByTicker([rows[0]], 'LSE:ETF', row => row.ticker), undefined);
    assert.equal(model.findByTicker([{ ticker: 'ETF' }], 'ASX:ETF', row => row.ticker).ticker, 'ETF');
});
test('line chips anchor 100% at 80% and reserve the last 20% for proportional excess', () => {
    for (const [held, funded, excess] of [[0, 0, 0], [50, 40, 0], [100, 80, 0], [110, 80, 8], [125, 80, 20], [200, 80, 20]]) {
        const fill = model.allocationLineFill(held, 100);
        assert.ok(Math.abs(fill.funded - funded) < 1e-8);
        assert.ok(Math.abs(fill.excess - excess) < 1e-8);
    }
    assert.equal(model.allocationLineFill(100, null).excess, 0);
    assert.equal(model.allocationLineFill(100, 0).excess, 20);
    assert.equal(model.allocationLineFill(0, 0).excess, 0);
    assert.equal(model.allocationLineFill(-10, 100).funded, 0);
});
test('ring shows target funding with a proportional red over-target arc, never red underfunding', () => {
    for (const [held, funded, excess] of [[0, 0, 0], [50, 50, 0], [100, 100, 0], [125, 100, 25], [150, 100, 50], [200, 100, 100], [1000, 100, 100]]) {
        const ring = model.allocationRingFill(held, 100);
        assert.equal(ring.funded, funded);
        assert.equal(ring.excess, excess);
        assert.equal(ring.unknown, false);
    }
    assert.deepEqual(model.allocationRingFill(100, null), { funded: 0, excess: 0, unknown: true });
    assert.deepEqual(model.allocationRingFill(0, null), { funded: 0, excess: 0, unknown: true });
    assert.deepEqual(model.allocationRingFill(100, 0), { funded: 0, excess: 100, unknown: false });
    assert.deepEqual(model.allocationRingFill(0, 0), { funded: 0, excess: 0, unknown: false });
    assert.equal(model.allocationRingFill(-10, 100).funded, 0);
    assert.equal(model.allocationRingFill(NaN, 100).funded, 0);
    assert.equal(model.allocationRingFill(100, NaN).unknown, true);
});
test('non-Core or off-mandate funds do not get a fabricated zero target', () => {
    const fund = { is_core: true, class_target_value: 1000, effective_target_value: 0 };
    assert.equal(model.etfTarget(fund), 0);
    assert.equal(model.etfTarget({ ...fund, is_core: false }), null);
    assert.equal(model.etfTarget({ ...fund, class_not_in_shape: true }), null);
});
test('allocation difference uses the effective fund target, with no fabricated percentage for zero or unknown targets', () => {
    for (const [actual, target, amount, percentage] of [
        [1250, 1000, 250, 25], [750, 1000, -250, -25], [0, 1000, -1000, -100],
        [1000, 1000, 0, 0], [500, 0, 500, null], [0, 0, 0, 0],
        [100, null, null, null], [NaN, 100, null, null], [100, NaN, null, null],
        [100, -10, null, null], [Infinity, 100, null, null], [100, Infinity, null, null],
    ]) assert.deepEqual(model.allocationDifference(actual, target), { amount, percentage });
});
test('shape comparison preserves saved classes, removed holdings and incomplete totals', () => {
    const rows = model.compareShapeRows([{ asset_class: 'GOLD_MINERS', display_name: 'Gold', weight_pct: 60 }], [{ asset_class: 'SILVER_MINERS', display_name: 'Silver', weight_pct: 20 }]);
    assert.deepEqual(rows.map(row => [row.code, row.target, row.current]), [['GOLD_MINERS', 60, 0], ['SILVER_MINERS', 0, 20]]);
    assert.equal(rows.reduce((sum, row) => sum + row.target, 0), 60);
});
test('history includes previous approvals, never draft shapes or memos', () => {
    const entries = ['APPROVED', 'SUPERSEDED', 'DRAFT'].map((status, i) => ({ kind: 'shape', status, occurred_at: `2026-0${i + 1}-01` }));
    assert.deepEqual(model.approvedHistory(entries).map(entry => entry.status), ['SUPERSEDED', 'APPROVED']);
});
