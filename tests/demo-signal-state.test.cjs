const { test } = require('node:test');
const assert = require('node:assert/strict');
const { demoResponse } = require('/tmp/alpha-edge-demo-state/lib/demo-data.js');
const { monitoringCoverage } = require('/tmp/alpha-edge-demo-state/lib/monitoring-coverage.js');
const { createFreshnessResource, dataFreshnessIssues } = require('/tmp/alpha-edge-demo-state/lib/data-freshness.js');
const { calculateAnalysisTargetWeight } = require('/tmp/alpha-edge-demo-state/lib/analysis-metrics.js');

const get = async path => (await demoResponse(path, new Request(`http://localhost${path}`))).json();

test('DCA examples span recent, intermediate and mature contributions', async () => {
    const rows = (await get('/analysis')).filter(row => !row.is_watchlist);
    const ages = rows.map(row => Math.floor((Date.now() - Date.parse(row.last_contributed_at)) / 86400000));
    assert.equal(new Set(ages).size, rows.length);
    assert.ok(Math.min(...ages) < 7);
    assert.ok(ages.some(age => age >= 28 && age <= 49));
    assert.ok(Math.max(...ages) > 70);
    assert.ok(ages.every(age => Number.isFinite(age) && age >= 0));
});

test('Outperform states, connections and market detail use the same held securities', async () => {
    const rows = await get('/analysis');
    const { themes } = await get('/commodity-themes');
    const theme = themes[0];
    assert.deepEqual(await get('/commodity-themes/GOLD'), theme);
    const connections = await get('/alerts/active');
    assert.equal(new Set(connections.map(row => row.id)).size, connections.length);
    const states = theme.eligible_securities.map(row => row.stage_states.SECURITY_OUTPERFORM);
    assert.deepEqual(states.sort(), ['BLOCKED', 'BLOCKED', 'CONFIRMED', 'CONFIRMED']);
    for (const ticker of ['ASX:BHP', 'ASX:NST']) {
        const security = themes.flatMap(row => row.eligible_securities).find(row => row.ticker === ticker);
        assert.equal(security.stage_states.SECURITY_OUTPERFORM, 'BLOCKED');
        assert.equal(security.latest_events.SECURITY_OUTPERFORM.signal, 'SELL');
        assert.equal(security.stage_states.SECURITY_TREND, 'CONFIRMED');
    }
    for (const security of theme.eligible_securities) {
        assert.equal(rows.find(row => row.ticker === security.ticker).id, security.security_id);
        assert.equal(monitoringCoverage({ ticker: security.ticker, securityType: 'STOCK', connections,
            connectionsReady: true, managementMode: 'tms', managementReady: true, outperformBenchmark: 'AMEX:GDX' }).state, 'full');
        assert.equal(security.latest_events.SECURITY_OUTPERFORM.signal,
            security.stage_states.SECURITY_OUTPERFORM === 'CONFIRMED' ? 'BUY' : 'SELL');
    }
    const stage = theme.stages.find(row => row.key === 'SECURITY_OUTPERFORM');
    assert.equal(stage.eligible_security_total, states.length);
    assert.equal(stage.eligible_security_count, states.filter(state => state === 'CONFIRMED').length);
    assert.equal(theme.tactical.actual_value, 34000);
    assert.equal(theme.tactical.maximum_value, 34002);
});

test('demo totals and cost bases reconcile to the requested account metrics', async () => {
    const portfolio = await get('/portfolio');
    const { statement, holdings } = await get('/statements/latest');
    const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
    assert.equal(portfolio.total_value, 283350);
    assert.equal(portfolio.cash_on_hand, 14648);
    near(portfolio.profit_loss_percent, 31.7);
    near(holdings.reduce((sum, row) => sum + row.value_aud, statement.cash_aud), 283350);
    near(holdings.reduce((sum, row) => sum + row.gain_loss_aud, 0), portfolio.profit_loss);
    near(portfolio.profit_loss / statement.total_value_aud * 100, 31.7);
    for (const row of holdings) {
        assert.ok(Number.isInteger(row.quantity) && row.quantity > 0);
        near(row.quantity * row.current_price, row.value_aud);
        near(row.value_aud - row.cost_aud, row.gain_loss_aud);
        near(row.gain_loss_aud / row.cost_aud * 100, row.gain_loss_pct);
    }
});

