export const canonicalAlertType = (value?: string | null) => {
    const normalized = String(value || '')
        .trim()
        .toUpperCase()
        .replace(/[-\s]+/g, '_');

    switch (normalized) {
        case 'CDF_BUY_ZONE':
        case 'OMS_BUY_ZONE':
            return 'BREAKOUT';
        case 'SELL_HALF':
        case 'SELL_50':
        case 'SELL_50_PERCENT':
        case 'SELL_50%':
            return 'SELL_50';
        case 'CDF_SELL_ZONE':
        case 'OMS_SELL_ZONE':
            return 'SELL_DOWN';
        case 'RE_ENTRY':
            return 'REENTRY';
        default:
            return normalized;
    }
};

export const alertTypeLabel = (value?: string | null) => {
    switch (canonicalAlertType(value)) {
        case 'ADD':
            return 'Add';
        case 'TRIM':
            return 'Trim';
        case 'WEIGHT_REDUCE':
            return 'Reduce exposure';
        case 'WEIGHT_CLASS_REVIEW':
            return 'Review class allocation';
        case 'BUY':
            return 'Buy';
        case 'SELL':
            return 'Exit';
        case 'SELL_50':
            return 'Sell Down 50%';
        case 'BREAKOUT':
            return 'Breakout';
        case 'SELL_DOWN':
            return 'Sell Down 20%';
        case 'REDUCE_TO_OUTPERFORM_LIMIT':
            return 'Outperform Trim';
        case 'EQUITY_REGIME_STRONG_TRIM':
            return 'Equity Regime Breakdown';
        case 'OUTPERFORM_CONFIRMED':
            return 'Outperformance';
        case 'OUTPERFORM_LOST':
            return 'Underperformance';
        case 'REENTRY':
            return 'Re-entry';
        case 'REGIME':
            return 'Regime';
        case 'DCA':
            return 'DCA';
        case 'CASH_ALLOCATION':
            return 'Cash Allocation';
        case 'CONNECT':
        case 'CONNECTED':
        case 'CONNECTION':
            return 'Connection';
        case 'TEST':
            return 'Test';
        case '':
            return '-';
        default:
            return canonicalAlertType(value)
                .toLowerCase()
                .replace(/_/g, ' ')
                .replace(/\b\w/g, (letter) => letter.toUpperCase());
    }
};
