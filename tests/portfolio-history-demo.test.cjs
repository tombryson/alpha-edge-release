const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildPortfolioHistoryDemo, portfolioHistoryDemoAllowed } = require('/tmp/alpha-edge-history-demo/lib/portfolio-history-demo.js');
const { buildPortfolioShapeConfirmations } = require('/tmp/alpha-edge-history-demo/lib/portfolio-history-markers.js');
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.00001, `${actual} != ${expected}`);

test('demo is available only on local loopback and the exact UAT frontend', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]', 'alpha-edge-uat-frontend.fly.dev']) assert.equal(portfolioHistoryDemoAllowed(host), true);
    for (const host of ['alpha-edge-frontend.fly.dev', 'alpha-edge-backend.fly.dev', 'example.com', 'alpha-edge-uat-frontend.fly.dev.evil.com', '']) assert.equal(portfolioHistoryDemoAllowed(host), false);
});

test('eight distinct complete approvals span the sample year using the same 18 classes', () => {
    const demo = buildPortfolioHistoryDemo();
    assert.equal(demo.entries.length, 8);
    assert.equal(demo.end - demo.start, 365 * 86400000);
    for (const [index, entry] of demo.entries.entries()) {
        assert.equal(entry.rows.length, 18);
        assert.equal(entry.id, `demo-shape:${index + 1}`);
        assert.equal(entry.source, 'Portfolio history demo');
        assert.ok(Date.parse(entry.occurred_at) >= demo.start && Date.parse(entry.occurred_at) <= demo.end);
        closeTo(entry.rows.reduce((sum, row) => sum + row.weight_pct, 0), 100);
        assert.ok(entry.rows.every(row => row.weight_pct >= 0 && row.weight_pct <= 100));
        if (index) assert.notDeepEqual(entry.rows, demo.entries[index - 1].rows);
    }
});

test('simulated holdings balance both cash and weights at every observation', () => {
    const demo = buildPortfolioHistoryDemo();
    assert.ok(demo.portfolio.length >= 53);
    for (const point of demo.portfolio) {
        const rows = demo.assetClasses.filter(row => row.observed_at === point.observed_at);
        assert.equal(rows.length, 18);
        assert.ok(point.statement_id < 0);
        closeTo(rows.reduce((sum, row) => sum + row.portfolio_weight_pct, 0), 100);
        closeTo(rows.reduce((sum, row) => sum + row.total_value_aud, 0), point.total_value_aud);
        closeTo(point.invested_value_aud + point.statement_cash_aud, point.total_value_aud);
        closeTo(rows.find(row => row.asset_class === 'CASH').total_value_aud, point.statement_cash_aud);
    }
});

test('every demo approval has an observation, and observed holdings do not instantly become the new target', () => {
    const demo = buildPortfolioHistoryDemo();
    for (const entry of demo.entries) assert.ok(demo.portfolio.some(point => point.observed_at === entry.occurred_at));
    const second = demo.entries[1];
    const held = demo.assetClasses.find(row => row.observed_at === second.occurred_at && row.asset_class === 'ENERGY');
    assert.ok(Math.abs(held.portfolio_weight_pct - second.rows[0].weight_pct) > 1);
});

test('demo generation is deterministic and each call owns its own allocations', () => {
    const first = buildPortfolioHistoryDemo();
    const second = buildPortfolioHistoryDemo();
    assert.deepEqual(first, second);
    first.entries[0].rows[0].weight_pct = 99;
    assert.notEqual(second.entries[0].rows[0].weight_pct, 99);
});

test('markers keep demo labels and identities distinct from a genuine approval', () => {
    const demo = buildPortfolioHistoryDemo();
    const real = { ...demo.entries[0], id: 'shape:1', source: 'Portfolio target approval' };
    const markers = buildPortfolioShapeConfirmations([...demo.entries, real], null, demo.end);
    assert.equal(markers.length, 9);
    assert.ok(markers.some(marker => marker.id === 'shape:1' && marker.label === 'APPROVED v1' && !marker.demo));
    const mock = markers.find(marker => marker.id === 'demo-shape:1');
    assert.equal(mock.label, 'Demo 1');
    assert.equal(mock.demo, true);
    assert.equal(mock.shape.complete, true);
});

test('demo adapter stays client-side, does not persist the selection and preserves live date preference', () => {
    const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const source = read('lib/portfolio-history-demo.ts');
    assert.doesNotMatch(source, /fetch\(|api\.|localStorage|sessionStorage/);
    const hook = read('components/stock-table/hooks/use-history-data.ts');
    assert.match(hook, /historyMode === 'performance' && activeTab === 'HISTORY'/);
    assert.match(hook, /localStorage\.setItem\('terminal-history-performance-range', liveHistoryRange\)/);
    assert.doesNotMatch(hook, /(?:localStorage|sessionStorage)\.setItem\([^\n]*[Dd]emo/);
});
