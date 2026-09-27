const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPositionModelWeights, isSizingUniverseStock, isModelWeightHolding, hasMissingSizingResearch, comparePositionModelWeights, positionWeightTone } = require('/tmp/alpha-edge-model-weight/lib/positions-model-weight.js');
const { calculateAnalysisTargetWeight } = require('/tmp/alpha-edge-model-weight/lib/analysis-metrics.js');
const stock = (id, patch = {}) => ({ id, symbol: `S${id}`, prefix: 'ASX:', primaryAssetClass: 'BANKS', position: 10, positionValue: 100,
    geminiQuality: 80, geminiValue: 80, geminiPT: 12, price: 10, ...patch });
const ledger = (stockCapacity = 750) => ({ classes: [{ asset_class: 'BANKS', class_target_value: 1000, stock_capacity_value: stockCapacity }],
    rows: [{ ticker: 'ASX:MVB', asset_class: 'BANKS', is_core: true, effective_target_value: 250 }] });
// The backend returns these within-class percentages; projection must not rank or rescore them.
const allocation = pct => ({ allocation_pct: pct, base_rating: 80, eligible_for_target_weight: true });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('Ideal wt colour compares the displayed class mix, independently of class funding', () => {
    const weight = { percent: 20, dollar: 2000, reason: '', stretchRatio: 1.5 };
    for (const [actual, tone] of [[0, 'under'], [19.9, 'under'], [20, 'aligned'], [20.04, 'aligned'],
        [29.9, 'neutral'], [30, 'overstretch'], [60, 'overstretch']]) {
        assert.equal(positionWeightTone(actual, weight), tone);
    }
    assert.equal(positionWeightTone(24.9, { ...weight, stretchRatio: 1.25 }), 'neutral');
    assert.equal(positionWeightTone(25, { ...weight, stretchRatio: 1.25 }), 'overstretch');
    // Single-security classes match at 100% even when the class budget is not fully deployed.
    assert.equal(positionWeightTone(100, { ...weight, percent: 100, dollar: 3000 }), 'aligned');
    for (const patch of [{ stretchRatio: undefined }, { percent: 0 }, { percent: null }, { percent: NaN }]) {
        assert.equal(positionWeightTone(30, { ...weight, ...patch }), 'neutral');
    }
    for (const actual of [null, undefined, Infinity, NaN, -1]) assert.equal(positionWeightTone(actual, weight), 'neutral');
    assert.equal(positionWeightTone(100), 'neutral');
});

test('holdings choose membership independently of Analysis IN/OUT; exits, watchlist, external and excluded tokens do not enter', () => {
    assert.equal(isSizingUniverseStock(stock(1, { includeInSizing: false }), 'holdings'), true);
    assert.equal(isSizingUniverseStock(stock(1, { includeInSizing: false }), 'analysis'), false);
    for (const patch of [{ position: 0, positionValue: 0 }, { isWatchlist: true }, { isExternal: true }, { securityType: 'CVR' }, { securityType: 'NON_ALLOCATING' }]) {
        assert.equal(isSizingUniverseStock(stock(1, patch), 'holdings'), false);
    }
    assert.equal(isModelWeightHolding(stock(1, { positionValue: 0 })), true);
    assert.equal(isSizingUniverseStock(stock(1, { securityType: 'ETF' }), 'holdings'), false);
});

test('whole-class weights use the ETF split, not rounded Analysis percentages', () => {
    const holdings = [stock(1), stock(2), stock(3, { symbol: 'MVB', securityType: 'ETF' })];
    const weights = buildPositionModelWeights(holdings, new Map([[1, allocation(200 / 3)], [2, allocation(100 / 3)]]), ledger(), true);
    near(weights.get(1).percent, 50);
    near(weights.get(2).percent, 25);
    near(weights.get(3).percent, 25);
    near(weights.get(1).dollar, 500);
    near(weights.get(2).dollar, 250);
    near(weights.get(3).dollar, 250);
});

