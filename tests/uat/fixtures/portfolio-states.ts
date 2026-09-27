export type StatementHoldingFixture = {
    details: string;
    isin: string;
    quantity: number;
    cost_aud: number;
    current_price: number;
    value_aud: number;
    gain_loss_aud: number;
    gain_loss_pct: number;
    currency: string;
    market_value: number;
    cash_reserve: number;
};

export type StatementPortfolioFixture = {
    accountName: string;
    cashAud: number;
    holdings: StatementHoldingFixture[];
};

export type SyntheticHoldingTemplate = {
    details: string;
    isin: string;
    assetClass: string;
    current_price: number;
    currency?: string;
};

export type Stage1SourceFixture = {
    ticker: string;
    stock_name: string;
    asset_class: string;
    amount_sold: number;
};

export const baselinePortfolio: StatementPortfolioFixture = {
    accountName: 'UAT Portfolio',
    cashAud: 3000,
    holdings: [
        {
            details: 'UAT Gold Producer',
            isin: 'UAT0001',
            quantity: 1000,
            cost_aud: 15000,
            current_price: 18,
            value_aud: 18000,
            gain_loss_aud: 3000,
            gain_loss_pct: 20,
            currency: 'AUD',
            market_value: 18000,
            cash_reserve: 2500,
        },
        {
            details: 'UAT Silver Producer',
            isin: 'UAT0002',
            quantity: 1000,
            cost_aud: 7000,
            current_price: 8,
            value_aud: 8000,
            gain_loss_aud: 1000,
            gain_loss_pct: 14.3,
            currency: 'AUD',
            market_value: 8000,
            cash_reserve: 500,
        },
        {
            details: 'UAT Copper Producer',
            isin: 'UAT0003',
            quantity: 1000,
            cost_aud: 5000,
            current_price: 6,
            value_aud: 6000,
            gain_loss_aud: 1000,
            gain_loss_pct: 20,
            currency: 'AUD',
            market_value: 6000,
            cash_reserve: 0,
        },
        {
            details: 'UAT Base Metals Producer',
            isin: 'UAT0004',
            quantity: 1000,
            cost_aud: 3500,
            current_price: 4,
            value_aud: 4000,
            gain_loss_aud: 500,
            gain_loss_pct: 14.3,
            currency: 'AUD',
            market_value: 4000,
            cash_reserve: 800,
        },
        {
            details: 'UAT Lithium Producer',
            isin: 'UAT0005',
            quantity: 1000,
            cost_aud: 1500,
            current_price: 2,
            value_aud: 2000,
            gain_loss_aud: 500,
            gain_loss_pct: 33.3,
            currency: 'AUD',
            market_value: 2000,
            cash_reserve: 0,
        },
        {
            details: 'UAT Uranium Producer',
            isin: 'UAT0006',
            quantity: 1000,
            cost_aud: 4500,
            current_price: 5,
            value_aud: 5000,
            gain_loss_aud: 500,
            gain_loss_pct: 11.1,
            currency: 'AUD',
            market_value: 5000,
            cash_reserve: 300,
        },
        {
            details: 'UAT Rare Earths Producer',
            isin: 'UAT0007',
            quantity: 1000,
            cost_aud: 2800,
            current_price: 4,
            value_aud: 4000,
            gain_loss_aud: 1200,
            gain_loss_pct: 42.9,
            currency: 'AUD',
            market_value: 4000,
            cash_reserve: 600,
        },
        {
            details: 'UAT Insurance Group',
            isin: 'UAT0008',
            quantity: 1000,
            cost_aud: 6500,
            current_price: 7,
            value_aud: 7000,
            gain_loss_aud: 500,
            gain_loss_pct: 7.7,
            currency: 'AUD',
            market_value: 7000,
            cash_reserve: 0,
        },
        {
            details: 'UAT Staples Group',
            isin: 'UAT0009',
            quantity: 1000,
            cost_aud: 4500,
            current_price: 5,
            value_aud: 5000,
            gain_loss_aud: 500,
            gain_loss_pct: 11.1,
            currency: 'AUD',
            market_value: 5000,
            cash_reserve: 0,
        },
        {
            details: 'UAT Gambling Group',
            isin: 'UAT0010',
            quantity: 1000,
            cost_aud: 3500,
            current_price: 4,
            value_aud: 4000,
            gain_loss_aud: 500,
            gain_loss_pct: 14.3,
            currency: 'AUD',
            market_value: 4000,
            cash_reserve: 0,
        },
        {
            details: 'UAT Data Centre Operator',
            isin: 'UAT0011',
            quantity: 1000,
            cost_aud: 11000,
            current_price: 12,
            value_aud: 12000,
            gain_loss_aud: 1000,
            gain_loss_pct: 9.1,
            currency: 'AUD',
            market_value: 12000,
            cash_reserve: 0,
        },
        {
            details: 'UAT Energy Producer',
            isin: 'UAT0012',
            quantity: 1000,
            cost_aud: 17000,
            current_price: 18,
            value_aud: 18000,
            gain_loss_aud: 1000,
            gain_loss_pct: 5.9,
            currency: 'AUD',
            market_value: 18000,
            cash_reserve: 0,
        },
        {
            details: 'UAT Commercial Pharma',
            isin: 'UAT0013',
            quantity: 1000,
            cost_aud: 9000,
            current_price: 10,
            value_aud: 10000,
            gain_loss_aud: 1000,
            gain_loss_pct: 11.1,
            currency: 'AUD',
            market_value: 10000,
            cash_reserve: 0,
        },
        {
            details: 'UAT Healthcare Devices',
            isin: 'UAT0014',
            quantity: 1000,
            cost_aud: 4500,
            current_price: 5,
            value_aud: 5000,
            gain_loss_aud: 500,
            gain_loss_pct: 11.1,
            currency: 'AUD',
            market_value: 5000,
            cash_reserve: 500,
        },
    ],
};

