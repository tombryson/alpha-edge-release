export const PORTFOLIO_BRIEF_KEY = 'portfolio_investment_brief';
export const RISK_TOLERANCE_OPTIONS = ['low', 'medium', 'high'] as const;
export const TIME_HORIZON_OPTIONS = ['1-2 years', '3-5 years', '5+ years'] as const;

export interface PortfolioInvestmentBrief {
    portfolio_scope?: 'whole_portfolio' | 'thematic_sleeve';
    investment_objective?: string;
    base_currency?: string;
    benchmark?: string;
    risk_tolerance?: typeof RISK_TOLERANCE_OPTIONS[number];
    time_horizon?: typeof TIME_HORIZON_OPTIONS[number];
    horizon_months?: number;
    liquidity_min_pct?: number;
    max_drawdown_pct?: number;
    tax_cost_policy?: string;
    currency_hedge_policy?: string;
    investment_restrictions?: string;
}

export function prepareInvestmentBrief(input: PortfolioInvestmentBrief): PortfolioInvestmentBrief {
    const result: PortfolioInvestmentBrief = {};
    if (input.portfolio_scope) {
        if (!['whole_portfolio', 'thematic_sleeve'].includes(input.portfolio_scope)) throw new Error('Choose a portfolio scope.');
        result.portfolio_scope = input.portfolio_scope;
    }
    if (input.risk_tolerance) {
        if (!RISK_TOLERANCE_OPTIONS.includes(input.risk_tolerance)) throw new Error('Choose low, medium or high risk tolerance.');
        result.risk_tolerance = input.risk_tolerance;
    }
    if (input.time_horizon) {
        if (!TIME_HORIZON_OPTIONS.includes(input.time_horizon)) throw new Error('Choose an investment time horizon.');
        result.time_horizon = input.time_horizon;
    }
    for (const key of ['investment_objective', 'base_currency', 'benchmark', 'tax_cost_policy', 'currency_hedge_policy', 'investment_restrictions'] as const) {
        if (typeof input[key] === 'string' && input[key]?.trim()) result[key] = input[key]!.trim();
    }
    if (result.base_currency) {
        result.base_currency = result.base_currency.toUpperCase();
        if (!/^[A-Z]{3}$/.test(result.base_currency)) throw new Error('Base currency must use a three-letter code.');
    }
    for (const key of ['horizon_months', 'liquidity_min_pct', 'max_drawdown_pct'] as const) {
        // A selected range replaces the old exact horizon, without inventing a midpoint.
        if (key === 'horizon_months' && result.time_horizon) continue;
        const value = input[key];
        if (value === undefined || value === null) continue;
        if (!Number.isFinite(value) || value < 0 || (key === 'horizon_months' ? value === 0 : value > 100)) {
            throw new Error(key === 'horizon_months' ? 'Investment horizon must be positive.' : 'Portfolio percentages must be between 0 and 100.');
        }
        result[key] = value;
    }
    return result;
}

export function readInvestmentBrief(settings: Record<string, string>): PortfolioInvestmentBrief {
    const raw = settings[PORTFOLIO_BRIEF_KEY];
    if (!raw) return {};
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Saved investment brief is invalid.');
    return prepareInvestmentBrief(value);
}
