const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const buildDir =
    process.env.POSITION_SHAPE_BUILD_DIR || '/tmp/alpha-edge-position-shape';
const {
    calculatePositionShapeScaleMax,
    comparePositionAssetClassShapes,
    resolvePositionAssetClassShape,
} = require(path.join(buildDir, 'lib', 'position-asset-class-shape.js'));

const row = (assetClass, weightPct) => ({
    asset_class: assetClass,
    display_name: assetClass,
    display_order: 1,
    governed_by_q1: true,
    weight_pct: weightPct,
    invested_weight_pct: weightPct,
    sleeve_cash_weight_pct: 0,
    value: 0,
    invested_value: 0,
    sleeve_cash_value: 0,
});

test('resolves current and approved weights by normalized asset class', () => {
    const result = resolvePositionAssetClassShape({
        assetClassCode: 'GOLD_MINERS',
        currentRows: [row('GOLD_MINERS', 18.4)],
        approvedRows: [row('GOLD_MINERS', 22)],
        fallbackCurrentPct: 4,
    });

    assert.equal(result.assetClassCode, 'GOLDMINERS');
    assert.equal(result.currentPct, 18.4);
    assert.equal(result.targetPct, 22);
    assert.ok(Math.abs(result.driftPct - -3.6) < 0.000001);
});

test('keeps a missing approved target distinct from a zero target', () => {
    const missing = resolvePositionAssetClassShape({
        assetClassCode: 'SILVER_MINERS',
        currentRows: [row('SILVER_MINERS', 8.9)],
        approvedRows: [],
    });
    const zero = resolvePositionAssetClassShape({
        assetClassCode: 'SILVER_MINERS',
        currentRows: [row('SILVER_MINERS', 8.9)],
        approvedRows: [row('SILVER_MINERS', 0)],
    });

    assert.equal(missing.targetPct, null);
    assert.equal(missing.driftPct, null);
    assert.equal(zero.targetPct, 0);
    assert.equal(zero.driftPct, 8.9);
});

test('uses the group aggregate only when current mix has no matching row', () => {
    const result = resolvePositionAssetClassShape({
        assetClassCode: 'TECHNOLOGY',
        currentRows: [],
        approvedRows: [row('TECHNOLOGY', 12)],
        fallbackCurrentPct: 9.5,
    });

    assert.equal(result.currentPct, 9.5);
    assert.equal(result.targetPct, 12);
    assert.equal(result.driftPct, -2.5);
});

test('uses one rounded shared scale and excludes reserve rows', () => {
    const scale = calculatePositionShapeScaleMax({
        currentRows: [row('GOLD_MINERS', 33.7), row('CASH', 52)],
        approvedRows: [row('GOLD_MINERS', 31), row('SILVER_MINERS', 19.1)],
        assetClassCodes: ['GOLD_MINERS', 'SILVER_MINERS'],
    });

    assert.equal(scale, 35);
});

test('orders target and current weights in either direction', () => {
    const small = resolvePositionAssetClassShape({
        assetClassCode: 'SILVER_MINERS',
        currentRows: [row('SILVER_MINERS', 8)],
        approvedRows: [row('SILVER_MINERS', 10)],
    });
    const large = resolvePositionAssetClassShape({
        assetClassCode: 'GOLD_MINERS',
        currentRows: [row('GOLD_MINERS', 20)],
        approvedRows: [row('GOLD_MINERS', 25)],
    });

    assert.ok(comparePositionAssetClassShapes(small, large, 'target', 'desc') > 0);
    assert.ok(comparePositionAssetClassShapes(small, large, 'current', 'asc') < 0);
});

test('orders absolute drift and always leaves missing targets last', () => {
    const smallDrift = resolvePositionAssetClassShape({
        assetClassCode: 'SILVER_MINERS',
        currentRows: [row('SILVER_MINERS', 8)],
        approvedRows: [row('SILVER_MINERS', 10)],
    });
    const largeDrift = resolvePositionAssetClassShape({
        assetClassCode: 'GOLD_MINERS',
        currentRows: [row('GOLD_MINERS', 20)],
        approvedRows: [row('GOLD_MINERS', 25)],
    });
    const missingTarget = resolvePositionAssetClassShape({
        assetClassCode: 'TECHNOLOGY',
        currentRows: [row('TECHNOLOGY', 30)],
        approvedRows: [],
    });

    assert.ok(
        comparePositionAssetClassShapes(
            smallDrift,
            largeDrift,
            'drift',
            'desc',
        ) > 0,
    );
    assert.ok(
        comparePositionAssetClassShapes(
            missingTarget,
            smallDrift,
            'target',
            'asc',
        ) > 0,
    );
});
