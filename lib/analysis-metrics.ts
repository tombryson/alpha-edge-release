export type AnalysisMetricSecurity = {
    securityType?: string | null;
    price?: number | null;
    performance6MPct?: number | null;
    geminiQuality?: number | null;
    geminiValue?: number | null;
    geminiPT?: number | null;
    perplexityQuality?: number | null;
    perplexityValue?: number | null;
    perplexityPT?: number | null;
    gptQuality?: number | null;
    gptValue?: number | null;
    gptPT?: number | null;
    claudeQuality?: number | null;
    claudeValue?: number | null;
    claudePT?: number | null;
    deerFlowPT?: number | null;
    councilQuality?: number | null;
    councilValue?: number | null;
    councilPT?: number | null;
    tipRanksPT?: number | null;
    analystPT?: number | null;
};

export type AnalysisModelKey = 'gemini' | 'perplexity' | 'gpt' | 'claude';
export type AnalysisScoreField = 'quality' | 'value';
export type AnalysisMetricSortKey =
    | 'QUALITY'
    | 'VALUE_SCORE'
    | 'GEMINI'
    | 'PERPLEXITY'
    | 'GPT'
    | 'CLAUDE'
    | 'COUNCIL'
    | 'TOTAL'
    | 'PRICE'
    | 'UPSIDE';

type AnalysisModelFields = {
    quality: keyof AnalysisMetricSecurity;
    value: keyof AnalysisMetricSecurity;
    priceTarget: keyof AnalysisMetricSecurity;
};

const analysisModelFields: Record<AnalysisModelKey, AnalysisModelFields> = {
    gemini: {
        quality: 'geminiQuality',
        value: 'geminiValue',
        priceTarget: 'geminiPT',
    },
    perplexity: {
        quality: 'perplexityQuality',
        value: 'perplexityValue',
        priceTarget: 'perplexityPT',
    },
    gpt: {
        quality: 'gptQuality',
        value: 'gptValue',
        priceTarget: 'gptPT',
    },
    claude: {
        quality: 'claudeQuality',
        value: 'claudeValue',
        priceTarget: 'claudePT',
    },
};

const clampNumber = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

const positiveNumber = (value?: number | null) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : null;

const isEtfSecurity = (stock: AnalysisMetricSecurity) =>
    String(stock.securityType || '').trim().toUpperCase() === 'ETF';

const providerScore = (quality?: number | null, value?: number | null) =>
    ((quality || 0) + (value || 0)) / 2;