export const baselineAssetClassByHolding: Record<string, string> = {
    'UAT Gold Producer': 'GOLD',
    'UAT Silver Producer': 'SILVER',
    'UAT Copper Producer': 'COPPER',
    'UAT Base Metals Producer': 'BASEMETALS',
    'UAT Lithium Producer': 'LITHIUM',
    'UAT Uranium Producer': 'URANIUM',
    'UAT Rare Earths Producer': 'REE',
    'UAT Insurance Group': 'INSURANCE',
    'UAT Staples Group': 'STAPLES',
    'UAT Gambling Group': 'GAMBLING',
    'UAT Data Centre Operator': 'TECHNOLOGY',
    'UAT Energy Producer': 'ENERGY',
    'UAT Commercial Pharma': 'PHARMA',
    'UAT Healthcare Devices': 'HEALTHCARE',
};

const roundMoney = (value: number): number => Math.round(value * 100) / 100;

export const clonePortfolio = (
    portfolio: StatementPortfolioFixture,
): StatementPortfolioFixture => ({
    accountName: portfolio.accountName,
    cashAud: portfolio.cashAud,
    holdings: portfolio.holdings.map((holding) => ({ ...holding })),
});

export const portfolioInvestedValue = (
    portfolio: StatementPortfolioFixture,
): number =>
    roundMoney(
        portfolio.holdings.reduce(
            (sum, holding) => sum + holding.market_value,
            0,
        ),
    );

export const portfolioTotalValue = (
    portfolio: StatementPortfolioFixture,
): number => roundMoney(portfolio.cashAud + portfolioInvestedValue(portfolio));

export const buildStatementImportPayload = (
    portfolio: StatementPortfolioFixture,
    statementDate: Date,
) => ({
    account: {
        account_name: portfolio.accountName,
        statement_date: statementDate.toISOString(),
        total_value_aud: portfolioTotalValue(portfolio),
        cash_aud: roundMoney(portfolio.cashAud),
        usd_value: 0,
        usd_aud: 0,
        gbp_value: 0,
        gbp_aud: 0,
        aud_value: portfolioTotalValue(portfolio),
    },
    holdings: portfolio.holdings,
});

const applyReductionToHolding = (
    holding: StatementHoldingFixture,
    amount: number,
): number => {
    const applied = Math.min(amount, holding.market_value);
    if (applied <= 0) return 0;

    const originalMarketValue = holding.market_value;
    const remainingValue = roundMoney(originalMarketValue - applied);
    const remainingRatio =
        originalMarketValue > 0 ? remainingValue / originalMarketValue : 0;

    holding.market_value = remainingValue;
    holding.value_aud = remainingValue;
    holding.quantity = roundMoney(
        holding.current_price > 0
            ? remainingValue / holding.current_price
            : holding.quantity * remainingRatio,
    );
    holding.cost_aud = roundMoney(holding.cost_aud * remainingRatio);
    holding.gain_loss_aud = roundMoney(holding.value_aud - holding.cost_aud);
    holding.gain_loss_pct =
        holding.cost_aud > 0
            ? roundMoney((holding.gain_loss_aud / holding.cost_aud) * 100)
            : 0;

    return applied;
};

