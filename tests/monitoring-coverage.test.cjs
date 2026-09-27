const { test } = require('node:test');
const assert = require('node:assert/strict');
const { monitoringCoverage, outperformBenchmarksFromThemes, connectionTickersMatch } = require('/tmp/alpha-edge-monitoring/lib/monitoring-coverage.js');

const base = {
    ticker: 'ASX:AUC', securityType: 'STOCK', connections: [], connectionsReady: true,
    managementMode: 'etf_tms', managementReady: true, outperformBenchmark: null,
};
const coverage = overrides => monitoringCoverage({ ...base, ...overrides });
const connection = (script, ticker = base.ticker) => ({ ticker, script });

for (let mask = 0; mask < 8; mask++) {
    test(`commodity stock coverage checks all three required connections (${mask.toString(2).padStart(3, '0')})`, () => {
        const required = [connection('cdf'), connection('tms'), connection('cdf', 'ASX:AUC/AMEX:GDX')];
        const result = coverage({ outperformBenchmark: 'AMEX:GDX', connections: required.filter((_, index) => mask & (1 << index)) });
        assert.equal(result.state, mask === 7 ? 'full' : mask === 0 ? 'none' : 'partial');
        if (mask === 3) assert.equal(result.title, 'Partial monitoring - missing Outperform');
        if (mask === 7) assert.equal(result.title, 'Full monitoring (CDF + TMS + Outperform)');
    });
}

test('ordinary stocks use CDF and TMS, never an obsolete ETF connection', () => {
    assert.equal(coverage({ connections: [connection('cdf'), connection('atr_oscillator')] }).state, 'full');
    assert.equal(coverage({ connections: [connection('etf_tms')] }).state, 'none');
    assert.equal(coverage({ connections: [connection('cdf'), connection('etf_tms')] }).title, 'Partial monitoring - missing TMS');
});

test('ETF profiles require the selected scripts independently of Core or class', () => {
    for (const script of ['etf_tms', 'etf_cdf']) {
        assert.equal(coverage({ securityType: 'ETF', connections: [connection(script)], outperformBenchmark: 'AMEX:GDX' }).title, 'Full monitoring (ETF TMS)');
        assert.equal(coverage({ securityType: 'ETF', managementMode: 'tms', connections: [connection(script)] }).state, 'none');
    }
    const tms = [connection('cdf'), connection('tms')];
    assert.equal(coverage({ securityType: 'ETF', connections: tms }).state, 'none');
    assert.equal(coverage({ securityType: 'ETF', managementMode: 'tms', connections: tms, outperformBenchmark: 'AMEX:GDX' }).title, 'Full monitoring (CDF + TMS)');
});

test('coverage is connection evidence, not Buy/Sell, performance or freshness', () => {
    const connections = [connection('cdf'), connection('tms')].map(item => ({ ...item, direction: 'SELL', status: 'BLOCKED', last_seen: '2020-01-01' }));
    assert.equal(coverage({ connections }).state, 'full');
});

test('ratios cannot masquerade as CDF connections for their numerator or denominator', () => {
    for (const ticker of ['ASX:AUC', 'AMEX:GDX']) {
        assert.equal(coverage({ ticker, connections: [connection('cdf', 'ASX:AUC/AMEX:GDX'), connection('tms', ticker)] }).title, 'Partial monitoring - missing CDF');
    }
});

test('matching keeps exchanges distinct and accepts existing feed aliases', () => {
    assert.equal(connectionTickersMatch('NYSE:AUC', 'ASX:AUC'), false);
    assert.equal(connectionTickersMatch(' asx_dly:auc ', 'ASX:AUC'), true);
    assert.equal(connectionTickersMatch('AUC', 'ASX:AUC'), true);
    assert.equal(connectionTickersMatch(' ASX_DLY:AUC / BATS:GDX ', 'ASX:AUC/AMEX:GDX'), true);
    assert.equal(connectionTickersMatch('ASX:AUC/AMEX:GDXJ', 'ASX:AUC/AMEX:GDX'), false);
    assert.equal(coverage({ connections: [connection('cdf', 'NYSE:AUC'), connection('tms', 'NYSE:AUC')] }).state, 'none');
});

test('Outperform follows the configured class benchmark, including custom classes and replacement symbols', () => {
    const themes = [{ tactical: { asset_class_code: ' custom_miners ' }, stages: [{ key: 'EQUITY_RELATIVE', source: { numerator: 'AMEX:NEW' } }] }];
    const benchmark = outperformBenchmarksFromThemes(themes).get('CUSTOM_MINERS');
    assert.equal(benchmark, 'AMEX:NEW');
    assert.equal(coverage({ outperformBenchmark: benchmark, connections: [connection('cdf'), connection('tms'), connection('cdf', 'ASX:AUC/AMEX:OLD')] }).state, 'partial');
    themes[0].stages = [];
    assert.equal(outperformBenchmarksFromThemes(themes).get('CUSTOM_MINERS'), '');
    assert.equal(outperformBenchmarksFromThemes([]).get('GOLD_MINERS'), undefined);
});

test('unavailable configuration, connections or ETF profiles cannot become full monitoring', () => {
    const connections = [connection('cdf'), connection('tms'), connection('etf_tms')];
    for (const overrides of [
        { connectionsReady: false }, { outperformBenchmark: undefined }, { outperformBenchmark: '' },
        { ticker: '' }, { securityType: 'ETF', managementReady: false },
    ]) assert.equal(coverage({ connections, ...overrides }).state, 'unavailable');
    assert.equal(coverage({ connections, managementReady: false }).state, 'full', 'stocks do not depend on ETF profiles');
    assert.equal(coverage({ connections, securityType: 'ETF', outperformBenchmark: undefined }).state, 'full', 'ETF coverage does not depend on commodity configuration');
});
