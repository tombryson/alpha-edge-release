const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const build = process.env.PORTFOLIO_COMPARISON_BUILD_DIR || '/tmp/alpha-edge-portfolio-comparison';
const { approvedShapeArchive, compareApprovedShapes, shapeHistorySelection, shapeClassIdentities } = require(path.join(build, 'lib/portfolio-shape-comparison.js'));
const { buildPortfolioRadialModel } = require(path.join(build, 'lib/portfolio-radial.js'));

const record = (id, weights, overrides = {}) => ({
    id: `shape:${id}`, snapshot_id: id, kind: 'shape', status: 'SUPERSEDED',
    occurred_at: `2026-06-${String(id).padStart(2, '0')}T12:00:00Z`,
    rows: Object.entries(weights).map(([code, value]) => ({ asset_class: code, display_name: code, weight_pct: value })),
    ...overrides,
});

test('only completed approvals are included, ordered chronologically and deduplicated', () => {
    const first = record(1, { GOLD: 100 });
    const second = record(2, { GOLD: 90, CASH: 10 }, { status: 'APPROVED' });
    const archive = approvedShapeArchive([second, first, first,
        record(3, {}, { kind: 'memo' }), record(4, {}, { kind: 'actual' }),
        record(5, {}, { status: 'DRAFT' }), record(6, {}, { occurred_at: 'bad date' })]);
    assert.deepEqual(archive.map(shape => shape.id), ['shape:1', 'shape:2']);
});

test('IDs break equal-timestamp ties without lexical v10/v9 ordering', () => {
    const at = '2026-06-01T12:00:00Z';
    const archive = approvedShapeArchive([record(10, {}, { occurred_at: at }), record(9, {}, { occurred_at: at })]);
    assert.deepEqual(archive.map(shape => shape.version), [9, 10]);
});

test('catalogue aliases resolve legacy classes without merging physical gold or custom classes', () => {
    const classes = [
        { code: 'GOLD_MINERS', asset_class_code: 'GOLD', display_name: 'Gold Miners', allow_target_weight: true },
        { code: 'PHYSICAL_GOLD', asset_class_code: 'PHYSICAL_GOLD', display_name: 'Physical Gold', allow_target_weight: true },
    ];
    const archive = approvedShapeArchive([record(1, { GOLD: 50, PHYSICAL_GOLD: 40, CUSTOM: 10 }), record(2, { GOLD_MINERS: 50, PHYSICAL_GOLD: 40, CUSTOM: 10 })], classes);
    const comparison = compareApprovedShapes(archive, archive[0], archive[1]);
    assert.equal(comparison.rows.length, 3);
    assert.ok(comparison.rows.every(row => row.difference === 0));
    assert.equal(comparison.rows.find(row => row.code === 'GOLDMINERS').name, 'Gold Miners');
    assert.ok(comparison.rows.some(row => row.code === 'CUSTOM'));
});

test('ambiguous catalogue aliases remain unresolved', () => {
    const map = shapeClassIdentities([
        { code: 'A', asset_class_code: 'OLD', display_name: 'A', allow_target_weight: true },
        { code: 'B', asset_class_code: 'OLD', display_name: 'B', allow_target_weight: true },
    ]);
    assert.equal(map.has('OLD'), false);
});

test('valid legacy aliases are summed but duplicate raw identities are unavailable', () => {
    const classes = [{ code: 'GOLD_MINERS', asset_class_code: 'GOLD', display_name: 'Gold Miners', allow_target_weight: true }];
    const [shape] = approvedShapeArchive([record(1, { GOLD: 30, GOLD_MINERS: 70 })], classes);
    assert.equal(shape.weights.get('GOLDMINERS'), 100);
    const duplicate = record(2, { GOLD: 50 });
    duplicate.rows.push(duplicate.rows[0]);
    assert.equal(approvedShapeArchive([duplicate], classes)[0].weights.get('GOLDMINERS'), null);
});

test('complete shapes give removed/new classes zero; partial shapes do not invent absent allocations', () => {
    const archive = approvedShapeArchive([record(1, { GOLD: 100 }), record(2, { SILVER: 100 }), record(3, { GOLD: 40 })]);
    const complete = compareApprovedShapes(archive, archive[0], archive[1]);
    assert.equal(complete.rows.find(row => row.code === 'GOLD').difference, -100);
    assert.equal(complete.rows.find(row => row.code === 'SILVER').difference, 100);
    const partial = compareApprovedShapes(archive, archive[1], archive[2]);
    assert.equal(partial.rows.find(row => row.code === 'SILVER').current, null);
    assert.equal(partial.rows.find(row => row.code === 'GOLD').current, 40);
    assert.equal(partial.concentration.length, 0);
});

test('invalid weights and duplicate normalised rows do not become zero', () => {
    const archive = approvedShapeArchive([record(1, { GOLD: -1, CASH: NaN }), record(2, { GOLD: 101 })]);
    assert.ok(archive.every(shape => shape.total === null && !shape.complete));
    assert.equal(archive[0].weights.get('GOLD'), null);
});