const numberFromSecurity = (
    stock: AnalysisMetricSecurity,
    field: keyof AnalysisMetricSecurity,
) => {
    const value = stock[field];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

export const isAnalysisModelRunComplete = (
    quality?: number | null,
    value?: number | null,
    priceTarget?: number | null,
) =>
    positiveNumber(quality) != null &&
    positiveNumber(value) != null &&
    positiveNumber(priceTarget) != null;

export const getAnalysisPriceTargetSources = (stock: AnalysisMetricSecurity) => {
    const sources: Array<[string, number | null | undefined]> = [
        ['Gemini', stock.geminiPT],
        ['GPT', stock.gptPT],
        ['DeerFlow', stock.deerFlowPT],
        ['Perplexity', stock.perplexityPT],
        ['Claude', stock.claudePT],
        ['Council', stock.councilPT],
        ['TipRanks', stock.tipRanksPT],
        ['TradingView', stock.analystPT],
    ];
    return sources.flatMap(([label, priceTarget]) => {
        const value = positiveNumber(priceTarget);
        return value == null ? [] : [{ label, value }];
    });
};

export const calculateAveragePriceTarget = (stock: AnalysisMetricSecurity) => {
    const priceTargets = getAnalysisPriceTargetSources(stock);
    return priceTargets.length > 0
        ? priceTargets.reduce((sum, priceTarget) => sum + priceTarget.value, 0) /
              priceTargets.length
        : 0;
};

export const calculateRuntimeUpsidePct = (stock: AnalysisMetricSecurity) => {
    const averagePriceTarget = calculateAveragePriceTarget(stock);
    const price = numberFromSecurity(stock, 'price');
    return averagePriceTarget > 0 && price > 0
        ? ((averagePriceTarget - price) / price) * 100
        : 0;
};

export const calculateDisplayableUpsidePct = (stock: AnalysisMetricSecurity) => {
    const averagePriceTarget = calculateAveragePriceTarget(stock);
    const price = numberFromSecurity(stock, 'price');
    if (averagePriceTarget <= 0 || price <= 0) return null;
    return ((averagePriceTarget - price) / price) * 100;
};

export const calculateAnalysisProviderScore = (
    stock: AnalysisMetricSecurity,
    provider: AnalysisModelKey,
) => {
    const fields = analysisModelFields[provider];
    const quality = numberFromSecurity(stock, fields.quality);
    const value = numberFromSecurity(stock, fields.value);
    if (quality === 0 && value === 0) return null;
    return providerScore(quality, value);
};

export const calculateAverageCompletedModelField = (
    stock: AnalysisMetricSecurity,
    field: AnalysisScoreField,
) => {
    const values = (Object.keys(analysisModelFields) as AnalysisModelKey[]).flatMap(
        (provider) => {
            const fields = analysisModelFields[provider];
            const quality = numberFromSecurity(stock, fields.quality);
            const value = numberFromSecurity(stock, fields.value);
            const priceTarget = numberFromSecurity(stock, fields.priceTarget);
            if (!isAnalysisModelRunComplete(quality, value, priceTarget)) return [];
            return [field === 'quality' ? quality : value];
        },
    );
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
};

export const getAnalysisModelCompletion = (stock: AnalysisMetricSecurity) => {
    const completed = (Object.keys(analysisModelFields) as AnalysisModelKey[]).filter(
        (provider) => {
            const fields = analysisModelFields[provider];
            return isAnalysisModelRunComplete(
                numberFromSecurity(stock, fields.quality),
                numberFromSecurity(stock, fields.value),
                numberFromSecurity(stock, fields.priceTarget),
            );
        },
    ).length;
    const total = Object.keys(analysisModelFields).length;
    return { completed, total, ratio: completed / total };
};

export const calculateAverageCompletedModelScore = (
    stock: AnalysisMetricSecurity,
) => {
    const quality = calculateAverageCompletedModelField(stock, 'quality');
    const value = calculateAverageCompletedModelField(stock, 'value');
    if (quality == null || value == null) return null;
    return providerScore(quality, value);
};

export const calculateCouncilCompositeScore = (stock: AnalysisMetricSecurity) => {
    if (
        positiveNumber(stock.councilQuality) == null ||
        positiveNumber(stock.councilValue) == null
    ) {
        return null;
    }
    return providerScore(stock.councilQuality, stock.councilValue);
};

export const calculateBaseRatingTotal = (stock: AnalysisMetricSecurity) => {
    const scores = (Object.keys(analysisModelFields) as AnalysisModelKey[]).flatMap(
        (provider) => {
            const fields = analysisModelFields[provider];
            const quality = numberFromSecurity(stock, fields.quality);
            const value = numberFromSecurity(stock, fields.value);
            const priceTarget = numberFromSecurity(stock, fields.priceTarget);
            return isAnalysisModelRunComplete(quality, value, priceTarget)
                ? [providerScore(quality, value)]
                : [];
        },
    );
    return scores.length > 0
        ? scores.reduce((sum, score) => sum + score, 0) / scores.length
        : 0;
};

/**
 * An advisory weight needs more than a market target or a derived signal.
 * One primary model must have supplied Quality,
 * Value, and its own price target before the stock may enter sizing.
 */
export const hasAnalysisSizingEvidence = (stock: AnalysisMetricSecurity) =>
    !isEtfSecurity(stock) && getAnalysisModelCompletion(stock).completed > 0;

export const calculateAnalysisMomentumModifier = (
    performance6MPct?: number | null,
) => {
    if (
        performance6MPct === null ||
        performance6MPct === undefined ||
        !Number.isFinite(performance6MPct)
    ) {
        return null;
    }
    const cappedPerformance = clampNumber(performance6MPct, -40, 40);
    return 2.5 + (cappedPerformance / 40) * 2.5;
};

export const calculatePerformanceAdjustedRatingTotal = (
    stock: AnalysisMetricSecurity,
) => {
    const baseRating = calculateBaseRatingTotal(stock);
    // Momentum is a sizing modifier, not a standalone research score.
    if (baseRating <= 0) return 0;
    const performanceScore = calculateAnalysisMomentumModifier(
        stock.performance6MPct,
    );
    if (performanceScore === null) return baseRating;
    return baseRating + performanceScore;
};

export const calculateAnalysisTargetWeight = (
    stock: AnalysisMetricSecurity,
) => {
    if (!hasAnalysisSizingEvidence(stock)) return 0;
    const totalScore = calculatePerformanceAdjustedRatingTotal(stock);
    const upsidePercent = calculateRuntimeUpsidePct(stock);
    // Floor before squaring so worsening downside cannot regain weight.
    const upsideMultiplier = Math.max(0, 1 + upsidePercent / 20);
    return Math.pow(totalScore * upsideMultiplier, 2);
};

export const getAnalysisMetricSortValue = (
    stock: AnalysisMetricSecurity,
    key: AnalysisMetricSortKey,
): number | null => {
    // ETFs belong to a separate allocation system; they are never ranked by
    // the stock-analysis metrics in this table.
    if (isEtfSecurity(stock)) return null;
    if (key === 'QUALITY')
        return calculateAverageCompletedModelField(stock, 'quality');
    if (key === 'VALUE_SCORE')
        return calculateAverageCompletedModelField(stock, 'value');
    if (key === 'GEMINI') return calculateAnalysisProviderScore(stock, 'gemini');
    if (key === 'PERPLEXITY')
        return calculateAnalysisProviderScore(stock, 'perplexity');
    if (key === 'GPT') return calculateAnalysisProviderScore(stock, 'gpt');
    if (key === 'CLAUDE') return calculateAnalysisProviderScore(stock, 'claude');
    if (key === 'COUNCIL') return calculateCouncilCompositeScore(stock);
    if (key === 'PRICE') {
        const price = stock.price;
        return typeof price === 'number' && Number.isFinite(price) ? price : null;
    }
    if (key === 'UPSIDE') return calculateDisplayableUpsidePct(stock);
    const totalScore = calculateBaseRatingTotal(stock);
    return totalScore > 0 ? totalScore : null;
};

export const compareAnalysisMetricStocks = (
    a: AnalysisMetricSecurity,
    b: AnalysisMetricSecurity,
    key: AnalysisMetricSortKey,
    direction: 'asc' | 'desc',
) => {
    const aValue = getAnalysisMetricSortValue(a, key);
    const bValue = getAnalysisMetricSortValue(b, key);
    if (aValue == null && bValue == null) return 0;
    if (aValue == null) return 1;
    if (bValue == null) return -1;
    return (bValue - aValue) * (direction === 'desc' ? 1 : -1);
};