test('uses remaining capacity when held ETFs exceed their targets; blocked targets are zero, not missing', () => {
    const weights = buildPositionModelWeights([stock(1)], new Map([[1, allocation(100)]]), ledger(600), true);
    near(weights.get(1).percent, 60);
    const blocked = ledger(1000); blocked.rows[0].effective_target_value = 0;
    near(buildPositionModelWeights([stock(3, { symbol: 'MVB', securityType: 'ETF' })], new Map(), blocked, true).get(3).percent, 0);
    near(buildPositionModelWeights([stock(1)], new Map([[1, allocation(100)]]), ledger(0), true).get(1).percent, 0);
});

test('missing held evidence suppresses the class stock weights, not Core ETFs or other classes', () => {
    const missing = stock(2, { geminiPT: 0, includeInSizing: false });
    assert.equal(hasMissingSizingResearch(missing), true);
    assert.equal(hasMissingSizingResearch(stock(3, { securityType: 'ETF', geminiPT: 0 })), false);
    assert.equal(hasMissingSizingResearch(stock(4, { isWatchlist: true, includeInSizing: false, geminiPT: 0 })), false);
    const result = buildPositionModelWeights([stock(1), missing, stock(3, { symbol: 'MVB', securityType: 'ETF' })], new Map([[1, allocation(100)], [2, allocation(0)]]), ledger(), true);
    assert.equal(result.get(1).percent, null);
    assert.equal(result.get(2).percent, null);
    assert.equal(result.get(2).dollar, null);
    assert.match(result.get(2).reason, /Incomplete class research/);
    near(result.get(3).percent, 25);
    for (const patch of [{ isWatchlist: true }, { isExternal: true }, { primaryAssetClass: 'GOLD_MINERS' }]) {
        const other = buildPositionModelWeights([stock(1), { ...missing, ...patch }], new Map([[1, allocation(100)]]), ledger(), true);
        near(other.get(1).percent, 75);
    }
    near(buildPositionModelWeights([stock(1)], new Map([[1, allocation(0)]]), ledger(), true).get(1).percent, 0);
    near(buildPositionModelWeights([stock(1)], new Map([[1, allocation(0)]]), ledger(), true).get(1).dollar, 0);
});

test('unknown budget or failed sizing does not fall back to a made-up whole-class target', () => {
    for (const [book, ready] of [[null, true], [ledger(), false], [{ ...ledger(), classes: [] }, true]]) {
        assert.equal(buildPositionModelWeights([stock(1)], new Map([[1, allocation(100)]]), book, ready).get(1).percent, null);
    }
    assert.equal(buildPositionModelWeights([stock(1)], new Map(), ledger(), true).get(1).percent, null);
    const foreignETF = stock(3, { prefix: 'NYSE:', symbol: 'MVB', securityType: 'ETF' });
    assert.equal(buildPositionModelWeights([foreignETF], new Map(), ledger(), true).get(3).percent, null);
});

test('identical universes agree after converting stock-budget shares; entering/exiting changes only the held denominator', () => {
    const a = stock(1), b = stock(2, { geminiQuality: 40, geminiValue: 40 }), candidate = stock(3, { isWatchlist: true });
    const size = stocks => {
        const total = stocks.reduce((sum, row) => sum + calculateAnalysisTargetWeight(row), 0);
        return new Map(stocks.map(row => [row.id, allocation(calculateAnalysisTargetWeight(row) / total * 100)]));
    };
    const research = size([a, b, candidate]);
    const held = [a, b, candidate].filter(isModelWeightHolding);
    const weights = buildPositionModelWeights(held, size(held), ledger(), true);
    near(weights.get(1).percent, 60); near(weights.get(2).percent, 15);
    assert.ok(research.get(1).allocation_pct < size(held).get(1).allocation_pct);
    for (const row of held) near(weights.get(row.id).percent, size(held).get(row.id).allocation_pct * 0.75);
    const exited = [a, { ...b, position: 0, positionValue: 0 }].filter(isModelWeightHolding);
    near(buildPositionModelWeights(exited, size(exited), ledger(), true).get(1).percent, 75);
});

test('sorting keeps unavailable weights last in either direction', () => {
    for (const direction of ['asc', 'desc']) {
        assert.equal(comparePositionModelWeights({ percent: null }, { percent: 0 }, direction), 1);
        assert.equal(comparePositionModelWeights({ percent: 0 }, undefined, direction), -1);
    }
    assert.ok(comparePositionModelWeights({ percent: 20 }, { percent: 10 }, 'desc') < 0);
});