test('four core funds share consistent targets, holdings, sizing and momentum', async () => {
    const ledger = await get('/etf/allocation-ledger');
    const momentum = await get('/etf/momentum');
    const { holdings } = await get('/statements/latest');
    const { targets } = await get('/weight-policy');
    assert.deepEqual(ledger.rows.map(row => row.ticker), ['ASX:MVB', 'ASX:GDX', 'ASX:FUEL', 'ASX:VAP']);
    for (const fund of ledger.rows) {
        assert.equal(fund.actual_value, holdings.find(row => `ASX:${row.ticker}` === fund.ticker).value_aud);
        assert.equal(fund.effective_target_value, targets.find(row => row.ticker === fund.ticker).ideal);
        assert.ok(momentum.latest_run.rows.some(row => row.ticker === fund.ticker));
    }
    assert.equal(ledger.rows.reduce((sum, row) => sum + row.actual_value, 0), ledger.summary.actual_etf_value);
    assert.equal(ledger.rows.reduce((sum, row) => sum + row.effective_target_value, 0), ledger.summary.effective_target_value);
    assert.ok(ledger.rows.some(row => row.target_delta_value < 0));
    assert.ok(ledger.rows.some(row => row.target_delta_value > 0));
});

test('alert examples span signals and classes without unknown identities', async () => {
    const alerts = await get('/alerts');
    const research = await get('/analysis');
    assert.equal(alerts.length, 10);
    assert.equal(new Set(alerts.map(row => row.id)).size, alerts.length);
    assert.ok(new Set(alerts.map(row => row.asset_class)).size >= 7);
    assert.ok(alerts.every(row => !['SELL_DOWN', 'SELL_50'].includes(row.alert_type)));
    assert.deepEqual(alerts.map(row => row.id), [1, 3, 4, 5, 7, 8, 9, 10, 11, 12]);
    for (const type of ['SELL', 'BREAKOUT', 'ADD', 'TRIM', 'BUY', 'OUTPERFORM_CONFIRMED'])
        assert.ok(alerts.some(row => row.alert_type === type));
    for (const alert of alerts) {
        const stock = research.find(row => row.ticker === alert.ticker);
        assert.equal(alert.name, stock.name);
        assert.equal(alert.asset_class, stock.primary_asset_class);
        assert.ok(Date.parse(alert.created_at) <= Date.now());
    }
});

test('all market paths contain source identities, varied stages and reconciled class exposure', async () => {
    const { themes } = await get('/commodity-themes');
    const current = await get('/portfolio-mix/current');
    assert.equal(themes.length, 7);
    for (const code of ['SILVER', 'COPPER', 'URANIUM']) assert.ok(themes.some(theme => theme.code === code));
    assert.ok(new Set(themes.map(row => row.status)).size >= 3);
    for (const theme of themes) {
        assert.deepEqual(await get(`/commodity-themes/${theme.code}`), theme);
        assert.equal(theme.stages.length, 4);
        assert.ok(theme.eligible_securities.length > 0);
        const holding = current.rows.find(row => row.asset_class === theme.equity_sleeve.asset_class_code);
        assert.equal(theme.tactical.actual_value, holding?.value ?? 0);
        if (!holding) {
            assert.equal(theme.tactical.budget_approved, false);
            assert.equal(theme.tactical.available_value, 0);
        }
        for (const stage of theme.stages) {
            assert.ok(stage.source.symbol || stage.source.numerator);
            assert.ok(stage.last_event_at);
            if (stage.scope === 'SECURITY') {
                assert.equal(stage.eligible_security_total, theme.eligible_securities.length);
                assert.equal(stage.eligible_security_count + stage.blocked_security_count, stage.eligible_security_total);
            }
        }
    }
});

