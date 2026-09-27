const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const buildDir =
    process.env.PORTFOLIO_GROUP_DIAL_BUILD_DIR ||
    '/tmp/alpha-edge-portfolio-group-dial';
const { buildPortfolioGroupDialModel } = require(
    path.join(buildDir, 'lib', 'portfolio-group-dial.js'),
);

const row = (assetClass, displayName, weightPct, displayOrder = 0) => ({
    asset_class: assetClass,
    display_name: displayName,
    display_order: displayOrder,
    weight_pct: weightPct,
});

test('comparison is ordered by approved weights, independent of holdings movement', () => {
    const approvedRows = [row('GOLD_MINERS', 'Gold', 60), row('SILVER_MINERS', 'Silver', 40)];
    const model = buildPortfolioGroupDialModel({ approvedRows, currentRows: [row('TECHNOLOGY', 'Tech', 90), row('GOLD_MINERS', 'Gold', 10)] });
    assert.deepEqual(model.slices.map(row => row.key), ['GOLDMINERS', 'SILVERMINERS', 'TECHNOLOGY']);
    assert.equal(model.slices[1].currentPct, 0);
    assert.equal(model.slices[2].targetPct, 0);
});

test('preserves canonical asset classes instead of inventing portfolio blocks', () => {
    const model = buildPortfolioGroupDialModel({
        currentRows: [
            row('ENERGY_PRODUCERS', 'Energy Producers', 33.7, 1),
            row('GOLD_MINERS', 'Gold Miners', 22.1, 2),
            row('PHARMA_BIOTECH', 'Pharma & Biotech', 14.3, 3),
            row('SILVER_MINERS', 'Silver Miners', 8.9, 4),
            row(
                'RARE_EARTHS_CRITICAL_MINERALS',
                'Rare Earths & Critical Minerals',
                3.3,
                5,
            ),
            row('HEALTHCARE_SERVICES', 'Healthcare Services', 2.9, 6),
        ],
        approvedRows: [],
    });

    assert.deepEqual(
        model.slices.map((slice) => slice.label),
        [
            'Energy Producers',
            'Gold Miners',
            'Pharma & Biotech',
            'Silver Miners',
            'Rare Earths & Critical Minerals',
            'Healthcare Services',
        ],
    );
    assert.equal(
        model.slices.some((slice) => slice.label === 'Satellites'),
        false,
    );
});

test('joins approved and current weights by canonical asset-class identity', () => {
    const model = buildPortfolioGroupDialModel({
        currentRows: [
            row('GOLD_MINERS', 'Gold Miners', 20, 1),
            row('HEALTHCARE_SERVICES', 'Healthcare Services', 8, 2),
        ],
        approvedRows: [
            row('GOLD MINERS', 'Gold Miners', 25, 1),
            row('ENERGY_PRODUCERS', 'Energy Producers', 15, 3),
        ],
    });

    const gold = model.slices.find((slice) => slice.key === 'GOLDMINERS');
    const energy = model.slices.find(
        (slice) => slice.key === 'ENERGYPRODUCERS',
    );
    assert.deepEqual(
        {
            currentPct: gold.currentPct,
            targetPct: gold.targetPct,
            driftPct: gold.driftPct,
        },
        { currentPct: 20, targetPct: 25, driftPct: -5 },
    );
    assert.deepEqual(
        {
            currentPct: energy.currentPct,
            targetPct: energy.targetPct,
        },
        { currentPct: 0, targetPct: 15 },
    );
});

test('does not manufacture reserve when portfolio rows total below 100', () => {
    const model = buildPortfolioGroupDialModel({
        currentRows: [row('GOLD_MINERS', 'Gold Miners', 25)],
        approvedRows: [],
    });

    assert.equal(model.currentSourceTotalPct, 25);
    assert.deepEqual(
        model.slices.map((slice) => slice.label),
        ['Gold Miners'],
    );
});

test('does not rescale source weights that total above 100', () => {
    const model = buildPortfolioGroupDialModel({
        currentRows: [
            row('GOLD_MINERS', 'Gold Miners', 60),
            row('TECHNOLOGY', 'Technology', 60),
        ],
        approvedRows: [],
    });

    assert.equal(model.currentSourceTotalPct, 120);
    assert.equal(
        model.slices.reduce((sum, slice) => sum + slice.currentPct, 0),
        120,
    );
});

test('reports an empty model without creating placeholder categories', () => {
    const model = buildPortfolioGroupDialModel({
        currentRows: [],
        approvedRows: [],
    });

    assert.equal(model.hasCurrent, false);
    assert.equal(model.hasTarget, false);
    assert.deepEqual(model.slices, []);
});
