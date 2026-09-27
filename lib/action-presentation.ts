import type { DecisionResponse, SecurityActionResponse } from './api';
import type { Alert } from './store';

export const ACTIONS_CHANGED = 'security-actions:changed';
export const ALERT_ACTION_REQUESTED = 'alert-action:open';
export const DECISION_HISTORY_REQUESTED = 'decision-history:open';
export type AlertActionSelection = { id: number; ticker: string };

export function openAlertAction(action: AlertActionSelection) {
    window.dispatchEvent(
        new CustomEvent(ALERT_ACTION_REQUESTED, { detail: action }),
    );
}

export function openDecisionHistory(ticker = '') {
    window.dispatchEvent(
        new CustomEvent(DECISION_HISTORY_REQUESTED, { detail: { ticker } }),
    );
}

export function actionIsClosed(action: SecurityActionResponse) {
    return ['CONFIRMED', 'IGNORED', 'EXPIRED', 'NOT_APPLICABLE'].includes(
        action.status,
    );
}

export function actionStatusLabel(action: SecurityActionResponse) {
    if (action.status === 'OPEN' && action.intent === 'DEPLOY' && action.deployment_state && action.deployment_state !== 'FUNDED') return 'Add paused';
    if (
        action.status === 'CONFIRMED' &&
        action.reconciliation_method === 'MANUAL_EXTERNAL'
    )
        return 'Recorded externally';
    const labels: Record<SecurityActionResponse['status'], string> = {
        OPEN: 'Needs action',
        BLOCKED: 'Waiting on earlier action',
        AWAITING_STATEMENT: 'Awaiting statement',
        VARIANCE: 'Statement mismatch',
        OVERRIDDEN: 'Exit retained for review',
        CONFIRMED: 'Statement confirmed',
        IGNORED: 'Ignored',
        EXPIRED: 'Expired',
        NOT_APPLICABLE: 'Not applicable',
    };
    return labels[action.status];
}

export function actionStatusTone(action: SecurityActionResponse) {
    if (action.status === 'OPEN' && action.intent === 'DEPLOY' && action.deployment_state && action.deployment_state !== 'FUNDED') return 'warning';
    if (action.status === 'VARIANCE' || action.status === 'OVERRIDDEN')
        return 'warning';
    if (action.status === 'AWAITING_STATEMENT') return 'pending';
    if (action.status === 'CONFIRMED') return 'complete';
    return 'neutral';
}

export function actionInstruction(action: SecurityActionResponse) {
    // Clarify the source's existing trim rule, never infer a historical execution amount.
    if (
        action.alert_type === 'TRIM' &&
        action.instruction === 'Trim using source instruction'
    ) {
        const strength = action.strength?.toLowerCase();
        if (strength === 'strong')
            return 'Trim 20% of the holding (Strong TMS signal)';
        if (strength === 'weak')
            return 'Trim 5% of the holding (Weak TMS signal)';
        return 'Trim size was not supplied by the source';
    }
    return action.instruction;
}

export function actionStatusDetail(action: SecurityActionResponse) {
    if (action.closed_reason) return action.closed_reason;
    if (action.status === 'OPEN' && action.intent === 'DEPLOY' && action.deployment_state && action.deployment_state !== 'FUNDED') return action.instruction;
    switch (action.status) {
        case 'AWAITING_STATEMENT':
            return 'Execution recorded. Waiting for a later broker statement; do not record the same trade again.';
        case 'VARIANCE':
            return 'The later statement did not match the recorded execution. Check the broker quantities and import before proceeding.';
        case 'BLOCKED':
            return action.blocked_by_instruction
                ? `Waiting for: ${action.blocked_by_instruction}`
                : 'An earlier or higher-priority action must be resolved first.';
        case 'OVERRIDDEN':
            return (
                action.override_reason ||
                'The position was retained. The exit remains unresolved.'
            );
        case 'NOT_APPLICABLE':
            return 'Closed as not applicable. This status alone does not establish that a holding was sold.';
        case 'CONFIRMED': {
            const methods: Record<string, string> = {
                MANUAL_EXTERNAL:
                    'Recorded manually for an external broker; not verified by IG.',
                UNITS_AND_MANUAL_EXTERNAL:
                    'IG quantities matched; external executions were recorded manually.',
                ESTIMATED_UNITS:
                    'Statement quantities matched within 10% of the estimate.',
                REPORTED_UNITS:
                    'Statement quantities matched the reported units.',
                QUANTITY_DIRECTION:
                    'A quantity decrease was observed; the trim amount was not verified.',
            };
            return (
                methods[action.reconciliation_method || ''] ||
                'Confirmed under the matching policy recorded at the time.'
            );
        }
        default:
            return '';
    }
}