const setHoldingMarketValue = (
    holding: StatementHoldingFixture,
    targetValue: number,
): void => {
    const nextValue = roundMoney(Math.max(0, targetValue));
    const originalMarketValue = holding.market_value;
    const scale =
        originalMarketValue > 0 ? nextValue / originalMarketValue : 0;

    holding.market_value = nextValue;
    holding.value_aud = nextValue;
    holding.quantity = roundMoney(
        holding.current_price > 0
            ? nextValue / holding.current_price
            : holding.quantity * scale,
    );
    holding.cost_aud = roundMoney(holding.cost_aud * scale);
    holding.gain_loss_aud = roundMoney(holding.value_aud - holding.cost_aud);
    holding.gain_loss_pct =
        holding.cost_aud > 0
            ? roundMoney((holding.gain_loss_aud / holding.cost_aud) * 100)
            : 0;
};

const applyReductionAcrossHoldings = (
    holdings: StatementHoldingFixture[],
    amount: number,
    preferredStartIndex = 0,
): void => {
    let remaining = amount;
    for (let offset = 0; offset < holdings.length && remaining > 0.01; offset += 1) {
        const index = (preferredStartIndex + offset) % holdings.length;
        remaining = roundMoney(
            remaining - applyReductionToHolding(holdings[index], remaining),
        );
    }
};

export const buildDayAfterPortfolio = ({
    base = baselinePortfolio,
    cashAud,
    mode,
    sources,
}: {
    base?: StatementPortfolioFixture;
    cashAud: number;
    mode: 'success' | 'no-reduction' | 'wrong-holdings';
    sources: Stage1SourceFixture[];
}): StatementPortfolioFixture => {
    const holdings = base.holdings.map((holding) => ({ ...holding }));

    if (mode === 'success') {
        for (const source of sources) {
            const holding = holdings.find(
                (item) =>
                    item.details === source.stock_name ||
                    item.isin === source.ticker ||
                    item.details.toLowerCase() === source.stock_name.toLowerCase(),
            );
            if (holding) {
                applyReductionToHolding(holding, source.amount_sold);
            }
        }
    }

    if (mode === 'wrong-holdings') {
        for (const source of sources) {
            const sourceIndex = holdings.findIndex(
                (item) =>
                    item.details === source.stock_name ||
                    item.details.toLowerCase() === source.stock_name.toLowerCase(),
            );
            applyReductionAcrossHoldings(
                holdings,
                source.amount_sold,
                sourceIndex >= 0 ? sourceIndex + 1 : 0,
            );
        }
    }

    return {
        accountName: base.accountName,
        cashAud,
        holdings: holdings.filter((holding) => holding.market_value > 0.005),
    };
};

export const buildPortfolioWithValueAdjustments = ({
    base,
    cashAud = base.cashAud,
    adjustments,
}: {
    base: StatementPortfolioFixture;
    cashAud?: number;
    adjustments: Array<{
        details: string;
        deltaValue?: number;
        targetValue?: number;
    }>;
}): StatementPortfolioFixture => {
    const portfolio = clonePortfolio(base);

    for (const adjustment of adjustments) {
        const holding = portfolio.holdings.find(
            (item) => item.details === adjustment.details,
        );
        if (!holding) continue;

        const targetValue =
            adjustment.targetValue != null
                ? adjustment.targetValue
                : holding.market_value + Number(adjustment.deltaValue || 0);
        setHoldingMarketValue(holding, targetValue);
    }

    return {
        ...portfolio,
        cashAud: roundMoney(cashAud),
        holdings: portfolio.holdings.filter((holding) => holding.market_value > 0.005),
    };
};

export const buildPortfolioWithMarketMoves = ({
    base,
    cashAud = base.cashAud,
    moves,
}: {
    base: StatementPortfolioFixture;
    cashAud?: number;
    moves: Array<{
        details: string;
        movePct: number;
    }>;
}): StatementPortfolioFixture =>
    buildPortfolioWithValueAdjustments({
        base,
        cashAud,
        adjustments: moves.map((move) => {
            const holding = base.holdings.find((item) => item.details === move.details);
            return {
                details: move.details,
                targetValue: holding
                    ? roundMoney(holding.market_value * (1 + move.movePct / 100))
                    : 0,
            };
        }),
    });

const buildSyntheticHolding = (
    template: SyntheticHoldingTemplate,
    targetValue: number,
): StatementHoldingFixture => {
    const value = roundMoney(targetValue);
    const price = template.current_price > 0 ? template.current_price : 1;

    return {
        details: template.details,
        isin: template.isin,
        quantity: roundMoney(value / price),
        cost_aud: value,
        current_price: price,
        value_aud: value,
        gain_loss_aud: 0,
        gain_loss_pct: 0,
        currency: template.currency || 'AUD',
        market_value: value,
        cash_reserve: 0,
    };
};

