import type {
    Stage1SourceFixture,
    StatementPortfolioFixture,
} from '../fixtures/portfolio-states';

export type PositionReductionDiscrepancy = {
    stockName: string;
    ticker: string;
    assetClass: string;
    expectedReduction: number;
    actualReduction: number;
    variance: number;
};

export type PortfolioReconciliationDiff = {
    expectedCashAud: number;
    actualCashAud: number;
    cashVariance: number;
    discrepancies: PositionReductionDiscrepancy[];
};

const roundMoney = (value: number): number => Math.round(value * 100) / 100;

const findHoldingValue = (
    portfolio: StatementPortfolioFixture,
    stockName: string,
): number => {
    const holding = portfolio.holdings.find(
        (item) => item.details.toLowerCase() === stockName.toLowerCase(),
    );
    return holding?.market_value ?? 0;
};

export const reconcilePortfolioAgainstStage1Sources = ({
    actual,
    baseline,
    expectedCashAud,
    sources,
    tolerance = 1,
}: {
    actual: StatementPortfolioFixture;
    baseline: StatementPortfolioFixture;
    expectedCashAud: number;
    sources: Stage1SourceFixture[];
    tolerance?: number;
}): PortfolioReconciliationDiff => {
    const expectedByStock = new Map<string, Stage1SourceFixture>();

    for (const source of sources) {
        const key = source.stock_name.toLowerCase();
        const existing = expectedByStock.get(key);
        if (existing) {
            existing.amount_sold = roundMoney(
                existing.amount_sold + source.amount_sold,
            );
            continue;
        }
        expectedByStock.set(key, { ...source });
    }

    const discrepancies: PositionReductionDiscrepancy[] = [];
    for (const source of expectedByStock.values()) {
        const baselineValue = findHoldingValue(baseline, source.stock_name);
        const actualValue = findHoldingValue(actual, source.stock_name);
        const actualReduction = roundMoney(
            Math.max(0, baselineValue - actualValue),
        );
        const expectedReduction = roundMoney(source.amount_sold);
        const variance = roundMoney(actualReduction - expectedReduction);

        if (Math.abs(variance) > tolerance) {
            discrepancies.push({
                stockName: source.stock_name,
                ticker: source.ticker,
                assetClass: source.asset_class,
                expectedReduction,
                actualReduction,
                variance,
            });
        }
    }

    return {
        expectedCashAud: roundMoney(expectedCashAud),
        actualCashAud: roundMoney(actual.cashAud),
        cashVariance: roundMoney(actual.cashAud - expectedCashAud),
        discrepancies,
    };
};
