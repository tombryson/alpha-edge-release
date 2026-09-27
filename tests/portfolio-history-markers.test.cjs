const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const buildDir =
    process.env.PORTFOLIO_HISTORY_MARKERS_BUILD_DIR ||
    '/tmp/alpha-edge-portfolio-history-markers';
const { buildPortfolioShapeConfirmations, portfolioShapePreviewRows, groupPortfolioShapeConfirmations, portfolioShapeMarkerLabel } = require(
    path.join(buildDir, 'lib', 'portfolio-history-markers.js'),
);

test('marker grouping preserves each approval and adapts to pixel space', () => {
    const items = [0, 10, 11, 80, 100].map((timeMs, index) => ({ id: `shape:${index}`, snapshotId: index, timeMs, label: `APPROVED v${index}` }));
    const original = JSON.stringify(items);
    const narrow = groupPortfolioShapeConfirmations(items, [0, 100], 320);
    const wide = groupPortfolioShapeConfirmations(items, [0, 100], 1000);
    assert.deepEqual(narrow.flat(), items);
    assert.deepEqual(wide.flat(), items);
    assert.ok(wide.length > narrow.length);
    assert.equal(JSON.stringify(items), original);
    assert.equal(portfolioShapeMarkerLabel([items[0]]), 'v0');
    assert.equal(portfolioShapeMarkerLabel(items), '5 approvals');
    assert.equal(portfolioShapeMarkerLabel([{ ...items[0], demo: true }]), 'Demo 0');
});

test('identical dates, unmeasured plots and empty data do not lose records', () => {
    const items = Array.from({ length: 25 }, (_, index) => ({ id: `shape:${index}`, snapshotId: index, timeMs: 10, label: `APPROVED v${index}` }));
    assert.equal(groupPortfolioShapeConfirmations(items, [0, 100], 1000).length, 1);
    assert.equal(groupPortfolioShapeConfirmations(items, [10, 10], 0)[0].length, 25);
    assert.deepEqual(groupPortfolioShapeConfirmations([], [0, 0], 0), []);
});

const entry = (overrides = {}) => ({
    id: 'shape:4',
    kind: 'shape',
    occurred_at: '2026-08-21T10:00:00Z',
    status: 'APPROVED',
    snapshot_id: 4,
    source: 'Portfolio target approval',
    ...overrides,
});

test('builds chronological labels from approved and superseded shape snapshots', () => {
    const markers = buildPortfolioShapeConfirmations(
        [
            entry(),
            entry({
                id: 'shape:3',
                occurred_at: '2026-07-10T10:00:00Z',
                status: 'SUPERSEDED',
                snapshot_id: 3,
            }),
            entry({ id: 'target:8', kind: 'target', snapshot_id: null }),
        ],
        null,
        Date.parse('2026-09-01T00:00:00Z'),
    );

    assert.deepEqual(
        markers.map(({ label, snapshotId }) => ({ label, snapshotId })),
        [
            { label: 'APPROVED v3', snapshotId: 3 },
            { label: 'APPROVED v4', snapshotId: 4 },
        ],
    );
});

test('filters confirmations outside the selected performance range', () => {
    const markers = buildPortfolioShapeConfirmations(
        [entry()],
        Date.parse('2026-08-22T00:00:00Z'),
        Date.parse('2026-09-01T00:00:00Z'),
    );
    assert.deepEqual(markers, []);
});

test('rejects draft, invalid, and future shape records', () => {
    const markers = buildPortfolioShapeConfirmations(
        [
            entry({ status: 'DRAFT' }),
            entry({ id: 'shape:bad', occurred_at: 'not-a-date' }),
            entry({ id: 'shape:future', occurred_at: '2026-10-01T00:00:00Z' }),
        ],
        null,
        Date.parse('2026-09-01T00:00:00Z'),
    );
    assert.deepEqual(markers, []);
});

const allocation = (asset_class, weight_pct) => ({ asset_class, display_name: asset_class, weight_pct });
const markersFor = (entries) => buildPortfolioShapeConfirmations(entries, null, Date.parse('2026-09-01T00:00:00Z'));

test('each approval retains its own locked percentages, including superseded versions', () => {
    const markers = markersFor([
        entry({ snapshot_id: 3, status: 'SUPERSEDED', occurred_at: '2026-08-20T10:00:00Z', rows: [allocation('Gold', 40), allocation('Cash', 60)] }),
        entry({ rows: [allocation('Gold', 25), allocation('Cash', 75)] }),
    ]);
    assert.equal(markers[0].shape.weights.get('GOLD'), 40);
    assert.equal(markers[1].shape.weights.get('GOLD'), 25);
    assert.equal(markers[0].shape.complete, true);
    assert.equal(markers[1].shape.total, 100);
});

