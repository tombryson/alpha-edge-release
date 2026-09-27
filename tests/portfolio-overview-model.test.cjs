const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const buildDir =
    process.env.PORTFOLIO_OVERVIEW_BUILD_DIR ||
    '/tmp/alpha-edge-portfolio-overview';
const {
    classifyPortfolioDifference,
    derivePortfolioImplementationState,
    estimatePortfolioRebalanceTurnover,
    joinPortfolioShapeRows,
} = require(path.join(buildDir, 'lib', 'portfolio-overview-model.js'));

const shapeRow = (asset_class, weight_pct) => ({ asset_class, display_name: asset_class, weight_pct, value: weight_pct * 100 });

test('approved-only classes and off-shape holdings both survive the overview join', () => {
    const rows = joinPortfolioShapeRows(
        [shapeRow('GOLD_MINERS', 20), shapeRow('TECHNOLOGY', 80)],
        [shapeRow('GOLD MINERS', 60), shapeRow('SILVER_MINERS', 40)], true,
    );
    assert.deepEqual(rows.map(row => [row.code, row.current, row.target]), [
        ['GOLDMINERS', 20, 60], ['SILVERMINERS', 0, 40], ['TECHNOLOGY', 80, null],
    ]);
    assert.equal(rows[1].value, 0);
    assert.equal(rows[2].status, 'no-target');
    assert.equal(rows[2].delta, null);
});

test('draft rows cannot become approved targets and tiny holdings are not dropped', () => {
    const rows = joinPortfolioShapeRows([shapeRow('GOLD_MINERS', 0.01)], [shapeRow('SILVER_MINERS', 100)], false);
    assert.deepEqual(rows.map(row => [row.code, row.current, row.target]), [['GOLDMINERS', 0.01, null]]);
});

test('approved ordering stays fixed when actual weights change, including equal targets', () => {
    const target = [shapeRow('SILVER_MINERS', 50), shapeRow('GOLD_MINERS', 50)];
    const order = current => joinPortfolioShapeRows(current, target, true).map(row => row.code);
    assert.deepEqual(order([shapeRow('SILVER_MINERS', 99), shapeRow('GOLD_MINERS', 1)]), order([shapeRow('SILVER_MINERS', 1), shapeRow('GOLD_MINERS', 99)]));
});

test('classifies approved-target differences using the portfolio tolerance', () => {
    assert.equal(classifyPortfolioDifference(10, null), 'no-target');
    assert.equal(classifyPortfolioDifference(10.49, 10), 'inline');
    assert.equal(classifyPortfolioDifference(10.5, 10), 'over');
    assert.equal(classifyPortfolioDifference(9.5, 10), 'under');
});

test('turnover is half the sum of absolute two-sided target differences', () => {
    assert.equal(
        estimatePortfolioRebalanceTurnover([
            { currentPct: 35, targetPct: 30 },
            { currentPct: 15, targetPct: 20 },
            { currentPct: 50, targetPct: 50 },
        ]),
        5,
    );
});

test('does not translate an under-target class into deployable capacity without overlay evidence', () => {
    assert.deepEqual(
        derivePortfolioImplementationState({
            differenceState: 'under',
            differencePp: -4,
            riskMode: 'NORMAL',
        }),
        {
            key: 'unassessed',
            label: 'Below target · capacity not assessed',
            deployablePp: 0,
        },
    );
});

test('separates permitted and constrained portions of an under-target class', () => {
    assert.deepEqual(
        derivePortfolioImplementationState({
            differenceState: 'under',
            differencePp: -4,
            riskMode: 'Q3_THROTTLE',
            actualInvestedPct: 6,
            allowedInvestedPct: 7.5,
        }),
        {
            key: 'constrained',
            label: 'Below target · 1.5pp permitted',
            deployablePp: 1.5,
        },
    );
});

test('Q4 suspends new deployment but does not manufacture an exit instruction', () => {
    assert.deepEqual(
        derivePortfolioImplementationState({
            differenceState: 'under',
            differencePp: -4,
            riskMode: 'Q4_CRISIS',
            actualInvestedPct: 6,
            allowedInvestedPct: 10,
        }),
        {
            key: 'suspended',
            label: 'Below target · new deployment suspended',
            deployablePp: 0,
        },
    );
});

test('a cash shortfall is a reserve floor issue, not deployable equity capacity', () => {
    assert.deepEqual(
        derivePortfolioImplementationState({
            differenceState: 'under',
            differencePp: -1,
            riskMode: 'NORMAL',
            isReserve: true,
            actualInvestedPct: 2.5,
            allowedInvestedPct: 3.5,
        }),
        {
            key: 'constrained',
            label: 'Below reserve floor · not deployable',
            deployablePp: 0,
        },
    );
});
