const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareInvestmentBrief, readInvestmentBrief, PORTFOLIO_BRIEF_KEY } = require('/tmp/alpha-edge-brief-tests/portfolio-investment-brief.js');

test('empty brief is genuinely unspecified, not an inferred balanced-fund mandate', () => {
    assert.deepEqual(prepareInvestmentBrief({}), {});
    assert.deepEqual(readInvestmentBrief({ unrelated: 'retained' }), {});
});

test('explicit mandate survives settings roundtrip with zero liquidity allowed', () => {
    const value = { portfolio_scope: 'thematic_sleeve', investment_objective: ' Scarcity opportunities ',
        base_currency: 'aud', horizon_months: 24, liquidity_min_pct: 0,
        tax_cost_policy: 'Consider unrealised gains', currency_hedge_policy: 'Unhedged' };
    const cleaned = prepareInvestmentBrief(value);
    assert.equal(cleaned.portfolio_scope, 'thematic_sleeve');
    assert.equal(cleaned.base_currency, 'AUD');
    assert.equal(cleaned.liquidity_min_pct, 0);
    assert.deepEqual(readInvestmentBrief({ [PORTFOLIO_BRIEF_KEY]: JSON.stringify(cleaned) }), cleaned);
    assert.equal(value.base_currency, 'aud');
});

test('invalid inputs cannot silently replace the saved brief', () => {
    for (const value of [{ horizon_months: 0 }, { max_drawdown_pct: 101 }, { liquidity_min_pct: -1 },
        { horizon_months: NaN }, { base_currency: 'Australian dollar' }, { portfolio_scope: 'guessed' },
        { risk_tolerance: 'aggressive' }, { time_horizon: 'forever' }]) {
        assert.throws(() => prepareInvestmentBrief(value));
    }
    for (const raw of ['null', '[]', '{bad']) assert.throws(() => readInvestmentBrief({ [PORTFOLIO_BRIEF_KEY]: raw }));
});

test('all simple preferences persist without invented numerical risk or horizon', () => {
    for (const risk_tolerance of ['low', 'medium', 'high']) {
        for (const time_horizon of ['1-2 years', '3-5 years', '5+ years']) {
            const brief = { risk_tolerance, time_horizon };
            assert.deepEqual(prepareInvestmentBrief(brief), brief);
            assert.deepEqual(readInvestmentBrief({ [PORTFOLIO_BRIEF_KEY]: JSON.stringify(brief) }), brief);
        }
    }
});

test('selecting a horizon range replaces an old exact horizon but preserves other preferences', () => {
    const legacy = { horizon_months: 18, max_drawdown_pct: 12, base_currency: 'AUD' };
    assert.deepEqual(prepareInvestmentBrief({ ...legacy, risk_tolerance: 'medium' }), { ...legacy, risk_tolerance: 'medium' });
    assert.deepEqual(prepareInvestmentBrief({ ...legacy, time_horizon: '5+ years' }), {
        time_horizon: '5+ years', max_drawdown_pct: 12, base_currency: 'AUD',
    });
    assert.equal(legacy.horizon_months, 18);
    assert.deepEqual(prepareInvestmentBrief({ risk_tolerance: undefined, time_horizon: undefined }), {});
});
