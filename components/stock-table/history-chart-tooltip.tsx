import {
    performanceEventColor,
    performanceEventDimensionLabel,
    performanceEventLabel,
    performanceEventPriority,
    performanceEventTitle,
    performanceSignalStrengthLabel,
    performanceSignalWindowLabel,
    type PerformanceChartEvent,
} from './performance-events';
import styles from './history-workspace.module.css';

export const renderHistoryChartTooltip = (
    events: PerformanceChartEvent[],
    valueFormatter: (name: unknown, value: unknown) => string,
    labelFormatter: (label: unknown) => string = label => String(label ?? ''),
) =>
    ({ active, payload, label }: any) => {
        if (!active) return null;
        const dateEvents = events
            .filter((event) => event.date === label)
            .flatMap((event) =>
                event.events.length > 0 ? event.events : [event],
            )
            .sort(
                (a, b) =>
                    performanceEventPriority(a) - performanceEventPriority(b),
            );
        return (
            <div className={styles.tooltip}>
                <div className={styles.secondary}>{labelFormatter(label)}</div>
                {Array.isArray(payload) &&
                    payload
                        .filter((item) => item?.value != null)
                        .map((item) => (
                            <div
                                key={item.name || item.dataKey}
                                className={styles.tooltipRow}
                            >
                                <span
                                    className={styles.subject}
                                >
                                    <i aria-hidden="true" style={{ background: item.color }} />
                                    {item.name || item.dataKey}
                                </span>
                                <span className="text-foreground">
                                    {valueFormatter(item.name, item.value)}
                                </span>
                            </div>
                        ))}
                {dateEvents.length > 0 && (
                    <div className={styles.tooltipEvents}>
                        <div className={styles.secondary}>
                            Events
                        </div>
                        {dateEvents.slice(0, 4).map((event) => {
                            const eventLabel = performanceEventLabel(event);
                            const dimensionLabel =
                                performanceEventDimensionLabel(event);
                            const strengthLabel =
                                performanceSignalStrengthLabel(event);
                            const windowLabel =
                                performanceSignalWindowLabel(event);
                            const eventDetails = [
                                strengthLabel,
                                windowLabel,
                            ].filter(Boolean);
                            const eventTitle = performanceEventTitle(event);
                            const shouldShowTitle =
                                event.event_type !== 'signal_received' &&
                                event.event_type !== 'decision_recorded' &&
                                eventTitle !== eventLabel;
                            return (
                                <div
                                    key={event.id}
                                    className={styles.tooltipEvent}
                                >
                                    <i
                                        style={{
                                            backgroundColor:
                                                performanceEventColor(event),
                                        }}
                                    />
                                    <span>
                                        {dimensionLabel
                                            ? `${dimensionLabel}: ${eventLabel}`
                                            : eventLabel}
                                        {eventDetails.length > 0
                                            ? ` · ${eventDetails.join(' · ')}`
                                            : ''}
                                        {shouldShowTitle ? ` · ${eventTitle}` : ''}
                                    </span>
                                </div>
                            );
                        })}
                        {dateEvents.length > 4 && (
                            <div className="mt-1 text-muted-foreground">
                                +{dateEvents.length - 4} more
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };
