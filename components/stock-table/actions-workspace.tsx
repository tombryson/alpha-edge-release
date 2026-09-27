import type { ReactNode } from 'react';
import { Check, LockKeyhole } from 'lucide-react';
import type { AdjustmentInboxItem, AdjustmentStageRailItem } from '@/components/adjustments/position-adjustment-workflow';
import styles from './actions-workspace.module.css';

export function ActionsWorkspaceRail({ items, stages, title, description, tone = 'neutral', children }: {
    items: AdjustmentInboxItem[];
    stages: AdjustmentStageRailItem[];
    title: string;
    description: string;
    tone?: 'neutral' | 'warning' | 'success';
    children?: ReactNode;
}) {
    return (
        <aside className={styles.rail} aria-label="Portfolio action workflow" data-testid="actions-workflow">
            <nav className={styles.inbox} aria-label="Choose portfolio action">
                {items.map(item => (
                    <button type="button" key={item.key} onClick={item.onClick}
                        aria-pressed={Boolean(item.active)} className={styles.actionChoice}>
                        <span>{item.title}</span>
                        <small>{item.source}</small>
                    </button>
                ))}
            </nav>
            {stages.length > 0 && (
                <ol className={styles.stages} aria-label="Action progress">
                    {stages.map((stage, index) => {
                        const complete = /^(complete|confirmed|matched)$/i.test(stage.badge);
                        const locked = /^locked$/i.test(stage.badge);
                        return (
                            <li key={stage.key} data-current={Boolean(stage.active)} data-complete={complete}>
                                <button type="button" disabled={!stage.onClick} onClick={stage.onClick}
                                    aria-current={stage.active ? 'step' : undefined}
                                    data-testid={`${items.find(item => item.active)?.key === 'portfolio-target-adjustment' ? 'portfolio' : 'risk'}-workflow-stage-${stage.key}`}
                                    data-active={stage.active ? 'true' : 'false'} title={stage.caption}>
                                    <span className={styles.stepNumber}>{complete ? <Check size={13} /> : locked ? <LockKeyhole size={12} /> : index + 1}</span>
                                    <span>{['Adjust positions', 'Check statement', 'Complete'][index]}<small>{stage.badge}</small></span>
                                </button>
                            </li>
                        );
                    })}
                </ol>
            )}
            <header className={styles.summary} data-tone={tone}>
                <h2 data-testid="actions-current-task">{title}</h2>
                <p>{description}</p>
            </header>
            <div className={styles.details}>{children}</div>
        </aside>
    );
}

export function ActionMetrics({ label, values }: { label: string; values: Array<{ label: string; value: string; tone?: 'warning' | 'success' }> }) {
    return (
        <dl className={styles.metrics} aria-label={label}>
            {values.map(item => <div key={item.label}>
                <dt>{item.label}</dt><dd data-tone={item.tone}>{item.value}</dd>
            </div>)}
        </dl>
    );
}