test('missing allocations do not become zero or borrow the current shape', () => {
    const [marker] = markersFor([entry()]);
    assert.equal(marker.shape.weights.size, 0);
    assert.equal(marker.shape.total, null);
    assert.equal(marker.shape.complete, false);
});

test('partial shapes and zero allocations are shown as recorded, without rescaling', () => {
    const [marker] = markersFor([entry({ rows: [allocation('Gold', 94.7), allocation('Cash', 0)] })]);
    assert.equal(marker.shape.weights.get('GOLD'), 94.7);
    assert.equal(marker.shape.weights.get('CASH'), 0);
    assert.equal(marker.shape.total, 94.7);
    assert.equal(marker.shape.complete, false);
});

test('invalid or duplicate weights remain unavailable', () => {
    const [marker] = markersFor([entry({ rows: [allocation('Gold', 30), allocation('Gold', 20), allocation('Cash', -1)] })]);
    assert.equal(marker.shape.weights.get('GOLD'), null);
    assert.equal(marker.shape.weights.get('CASH'), null);
    assert.equal(marker.shape.total, null);
});

test('approval preview preserves the recorded display name and source data', () => {
    const rows = [{ asset_class: 'CUSTOM', display_name: 'Custom approved sleeve', weight_pct: 12.3456 }];
    const original = JSON.stringify(rows);
    const [marker] = markersFor([entry({ rows })]);
    assert.equal(marker.shape.names.get('CUSTOM'), 'Custom approved sleeve');
    assert.equal(marker.shape.weights.get('CUSTOM'), 12.3456);
    assert.equal(JSON.stringify(rows), original);
});

test('previous approval is retained even outside the visible chart range', () => {
    const [marker] = buildPortfolioShapeConfirmations([
        entry({ rows: [allocation('Gold', 25), allocation('Cash', 75)] }),
        entry({ snapshot_id: 3, status: 'SUPERSEDED', occurred_at: '2026-07-01T10:00:00Z', rows: [allocation('Gold', 40), allocation('Cash', 60)] }),
        entry({ snapshot_id: 5, status: 'DRAFT', occurred_at: '2026-08-01T10:00:00Z' }),
    ], Date.parse('2026-08-01T00:00:00Z'), Date.parse('2026-09-01T00:00:00Z'));
    assert.equal(marker.snapshotId, 4);
    assert.equal(marker.previousShape.version, 3);
    assert.equal(marker.previousShape.weights.get('GOLD'), 40);
});

test('ties use approval version order and demo predecessors cannot leak into real approvals', () => {
    const markers = markersFor([
        entry(),
        entry({ snapshot_id: 3, status: 'SUPERSEDED' }),
        entry({ id: 'demo:2', snapshot_id: 2, source: 'Portfolio history demo', occurred_at: '2026-08-20T10:00:00Z' }),
    ]);
    assert.equal(markers[0].previousShape, null);
    assert.equal(markers[1].previousShape, null);
    assert.equal(markers[2].previousShape.version, 3);
});

test('comparison includes added and removed classes, preserving explicit zero rows', () => {
    const [before, after] = markersFor([
        entry({ snapshot_id: 3, occurred_at: '2026-08-20T10:00:00Z', rows: [allocation('Gold', 40), allocation('Cash', 60)] }),
        entry({ rows: [allocation('Gold', 25), allocation('Silver', 75), allocation('Other', 0)] }),
    ]);
    const rows = portfolioShapePreviewRows(after.shape, before.shape);
    assert.deepEqual(rows.map(({ code, previous, approved }) => ({ code, previous, approved })), [
        { code: 'SILVER', previous: 0, approved: 75 },
        { code: 'GOLD', previous: 40, approved: 25 },
        { code: 'CASH', previous: 60, approved: 0 },
        { code: 'OTHER', previous: 0, approved: 0 },
    ]);
    assert.equal(portfolioShapePreviewRows(after.shape).length, 3);
});

test('an incomplete immediate predecessor is not skipped or silently treated as zero', () => {
    const markers = markersFor([
        entry({ snapshot_id: 2, occurred_at: '2026-08-18T10:00:00Z', rows: [allocation('Gold', 100)] }),
        entry({ snapshot_id: 3, occurred_at: '2026-08-20T10:00:00Z', rows: [allocation('Gold', 40)] }),
        entry({ rows: [allocation('Gold', 25), allocation('Silver', 75)] }),
    ]);
    const latest = markers[2];
    assert.equal(latest.previousShape.version, 3);
    const rows = portfolioShapePreviewRows(latest.shape, latest.previousShape);
    assert.equal(rows.find(row => row.code === 'SILVER').previous, null);
    assert.equal(rows.find(row => row.code === 'GOLD').previous, 40);
});