test('saved Council examples have useful, explicitly synthetic evidence without fake job links', async () => {
    const stocks = (await get('/analysis')).filter(row => row.security_type === 'STOCK' && row.ticker !== 'ASX:LYC');
    assert.equal(stocks.length, 26);
    assert.equal(new Set(stocks.map(row => row.thesis)).size, stocks.length);
    for (const row of stocks) {
        assert.ok(row.council_quality > 0 && row.council_quality <= 100);
        assert.ok(row.council_value > 0 && row.council_pt > 0);
        assert.match(row.council_source_output, /Synthetic demo research/);
        assert.ok(row.council_source_output.includes(row.thesis));
        assert.ok(row.council_source_output.includes(row.catalysts));
        assert.ok(Date.parse(row.council_source_input_at));
        assert.ok(!row.council_run_id, 'never link invented output to a real provider job');
    }
});

test('thesis deltas use the real weight modifier and include requested watchlist research', async () => {
    const research = await get('/analysis');
    const scores = await get('/council/announcement-router/signals');
    const { results } = await get('/sizing/allocations');
    assert.ok(Object.values(scores).some(score => score > 0));
    assert.ok(Object.values(scores).some(score => score < 0));
    assert.ok(Object.values(scores).some(score => score === 0));
    for (const result of results) {
        const row = research.find(row => row.id === result.id);
        const raw = calculateAnalysisTargetWeight({ price: row.current_price, performance6MPct: row.performance_6m_pct,
            geminiQuality: row.gemini_quality, geminiValue: row.gemini_value, geminiPT: row.gemini_pt,
            gptQuality: row.gpt_quality, gptValue: row.gpt_value, gptPT: row.gpt_pt, councilPT: row.council_pt });
        assert.equal(result.raw_weight, raw);
        assert.equal(result.router_score, scores[row.ticker]);
        assert.equal(result.router_multiplier, 1 + Math.max(-5, Math.min(5, scores[row.ticker])) * 0.03);
        assert.equal(result.effective_weight, raw * result.router_multiplier);
    }
    const body = { stocks: research.filter(row => row.primary_asset_class === 'DIVERSIFIED_MINERS').map(row => ({ id: row.is_watchlist ? -row.id : row.id })) };
    const response = await demoResponse('/sizing/allocations', new Request('http://localhost/sizing/allocations', {
        method: 'POST', body: JSON.stringify(body),
    }));
    const sized = (await response.json()).results;
    assert.ok(sized.some(row => row.id === -101 && row.ticker === 'ASX:S32' && row.router_score === 1.7));
    assert.ok(Math.abs(sized.reduce((sum, row) => sum + row.allocation_pct, 0) - 100) < 1e-8);
});

test('demo freshness satisfies the real client contract without bypassing error handling', async () => {
    const resource = createFreshnessResource(() => get('/data-freshness'));
    await resource.refresh();
    const snapshot = resource.getSnapshot();
    assert.equal(snapshot.error, null);
    assert.equal(snapshot.data.datasets.length, 8);
    assert.equal(snapshot.data.scheduler.enabled, false);
    assert.deepEqual(dataFreshnessIssues(snapshot.data), []);
    assert.ok(snapshot.data.datasets.every(row => row.source === 'SYNTHETIC_DEMO'));
});

test('richer demo state still cannot record trades or contributions', async () => {
    for (const path of ['/analysis/1/contribute', '/positions', '/council/jobs', '/decisions', '/security-actions/1/ignore']) {
        const response = await demoResponse(path, new Request(`http://localhost${path}`, { method: 'POST', body: '{}' }));
        assert.equal(response.status, 403);
    }
});