export function alertStackActions(actions: SecurityActionResponse[]): SecurityActionResponse[] {
    const byScope = new Map<string, SecurityActionResponse>();
    const attentionRank = (action: SecurityActionResponse) =>
        (action.intent === 'EXIT' ? 0 : 2) + (action.status === 'OPEN' ? 1 : 0);
    const compareAttention = (a: SecurityActionResponse, b: SecurityActionResponse) =>
        attentionRank(a) - attentionRank(b) ||
        Number(b.is_primary) - Number(a.is_primary) ||
        a.created_at.localeCompare(b.created_at) || a.id - b.id;

    for (const action of actions) {
        if (action.alert_type === 'WEIGHT_CLASS_REVIEW') continue;
        const needsReview = action.status === 'VARIANCE' || action.status === 'OVERRIDDEN';
        if (!needsReview && !(action.status === 'OPEN' && action.is_primary)) continue;
        const key = `${action.scope}:${action.ticker.trim().toUpperCase()}`;
        const current = byScope.get(key);
        // Keep one attention item per scope. Never let an older trim hide an unresolved Exit.
        if (!current || compareAttention(action, current) < 0) byScope.set(key, action);
    }
    return [...byScope.values()];
}

export function mergeActionAlerts(
    alerts: Alert[],
    actions: SecurityActionResponse[],
    managedAlertIds: ReadonlySet<string> = new Set(),
): Alert[] {
    const records = new Map(alerts.filter(alert => !managedAlertIds.has(alert.id) && !alert.alert_type?.startsWith('WEIGHT_')).map((alert) => [alert.id, alert]));
    // Managed action state replaces the raw alert, including when it belongs only in History.
    for (const action of actions) {
        records.delete(String(action.alert_id));
    }
    const rawById = new Map(alerts.map((alert) => [alert.id, alert]));
    for (const action of alertStackActions(actions)) {
        const existing = rawById.get(String(action.alert_id));
        const rawSignal =
            action.alert_type === 'EQUITY_REGIME_STRONG_TRIM'
                ? 'SELL_DOWN'
                : action.alert_type;
        const signal = [
            'BUY',
            'SELL',
            'SELL_50',
            'ADD',
            'TRIM',
            'BREAKOUT',
            'SELL_DOWN',
            'REENTRY',
            'DCA',
            'OUTPERFORM_CONFIRMED',
            'OUTPERFORM_LOST',
            'WEIGHT_REDUCE',
        ].includes(rawSignal)
            ? (rawSignal as Alert['signal'])
            : existing?.signal;
        if (!signal) continue;
        records.set(String(action.alert_id), {
            ...existing,
            id: String(action.alert_id),
            symbol: existing?.symbol || action.ticker,
            signal: existing?.signal || signal,
            alert_type: action.alert_type,
            timestamp: existing?.timestamp || new Date(action.created_at),
            reason: existing?.reason || action.instruction,
            confidence: existing?.confidence || 0,
            dismissed: false,
            source: action.source,
            strength:
                action.strength?.toLowerCase() === 'strong'
                    ? 'Strong'
                    : action.strength?.toLowerCase() === 'weak'
                      ? 'Weak'
                      : existing?.strength,
            themeAssetClass:
                action.scope === 'ASSET_CLASS'
                    ? action.asset_class_code
                    : existing?.themeAssetClass,
        });
    }
    return [...records.values()];
}

export function actionCompactLabel(action: SecurityActionResponse): string | null {
    if (action.alert_type === 'WEIGHT_REDUCE') return `Reduce $${Math.round(action.instruction_value || 0).toLocaleString('en-AU')}`;
    if (action.intent !== 'DEPLOY' || action.status !== 'OPEN') return null;
    if (action.deployment_state === 'WEIGHT_LIMIT') return 'Add paused · At ideal';
    if (action.deployment_state === 'TARGET_UNAVAILABLE') return 'Add paused · Check data';
    if (action.deployment_state && action.deployment_state !== 'FUNDED') return 'Add paused';
    if (action.deployment_state === 'FUNDED') return `Add up to $${Math.round(action.instruction_value || 0).toLocaleString('en-AU')}`;
    return null;
}

export type DecisionHistoryRecord = {
    key: string;
    ticker: string;
    date: string;
    alertType: string;
    decision?: DecisionResponse;
    action?: SecurityActionResponse;
};

export function decisionHistoryRecords(
    decisions: DecisionResponse[],
    actions: SecurityActionResponse[],
): DecisionHistoryRecord[] {
    const byAlert = new Map(actions.map((action) => [action.alert_id, action]));
    const represented = new Set(decisions.map((decision) => decision.alert_id));
    const rows: DecisionHistoryRecord[] = decisions.map((decision) => ({
        key: `decision:${decision.id}`,
        ticker: decision.ticker,
        date: decision.created_at,
        alertType: decision.alert_type,
        decision,
        action: byAlert.get(decision.alert_id),
    }));
    for (const action of actions) {
        if (represented.has(action.alert_id)) continue;
        rows.push({
            key: `action:${action.id}`,
            ticker: action.ticker,
            date: ['OPEN', 'BLOCKED'].includes(action.status)
                ? action.created_at
                : action.execution_reported_at || action.updated_at || action.created_at,
            alertType: action.alert_type,
            action,
        });
    }
    return rows.sort(
        (a, b) =>
            new Date(b.date).getTime() - new Date(a.date).getTime() ||
            a.key.localeCompare(b.key),
    );
}
