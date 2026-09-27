const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const buildDir = process.env.ANALYSIS_METRICS_BUILD_DIR;

if (!buildDir) {
    throw new Error('ANALYSIS_METRICS_BUILD_DIR must point to compiled metric helpers.');
}

const {
    calculateAnalysisMomentumModifier,
    hasAnalysisSizingEvidence,
    calculateAnalysisProviderScore,
    calculateAnalysisTargetWeight,
    calculateAverageCompletedModelField,
    calculateCouncilCompositeScore,
    compareAnalysisMetricStocks,
    getAnalysisMetricSortValue,
    getAnalysisModelCompletion,
    calculateAveragePriceTarget,
    getAnalysisPriceTargetSources,
} = require(path.join(buildDir, 'lib/analysis-metrics.js'));
const {
    getAnalysisExchangeCode,
    getAnalysisGroupPerformance,
    matchesAnalysisSearch,
} = require(path.join(buildDir, 'lib/analysis-workbench.js'));

const stock = (overrides = {}) => ({
    price: 10,
    ...overrides,
});

test('target attribution matches the existing average, including supplementary and partial-model targets', () => {
    const security = stock({ geminiPT: 60, gptPT: 80, deerFlowPT: 70,
        perplexityPT: 30, claudePT: 40, councilPT: 75, tipRanksPT: 90, analystPT: 100 });
    assert.deepEqual(getAnalysisPriceTargetSources(security), [
        { label: 'Gemini', value: 60 }, { label: 'GPT', value: 80 },
        { label: 'DeerFlow', value: 70 }, { label: 'Perplexity', value: 30 },
        { label: 'Claude', value: 40 }, { label: 'Council', value: 75 },
        { label: 'TipRanks', value: 90 }, { label: 'TradingView', value: 100 },
    ]);
    assert.equal(calculateAveragePriceTarget(security), 545 / 8);
    assert.equal(getAnalysisModelCompletion(security).completed, 0);
    const invalid = stock({ geminiPT: 0, gptPT: -1, deerFlowPT: Infinity, councilPT: NaN, claudePT: null });
    assert.deepEqual(getAnalysisPriceTargetSources(invalid), []);
    assert.equal(calculateAveragePriceTarget(invalid), 0);
});

test('exchange warnings use the assigned prefix, not a guessed venue from the ticker', () => {
    for (const prefix of [null, undefined, '', ' ', ':', ' : ']) {
        assert.equal(getAnalysisExchangeCode({ prefix, symbol: 'ASX:GOLD' }), '');
    }
    assert.equal(getAnalysisExchangeCode({ prefix: ' ASX: ' }), 'ASX');
    assert.equal(getAnalysisExchangeCode({ prefix: 'NASDAQ' }), 'NASDAQ');
});

test('group performance equally weights available 6M returns, including ETFs and watchlist securities', () => {
    const result = getAnalysisGroupPerformance([
        { performance6MPct: 40, performanceAsOf: '2026-09-10', positionValue: 10000, securityType: 'STOCK' },
        { performance6MPct: -10, performanceAsOf: '2026-09-09', positionValue: 100, securityType: 'ETF', return_80_pct: 80 },
        { performance6MPct: 0, performanceAsOf: '2026-09-10', positionValue: 0, isWatchlist: true },
        { performance6MPct: null, performanceAsOf: '2020-01-01' },
        {},
        { performance6MPct: NaN },
        { performance6MPct: Infinity },
    ]);
    assert.deepEqual(result, {
        averagePct: 10, coveredCount: 3, totalCount: 7,
        oldestAsOf: '2026-09-09', undatedCount: 0,
    });
});

test('group performance distinguishes a genuine zero return from no coverage', () => {
    assert.equal(getAnalysisGroupPerformance([{ performance6MPct: 0 }]).averagePct, 0);
    assert.equal(getAnalysisGroupPerformance([{ performance6MPct: 20 }, { performance6MPct: -20 }]).averagePct, 0);
    assert.equal(getAnalysisGroupPerformance([{ performance6MPct: -30 }, { performance6MPct: -10 }]).averagePct, -20);
    assert.deepEqual(getAnalysisGroupPerformance([]), {
        averagePct: null, coveredCount: 0, totalCount: 0, oldestAsOf: null, undatedCount: 0,
    });
    assert.equal(getAnalysisGroupPerformance([{}, { performance6MPct: null }]).averagePct, null);
});

test('group performance preserves full return magnitude and flags undated data without changing the average', () => {
    const result = getAnalysisGroupPerformance([
        { performance6MPct: 200, performanceAsOf: 'invalid' },
        { performance6MPct: -80 },
        { performance6MPct: 0, performanceAsOf: '2026-09-01' },
    ]);
    assert.equal(result.averagePct, 40, 'raw returns are not capped by the sizing score algorithm');
    assert.equal(result.undatedCount, 2);
    assert.equal(result.oldestAsOf, '2026-09-01');
});

test('uses only completed provider runs for aggregate Quality and Value', () => {
    const security = stock({
        geminiQuality: 90,
        geminiValue: 30,
        geminiPT: 14,
        gptQuality: 40,
        gptValue: 80,
        gptPT: 12,
        perplexityQuality: 100,
        perplexityValue: 100,
        perplexityPT: 0,
    });

    assert.equal(calculateAverageCompletedModelField(security, 'quality'), 65);
    assert.equal(calculateAverageCompletedModelField(security, 'value'), 55);
    assert.deepEqual(getAnalysisModelCompletion(security), {
        completed: 2,
        total: 4,
        ratio: 0.5,
    });
});

test('sorts Quality and Value by their displayed aggregate metrics', () => {
    const highQuality = stock({
        geminiQuality: 92,
        geminiValue: 20,
        geminiPT: 15,
    });
    const highValue = stock({
        geminiQuality: 30,
        geminiValue: 94,
        geminiPT: 15,
    });

    assert.ok(
        compareAnalysisMetricStocks(highQuality, highValue, 'QUALITY', 'desc') < 0,
    );
    assert.ok(
        compareAnalysisMetricStocks(highQuality, highValue, 'VALUE_SCORE', 'desc') > 0,
    );
});

test('sorts provider and Council cells by the number rendered in the table', () => {
    const completeGemini = stock({
        geminiQuality: 80,
        geminiValue: 60,
        geminiPT: 18,
        councilQuality: 70,
        councilValue: 90,
    });
    const partialGemini = stock({
        geminiQuality: 85,
        geminiValue: 0,
        councilQuality: 60,
        councilValue: 60,
    });

    assert.equal(calculateAnalysisProviderScore(completeGemini, 'gemini'), 70);
    assert.equal(calculateAnalysisProviderScore(partialGemini, 'gemini'), 42.5);
    assert.equal(calculateCouncilCompositeScore(completeGemini), 80);
    assert.ok(
        compareAnalysisMetricStocks(completeGemini, partialGemini, 'GEMINI', 'desc') <
            0,
    );
    assert.ok(
        compareAnalysisMetricStocks(completeGemini, partialGemini, 'COUNCIL', 'desc') <
            0,
    );
});

test('keeps missing price targets last when sorting by upside', () => {
    const hasUpside = stock({
        geminiQuality: 70,
        geminiValue: 70,
        geminiPT: 16,
    });
    const noTarget = stock({
        geminiQuality: 90,
        geminiValue: 90,
    });

    assert.ok(
        compareAnalysisMetricStocks(hasUpside, noTarget, 'UPSIDE', 'desc') < 0,
    );
});

test('requires a completed model run before exposing Total or a target weight', () => {
    const performanceOnly = stock({ performance6MPct: 20 });
    const researched = stock({
        geminiQuality: 60,
        geminiValue: 60,
        geminiPT: 14,
        performance6MPct: 20,
    });

    assert.equal(getAnalysisMetricSortValue(performanceOnly, 'TOTAL'), null);
    assert.equal(hasAnalysisSizingEvidence(performanceOnly), false);
    assert.equal(calculateAnalysisTargetWeight(performanceOnly), 0);
    const apiTargetOnly = stock({ analystPT: 15 });
    assert.equal(calculateAnalysisTargetWeight(apiTargetOnly), 0);
    assert.equal(hasAnalysisSizingEvidence(apiTargetOnly), false);
    assert.equal(
        hasAnalysisSizingEvidence(
            stock({ geminiQuality: 60, geminiValue: 60, geminiPT: 0 }),
        ),
        false,
    );
    assert.equal(hasAnalysisSizingEvidence(researched), true);
    assert.equal(getAnalysisMetricSortValue(researched, 'TOTAL'), 60);
    assert.ok(
        compareAnalysisMetricStocks(researched, performanceOnly, 'TOTAL', 'desc') < 0,
    );
    assert.ok(calculateAnalysisTargetWeight(researched) > 0);

    const etf = stock({
        securityType: 'ETF',
        geminiQuality: 90,
        geminiValue: 90,
        geminiPT: 15,
    });
    assert.equal(hasAnalysisSizingEvidence(etf), false);
    assert.equal(calculateAnalysisTargetWeight(etf), 0);
    assert.equal(getAnalysisMetricSortValue(etf, 'TOTAL'), null);
});

test('keeps the momentum modifier separate from Total', () => {
    assert.equal(calculateAnalysisMomentumModifier(20), 3.75);
    assert.equal(calculateAnalysisMomentumModifier(null), null);
});

test('floors downside weight before squaring and preserves the curve above -20%', () => {
    const cases = [
        [1, 0],
        [40, 0],
        [79.99, 0],
        [80, 0],
        [80.01, 0.0016],
        [90, 1600],
        [100, 6400],
        [120, 25600],
        [200, 230400],
    ];
    let previousWeight = 0;
    for (const [priceTarget, expectedWeight] of cases) {
        const weight = calculateAnalysisTargetWeight(stock({
            price: 100,
            geminiQuality: 80,
            geminiValue: 80,
            geminiPT: priceTarget,
        }));
        assert.ok(Number.isFinite(weight));
        assert.ok(Math.abs(weight - expectedWeight) < 1e-8,
            `PT ${priceTarget}: expected ${expectedWeight}, got ${weight}`);
        assert.ok(weight >= previousWeight, 'worsening upside must not increase weight');
        previousWeight = weight;
    }
});

test('finds a security by its readable Analysis identifiers', () => {
    const security = stock({
        name: 'Northstar Lithium',
        symbol: 'NLS',
        prefix: 'ASX:',
        primaryAssetClass: 'Technology',
    });

    assert.equal(matchesAnalysisSearch(security, 'lith'), true);
    assert.equal(matchesAnalysisSearch(security, 'ASX'), true);
    assert.equal(matchesAnalysisSearch(security, 'technology'), true);
    assert.equal(matchesAnalysisSearch(security, 'uranium'), false);
});
