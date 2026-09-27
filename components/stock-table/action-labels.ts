import { alertTypeLabel, canonicalAlertType } from '@/lib/alert-format';

export const normalizeActionType = (value?: string | null) => {
    return canonicalAlertType(value);
};

export const actionTypeLabel = (value?: string | null) => {
    const action = normalizeActionType(value);
    if (!action) return '-';
    return alertTypeLabel(action);
};

// The action surface names the required operator move. Raw alert labels retain
// the source event's more specific wording for history and audit.
export const securityActionLabel = (value?: string | null) => {
    switch (normalizeActionType(value)) {
        case 'SELL':
            return 'Exit';
        case 'SELL_50':
        case 'SELL_DOWN':
        case 'TRIM':
        case 'WEIGHT_REDUCE':
        case 'REDUCE_TO_OUTPERFORM_LIMIT':
        case 'EQUITY_REGIME_STRONG_TRIM':
            return 'Reduce';
        case 'ADD':
            return 'Add';
        case 'BUY':
        case 'BREAKOUT':
            return 'Enter';
        case 'REENTRY':
            return 'Re-enter';
        default:
            return actionTypeLabel(value);
    }
};

export const historySignalBadgeClass = (value?: string | null) => {
    const action = normalizeActionType(value);
    if (action === 'ADD' || action === 'BUY' || action === 'BREAKOUT') {
        return 'border-success/35 bg-success/35 text-success-foreground shadow-[inset_0_0_10px_rgba(34,197,94,0.22)]';
    }
    if (action === 'SELL' || action === 'SELL_50' || action === 'SELL_DOWN' || action === 'TRIM') {
        return 'border-destructive/40 bg-destructive/70 text-destructive-foreground shadow-[inset_0_0_10px_rgba(239,68,68,0.2)]';
    }
    if (action === 'CONNECT' || action === 'CASH_ALLOCATION') {
        return 'border-info/35 bg-info/20 text-info';
    }
    return 'border-muted-foreground/20 bg-muted/70 text-muted-foreground';
};
