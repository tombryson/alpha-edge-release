import type { PerformanceEvent } from '@/lib/api';
import { actionTypeLabel, normalizeActionType } from './action-labels';

type PerformanceEventDisplaySource = Pick<
    PerformanceEvent,
    'severity' | 'event_type'
> &
    Partial<Pick<PerformanceEvent, 'title' | 'metadata'>>;

const performanceMetadataText = (
    metadata: PerformanceEvent['metadata'] | undefined,
    key: string,
) => {
    const value = metadata?.[key];
    return typeof value === 'string' ? value.trim() : '';
};

const performanceSignalBaseActionLabel = (
    event?: PerformanceEventDisplaySource,
    fallbackAction?: string,
) => {
    return normalizeActionType(
        performanceMetadataText(event?.metadata, 'alert_type') || fallbackAction,
    );
};

export const performanceSignalStrengthLabel = (
    event?: PerformanceEventDisplaySource,
) => {
    const strength = performanceMetadataText(event?.metadata, 'strength').toLowerCase();
    if (!strength) return '';
    return strength.charAt(0).toUpperCase() + strength.slice(1);
};

export const performanceSignalWindowLabel = (
    event?: PerformanceEventDisplaySource,
) =>
    performanceMetadataText(event?.metadata, 'timeframe')
        .toUpperCase()
        .replace(/\s+/g, '');

export const performanceEventActionLabel = (
    event?: PerformanceEventDisplaySource,
) => {
    if (
        event?.event_type !== 'signal_received' &&
        event?.event_type !== 'decision_recorded' &&
        event?.event_type !== 'signal_expired'
    ) {
        return '';
    }
    const baseAction = String(event.title || '')
        .replace(/\s+(signal|decision|expired)$/i, '')
        .trim()
        .toUpperCase();
    return performanceSignalBaseActionLabel(event, baseAction);
};

export const performanceEventColor = (event?: PerformanceEventDisplaySource) => {
    if (event?.event_type === 'signal_expired') return '#787676';
    const actionLabel = normalizeActionType(performanceEventActionLabel(event));
    if (
        actionLabel.includes('ADD') ||
        actionLabel.includes('BUY') ||
        actionLabel.includes('BREAKOUT')
    ) {
        return '#22c55e';
    }
    if (
        actionLabel.includes('TRIM') ||
        actionLabel.includes('SELL') ||
        actionLabel.includes('REMOVE')
    ) {
        return '#ef6461';
    }
    if (['IGNORE', 'VIEW'].includes(actionLabel)) return '#7a9cc6';

    switch (event?.event_type) {
        case 'statement_imported':
            return '#787676';
        case 'signal_received':
            return '#5bc0be';
        case 'decision_recorded':
            return '#7a9cc6';
        case 'q3_target_changed':
            return '#f4b942';
        case 'q4_state_changed':
            return '#ef6461';
        case 'portfolio_risk_action_created':
            return '#f4b942';
        case 'position_action_confirmed':
            return '#5bc0be';
        case 'statement_matched':
            return '#22c55e';
        case 'portfolio_target_created':
            return '#c084fc';
        case 'portfolio_target_completed':
            return '#a78bfa';
        case 'baseline_approved':
            return '#38bdf8';
    }
    return '#7a9cc6';
};

export const performanceEventTitle = (
    event?: Pick<PerformanceEvent, 'event_type'> &
        Partial<Pick<PerformanceEvent, 'title'>>,
) =>
    event?.title ||
    String(event?.event_type || 'event')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase());

export const performanceEventLabel = (
    event?: PerformanceEventDisplaySource,
) => {
    const actionLabel = performanceEventActionLabel(event);
    if (event?.event_type === 'signal_expired' && actionLabel) {
        return `${actionTypeLabel(actionLabel)} expired`;
    }
    if (actionLabel) return actionTypeLabel(actionLabel);

    switch (event?.event_type) {
        case 'statement_imported':
            return 'Statement imported';
        case 'signal_received':
            return 'Signal received';
        case 'decision_recorded':
            return 'Decision recorded';
        case 'signal_expired':
            return 'Signal expired';
        case 'q3_target_changed':
            return 'Q3 target changed';
        case 'q4_state_changed':
            return 'Q4 state changed';
        case 'portfolio_risk_action_created':
            return 'Portfolio risk action';
        case 'position_action_confirmed':
            return 'Position action confirmed';
        case 'statement_matched':
            return 'Statement matched';
        case 'portfolio_target_created':
            return 'Portfolio target created';
        case 'portfolio_target_completed':
            return 'Portfolio target completed';
        case 'baseline_approved':
            return 'Baseline approved';
    }
    return performanceEventTitle(event);
};

export const performanceEventDimensionLabel = (
    event?: Pick<PerformanceEvent, 'event_type'>,
) => {
    if (event?.event_type === 'signal_received') return 'Signal';
    if (event?.event_type === 'decision_recorded') return 'Decision';
    if (event?.event_type === 'signal_expired') return 'Expired';
    return '';
};

export const performanceEventPriority = (
    event?: Pick<PerformanceEvent, 'event_type'>,
) => {
    if (event?.event_type === 'signal_received') return 0;
    if (event?.event_type === 'signal_expired') return 1;
    if (event?.event_type === 'decision_recorded') return 2;
    return 2;
};

export const performanceEventDash = (event?: PerformanceEventDisplaySource) => {
    const actionLabel = normalizeActionType(performanceEventActionLabel(event));
    if (actionLabel) {
        if (
            actionLabel.includes('TRIM') ||
            actionLabel.includes('SELL') ||
            actionLabel.includes('REMOVE')
        ) {
            return '6 3';
        }
        if (
            actionLabel.includes('ADD') ||
            actionLabel.includes('BUY') ||
            actionLabel.includes('BREAKOUT')
        ) {
            return '2 2';
        }
        return '4 2';
    }

    switch (event?.event_type) {
        case 'statement_imported':
        case 'statement_matched':
            return '1 0';
        case 'q3_target_changed':
        case 'q4_state_changed':
        case 'portfolio_risk_action_created':
            return '3 3';
        case 'signal_received':
        case 'decision_recorded':
        case 'signal_expired':
            return '4 2';
        case 'position_action_confirmed':
        case 'portfolio_target_completed':
        case 'baseline_approved':
            return '2 2';
    }
    return '4 4';
};

export type PerformanceChartEvent = PerformanceEvent & {
    date: string;
    count: number;
    events: PerformanceEvent[];
};

export const buildPerformanceEventLegendItems = (
    events: PerformanceChartEvent[],
) => {
    const items = new Map<
        string,
        { label: string; color: string; dash: string }
    >();

    events.forEach((groupedEvent) => {
        const sourceEvents =
            groupedEvent.events.length > 0 ? groupedEvent.events : [groupedEvent];
        sourceEvents.forEach((event) => {
            const label = performanceEventLabel(event);
            if (items.has(label)) return;
            items.set(label, {
                label: performanceEventLabel(event),
                color: performanceEventColor(event),
                dash: performanceEventDash(event),
            });
        });
    });

    return Array.from(items.values());
};