test('a positive historical change is later minus earlier, not a performance return', () => {
    const archive = approvedShapeArchive([record(1, { GOLD: 20, CASH: 80 }), record(2, { GOLD: 30, CASH: 70 })]);
    const row = compareApprovedShapes(archive, archive[0], archive[1]).rows.find(row => row.code === 'GOLD');
    assert.equal(row.target, 20);
    assert.equal(row.current, 30);
    assert.equal(row.difference, 10);
});

test('archive union, scale and major-class radial axes stay stable when dates change', () => {
    const archive = approvedShapeArchive([
        record(1, { GOLD: 70, CASH: 29, SILVER: 1 }),
        record(2, { GOLD: 50, CASH: 30, SILVER: 20 }),
        record(3, { GOLD: 60, CASH: 40 }),
    ]);
    const a = compareApprovedShapes(archive, archive[0], archive[1]);
    const b = compareApprovedShapes(archive, archive[1], archive[2]);
    const radialA = buildPortfolioRadialModel(a.rows, 2, a.peaks);
    const radialB = buildPortfolioRadialModel(b.rows, 2, b.peaks);
    assert.deepEqual(radialA.rows.map(row => row.code), radialB.rows.map(row => row.code));
    assert.equal(radialA.scaleMax, radialB.scaleMax);
    assert.equal(a.scale, b.scale);
});

test('concentration ranks each snapshot independently and reaches 100% without rescaling', () => {
    const archive = approvedShapeArchive([record(1, { A: 70, B: 20, CASH: 10 }), record(2, { A: 20, B: 60, CASH: 20 })]);
    const { concentration } = compareApprovedShapes(archive, archive[0], archive[1]);
    assert.equal(concentration[0].earlier, 70);
    assert.equal(concentration[0].later, 60);
    assert.equal(concentration[0].earlierName, 'A');
    assert.equal(concentration[0].laterName, 'B');
    assert.equal(concentration.at(-1).later, 100);
    assert.equal(concentration.at(-1).earlier, 100);
});

test('the major-class filter retains archive-wide missing coverage without moving spokes between dates', () => {
    const archive = approvedShapeArchive([record(1, { GOLD: 90 }), record(2, { GOLD: 99, CASH: 1 }), record(3, { GOLD: 99, CASH: 1 })]);
    const a = compareApprovedShapes(archive, archive[0], archive[1]);
    const b = compareApprovedShapes(archive, archive[1], archive[2]);
    const first = buildPortfolioRadialModel(a.rows, 2, a.peaks, a.incompleteCodes);
    const second = buildPortfolioRadialModel(b.rows, 2, b.peaks, b.incompleteCodes);
    assert.deepEqual(first.rows.map(row => row.code), second.rows.map(row => row.code));
    assert.ok(second.rows.some(row => row.code === 'CASH'));
});

test('date selection defaults to the latest pair and never reverses chronology', () => {
    const archive = approvedShapeArchive([record(1, {}), record(2, {}), record(3, {})]);
    assert.equal(shapeHistorySelection(archive, '', '').fromIndex, 1);
    assert.equal(shapeHistorySelection(archive, '', '').toIndex, 2);
    assert.equal(shapeHistorySelection(archive, 'shape:3', 'shape:2').fromIndex, 0);
    assert.equal(shapeHistorySelection([], '', '').from, undefined);
    assert.equal(shapeHistorySelection(archive.slice(0, 1), '', '').from, undefined);
});

test('loading earlier history preserves valid selected snapshot IDs', () => {
    const archive = approvedShapeArchive([record(1, {}), record(2, {}), record(3, {})]);
    const selection = shapeHistorySelection(archive, 'shape:2', 'shape:3');
    assert.equal(selection.from.id, 'shape:2');
    assert.equal(selection.to.id, 'shape:3');
});

test('display names are retained but history cannot override canonical colours', () => {
    const archive = approvedShapeArchive([record(1, { GOLD: 100, UNUSED: 0 }), record(2, { GOLD: 100 })]);
    const model = compareApprovedShapes(archive, archive[0], archive[1], { GOLD: { name: 'Gold', color: '#123456' } });
    assert.equal(model.rows.length, 1);
    assert.equal(model.rows[0].name, 'Gold');
    assert.equal(model.rows[0].color, 'var(--asset-class-colour-GOLD_MINERS, #d4a72c)');
});

test('history comparison uses read-only API methods and has no trading-action projection', () => {
    const source = readFileSync(path.join(__dirname, '../components/stock-table/portfolio-shape-comparison.tsx'), 'utf8');
    assert.deepEqual([...source.matchAll(/api\.(\w+)\(/g)].map(match => match[1]), ['getPortfolioShapeHistory']);
    assert.doesNotMatch(source, /derivePortfolioImplementationState|update.*Target|createAlert|localStorage/);
    assert.match(source, /<PortfolioRadialChart/);
    assert.match(source, /Previous From shape/);
    assert.match(source, /Previous To shape/);
});