export const buildPortfolioFromTargetWeights = ({
    base = baselinePortfolio,
    targetWeights,
}: {
    base?: StatementPortfolioFixture;
    targetWeights: Record<string, number>;
}): StatementPortfolioFixture => {
    const totalValue = portfolioTotalValue(base);
    const holdings = base.holdings.map((holding) => ({ ...holding }));
    const holdingsByAssetClass = new Map<string, StatementHoldingFixture[]>();

    holdings.forEach((holding) => {
        const assetClass = baselineAssetClassByHolding[holding.details];
        if (!assetClass) return;
        const rows = holdingsByAssetClass.get(assetClass) || [];
        rows.push(holding);
        holdingsByAssetClass.set(assetClass, rows);
    });

    holdingsByAssetClass.forEach((assetHoldings, assetClass) => {
        const targetWeight = targetWeights[assetClass];
        if (targetWeight == null) return;
        const targetValue = roundMoney((targetWeight / 100) * totalValue);
        const currentValue = assetHoldings.reduce(
            (sum, holding) => sum + holding.market_value,
            0,
        );
        let assignedValue = 0;

        assetHoldings.forEach((holding, index) => {
            const value =
                index === assetHoldings.length - 1
                    ? roundMoney(targetValue - assignedValue)
                    : currentValue > 0
                      ? roundMoney(
                            targetValue * (holding.market_value / currentValue),
                        )
                      : 0;
            setHoldingMarketValue(holding, value);
            assignedValue = roundMoney(assignedValue + value);
        });
    });

    const cashWeight = targetWeights.CASH;

    return {
        accountName: base.accountName,
        cashAud:
            cashWeight == null
                ? base.cashAud
                : roundMoney((cashWeight / 100) * totalValue),
        holdings: holdings.filter((holding) => holding.market_value > 0.005),
    };
};

export const buildPortfolioFromTargetWeightsWithAdditions = ({
    base = baselinePortfolio,
    targetWeights,
    newHoldingTemplates,
}: {
    base?: StatementPortfolioFixture;
    targetWeights: Record<string, number>;
    newHoldingTemplates: SyntheticHoldingTemplate[];
}): StatementPortfolioFixture => {
    const totalValue = portfolioTotalValue(base);
    const holdings = base.holdings.map((holding) => ({ ...holding }));
    const classByHolding: Record<string, string> = { ...baselineAssetClassByHolding };

    for (const template of newHoldingTemplates) {
        classByHolding[template.details] = template.assetClass;
    }

    const holdingsByAssetClass = new Map<string, StatementHoldingFixture[]>();
    holdings.forEach((holding) => {
        const assetClass = classByHolding[holding.details];
        if (!assetClass) return;
        const rows = holdingsByAssetClass.get(assetClass) || [];
        rows.push(holding);
        holdingsByAssetClass.set(assetClass, rows);
    });

    for (const [assetClass, targetWeight] of Object.entries(targetWeights)) {
        if (assetClass === 'CASH') continue;
        const targetValue = roundMoney((targetWeight / 100) * totalValue);
        if (targetValue <= 0.005) continue;
        if ((holdingsByAssetClass.get(assetClass) || []).length > 0) continue;

        const template = newHoldingTemplates.find(
            (item) => item.assetClass === assetClass,
        );
        if (!template) continue;
        const holding = buildSyntheticHolding(template, targetValue);
        holdings.push(holding);
        holdingsByAssetClass.set(assetClass, [holding]);
    }

    holdingsByAssetClass.forEach((assetHoldings, assetClass) => {
        const targetWeight = targetWeights[assetClass];
        if (targetWeight == null) return;
        const targetValue = roundMoney((targetWeight / 100) * totalValue);
        const currentValue = assetHoldings.reduce(
            (sum, holding) => sum + holding.market_value,
            0,
        );
        let assignedValue = 0;

        assetHoldings.forEach((holding, index) => {
            const value =
                index === assetHoldings.length - 1
                    ? roundMoney(targetValue - assignedValue)
                    : currentValue > 0
                      ? roundMoney(
                            targetValue * (holding.market_value / currentValue),
                        )
                      : 0;
            setHoldingMarketValue(holding, value);
            assignedValue = roundMoney(assignedValue + value);
        });
    });

    const cashWeight = targetWeights.CASH;

    return {
        accountName: base.accountName,
        cashAud:
            cashWeight == null
                ? base.cashAud
                : roundMoney((cashWeight / 100) * totalValue),
        holdings: holdings.filter((holding) => holding.market_value > 0.005),
    };
};
