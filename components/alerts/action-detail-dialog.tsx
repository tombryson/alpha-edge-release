'use client';

import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, History, X } from 'lucide-react';
import { api, type SecurityActionResponse } from '@/lib/api';
import { useStore } from '@/lib/store';
import { useSecurityActions } from '@/lib/use-security-actions';
import {
    ACTIONS_CHANGED,
    actionInstruction,
    actionStatusDetail,
    actionStatusLabel,
    actionStatusTone,
    openDecisionHistory,
    type AlertActionSelection,
} from '@/lib/action-presentation';
import styles from './action-detail.module.css';

export function ActionEvidence({ action }: { action: SecurityActionResponse }) {
    const weight = action.weight_evidence;
    const money = (value: number) => `$${Math.round(value).toLocaleString('en-AU')}`;
    const timestamp = (value: string) =>
        new Date(value).toLocaleString('en-AU');
    return (
        <dl className={styles.evidence}>
            {weight && <>
                <dt>Holding</dt><dd>{money(weight.held)}</dd>
                <dt>{weight.role === 'CLASS' ? 'Approved class' : 'Ideal'}</dt><dd>{money(weight.ideal)}</dd>
                {weight.role !== 'CLASS' && <><dt>Remaining</dt><dd>{money(weight.remaining)}</dd></>}
                <dt>Valuation</dt><dd>{weight.observed_date}</dd>
                {weight.role !== 'CLASS' && <><dt>Rule</dt><dd>{weight.role === 'CORE_ETF' ? '125% trigger; reduce to 100% of ideal' : '150% trigger; reduce to 125% of ideal'}. Confirmed across two statement dates.</dd></>}
            </>}
            {action.intent === 'DEPLOY' &&
                action.status === 'OPEN' &&
                action.deployment_state === 'FUNDED' &&
                action.instruction_value != null && (
                    <>
                        <dt>Funded purchase</dt>
                        <dd>
                            $
                            {action.instruction_value.toLocaleString('en-AU', {
                                maximumFractionDigits: 0,
                            })}{' '}
                            AUD
                        </dd>
                    </>
                )}
            <dt>{weight ? 'Review created' : 'Signal received'}</dt>
            <dd>{timestamp(action.created_at)}</dd>
            <dt>Source</dt>
            <dd>
                {[
                    weight ? 'Weight management' : action.source?.toUpperCase(),
                    action.timeframe,
                    action.strength,
                ]
                    .filter(Boolean)
                    .join(' · ') || 'Not recorded'}
            </dd>
            {action.scope === 'ASSET_CLASS' && action.intent !== 'REVIEW' && (
                <>
                    <dt>Affected holdings</dt>
                    <dd>
                        {action.affected_tickers?.join(', ') || 'Not recorded'}
                    </dd>
                </>
            )}
            {action.execution_reported_at && (
                <>
                    <dt>Execution recorded</dt>
                    <dd>{timestamp(action.execution_reported_at)}</dd>
                </>
            )}
            {action.execution_units != null && (
                <>
                    <dt>Units reported</dt>
                    <dd>{action.execution_units.toLocaleString()}</dd>
                </>
            )}
            {action.execution_note && (
                <>
                    <dt>Execution note</dt>
                    <dd>{action.execution_note}</dd>
                </>
            )}
            {action.execution_cash_value != null && (
                <>
                    <dt>AUD spent</dt>
                    <dd>${action.execution_cash_value.toLocaleString()}</dd>
                </>
            )}
            {action.execution_exception_reason && (
                <>
                    <dt>Exception reason</dt>
                    <dd>{action.execution_exception_reason}</dd>
                </>
            )}
            {action.override_reason && (
                <>
                    <dt>Retention reason</dt>
                    <dd>{action.override_reason}</dd>
                </>
            )}
            {action.next_review_at && (
                <>
                    <dt>Review date</dt>
                    <dd>{timestamp(action.next_review_at)}</dd>
                </>
            )}
            {action.reconciled_statement_id && (
                <>
                    <dt>Statement</dt>
                    <dd>
                        #{action.reconciled_statement_id}
                        {action.reconciled_at
                            ? ` · ${timestamp(action.reconciled_at)}`
                            : ''}
                    </dd>
                </>
            )}
        </dl>
    );
}

export function AlertActionDetail({
    selection,
    onClose,
}: {
    selection: AlertActionSelection;
    onClose: () => void;
}) {
    const {
        actions,
        loading,
        error: loadError,
        refresh,
    } = useSecurityActions({ ticker: selection.ticker, includeHistory: true });
    const action = actions.find((row) => row.id === selection.id);
    const stock = useStore((state) => state.stocks).find(
        (row) =>
            row.symbol === selection.ticker ||
            `${row.prefix || ''}${row.symbol}` === selection.ticker,
    );
    const name =
        action?.scope === 'ASSET_CLASS'
            ? action.asset_class_code?.replace(/_/g, ' ') || selection.ticker
            : stock?.name || selection.ticker;
    const [units, setUnits] = useState('');
    const [note, setNote] = useState('');
    const [reason, setReason] = useState('');
    const [cash, setCash] = useState('');
    const [override, setOverride] = useState(false);
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const returnFocus = useRef<HTMLElement | null>(null);
    const [error, setError] = useState('');
    const parsedUnits = units.trim() ? Number(units) : undefined;
    const unitsValid =
        parsedUnits === undefined ||
        (Number.isFinite(parsedUnits) && parsedUnits > 0);
    const unavailable = saving || loading || !!loadError;
    const executable =
        action?.status === 'OPEN' &&
        action.is_primary &&
        (action.intent !== 'DEPLOY' ||
            action.is_external ||
            action.deployment_state === 'FUNDED');
    const exceptionAllowed =
        action?.can_record_purchase_exception &&
        action.intent === 'DEPLOY' &&
        !action.is_external &&
        action.scope === 'SECURITY' &&
        ['OPEN', 'BLOCKED'].includes(action.status);
    const pausedPurchase = action?.status === 'OPEN' && action.intent === 'DEPLOY' && !executable;
    const run = async (operation: () => Promise<unknown>) => {
        if (savingRef.current || loading || loadError) return;
        savingRef.current = true;
        setSaving(true);
        setError('');
        try {
            await operation();
            setUnits('');
            setNote('');
            setReason('');
            setCash('');
            setOverride(false);
            window.dispatchEvent(new Event(ACTIONS_CHANGED));
            await useStore.getState().fetchAlerts();
            await refresh();
            onClose();
        } catch (cause) {
            setError(
                cause instanceof Error
                    ? cause.message
                    : 'Execution could not be recorded.',
            );
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };
    return (
        <Dialog.Root
            open
            onOpenChange={(open) => {
                if (!open && !savingRef.current) onClose();
            }}
        >
            <Dialog.Portal>
                <Dialog.Overlay className={styles.backdrop} />
                <Dialog.Content
                    className={styles.dialog}
                    data-testid="alert-action-detail"
                    aria-describedby={undefined}
                    onOpenAutoFocus={() => {
                        returnFocus.current =
                            document.activeElement as HTMLElement;
                    }}
                    onCloseAutoFocus={(event) => {
                        if (returnFocus.current?.isConnected) {
                            event.preventDefault();
                            returnFocus.current.focus();
                        }
                    }}
                >
                    <header className={styles.header}>
                        <div>
                            <Dialog.Title className={styles.title}>
                                {name}
                            </Dialog.Title>
                            <p className={styles.meta}>
                                {selection.ticker} · {action?.weight_evidence ? 'Weight management' : 'Alert Stack'}
                            </p>
                        </div>
                        <Dialog.Close
                            disabled={saving}
                            className={styles.close}
                            aria-label="Close alert detail"
                            title="Close alert detail"
                        >
                            <X />
                        </Dialog.Close>
                    </header>
                    {loadError && (
                        <p role="alert" className={styles.error}>
                            {loadError}{' '}
                            <button
                                className={styles.button}
                                onClick={() => void refresh()}
                            >
                                Retry
                            </button>
                        </p>
                    )}
                    {loading && (
                        <p role="status">Loading execution status...</p>
                    )}
                    {!loading && !loadError && !action && (
                        <p>No matching execution record is available.</p>
                    )}
                    {action && (
                        <>
                            <span
                                className={styles.status}
                                data-tone={actionStatusTone(action)}
                            >
                                {actionStatusLabel(action)}
                            </span>
                            <p className={styles.instruction}>
                                {actionInstruction(action)}
                            </p>
                            {actionStatusDetail(action) && actionStatusDetail(action) !== actionInstruction(action) && (
                                <p className={styles.detail}>
                                    {actionStatusDetail(action)}
                                </p>
                            )}
                            {action.weight_evidence && actions.some(other => other.intent === 'DEPLOY' && other.status === 'BLOCKED') && <p className={styles.detail}>An Add signal is waiting behind this review.</p>}
                            <ActionEvidence action={action} />
                            {action.intent === 'REVIEW' && action.status === 'OPEN' && <div className={styles.actions}>
                                <a href="#/portfolio" onClick={onClose} className={styles.button}>Open Portfolio</a>
                                <button className={styles.button} disabled={unavailable} onClick={() => void run(() => api.ignoreSecurityAction(action.id))}>Dismiss review</button>
                            </div>}
                            {pausedPurchase && <div className={styles.actions}>
                                <button type="button" className={styles.button} disabled={unavailable || !action.is_primary}
                                    onClick={() => void run(() => api.ignoreSecurityAction(action.id))}>Ignore</button>
                            </div>}
                            {action.status === 'OPEN' && action.intent !== 'REVIEW' && !pausedPurchase && (
                                <form
                                    className={styles.form}
                                    onSubmit={(event) => {
                                        event.preventDefault();
                                        if (unitsValid && executable)
                                            void run(() =>
                                                api.recordSecurityActionExecution(
                                                    action.id,
                                                    note,
                                                    action.scope ===
                                                        'ASSET_CLASS'
                                                        ? undefined
                                                        : parsedUnits,
                                                    undefined,
                                                    action.alert_type === 'WEIGHT_REDUCE' ? action.instruction_value : undefined,
                                                ),
                                            );
                                    }}
                                >
                                    {action.scope === 'SECURITY' && (
                                        <label>
                                            Units traded (optional)
                                            <input
                                                type="number"
                                                min="0"
                                                step="any"
                                                value={units}
                                                onChange={(event) =>
                                                    setUnits(event.target.value)
                                                }
                                                aria-invalid={!unitsValid}
                                                disabled={unavailable}
                                            />
                                        </label>
                                    )}
                                    <label>
                                        Execution note (optional)
                                        <textarea
                                            rows={2}
                                            value={note}
                                            onChange={(event) =>
                                                setNote(event.target.value)
                                            }
                                            disabled={unavailable}
                                        />
                                    </label>
                                    <div className={styles.actions}>
                                        {action.intent !== 'EXIT' && (
                                            <button
                                                type="button"
                                                className={styles.button}
                                                disabled={
                                                    unavailable ||
                                                    !action.is_primary
                                                }
                                                onClick={() =>
                                                    void run(() =>
                                                        api.ignoreSecurityAction(
                                                            action.id,
                                                        ),
                                                    )
                                                }
                                            >
                                                {action.weight_evidence ? 'Dismiss' : 'Ignore'}
                                            </button>
                                        )}
                                        {action.intent === 'EXIT' && (
                                            <button
                                                type="button"
                                                className={styles.button}
                                                disabled={
                                                    unavailable ||
                                                    !action.is_primary
                                                }
                                                onClick={() =>
                                                    setOverride(
                                                        (value) => !value,
                                                    )
                                                }
                                            >
                                                Retain with reason
                                            </button>
                                        )}
                                        <button
                                            type="submit"
                                            className={styles.button}
                                            data-primary="true"
                                            disabled={
                                                unavailable ||
                                                !executable ||
                                                !unitsValid
                                            }
                                        >
                                            <Check />
                                            {saving
                                                ? 'Recording...'
                                                : action.is_external
                                                  ? 'Record external execution'
                                                  : action.weight_evidence ? 'Record reduction' : 'Record execution'}
                                        </button>
                                    </div>
                                </form>
                            )}
                            {override &&
                                action.status === 'OPEN' &&
                                action.intent === 'EXIT' && (
                                    <form
                                        className={styles.form}
                                        onSubmit={(event) => {
                                            event.preventDefault();
                                            if (reason.trim())
                                                void run(() =>
                                                    api.overrideSecurityActionExit(
                                                        action.id,
                                                        reason.trim(),
                                                    ),
                                                );
                                        }}
                                    >
                                        <label>
                                            Reason for retaining the position
                                            <textarea
                                                required
                                                rows={2}
                                                value={reason}
                                                onChange={(event) =>
                                                    setReason(
                                                        event.target.value,
                                                    )
                                                }
                                                disabled={unavailable}
                                            />
                                        </label>
                                        <div className={styles.actions}>
                                            <button
                                                type="submit"
                                                className={styles.button}
                                                disabled={
                                                    unavailable ||
                                                    !reason.trim()
                                                }
                                            >
                                                Record override
                                            </button>
                                        </div>
                                    </form>
                                )}
                            {exceptionAllowed && (
                                <details className={styles.exception}>
                                    <summary>Record purchase exception</summary>
                                    <form
                                        className={styles.form}
                                        onSubmit={(event) => {
                                            event.preventDefault();
                                            if (
                                                parsedUnits &&
                                                unitsValid &&
                                                Number.isFinite(Number(cash)) &&
                                                Number(cash) > 0 &&
                                                reason.trim()
                                            )
                                                void run(() =>
                                                    api.recordSecurityActionExecution(
                                                        action.id,
                                                        note,
                                                        parsedUnits,
                                                        {
                                                            cash_value:
                                                                Number(cash),
                                                            exception_reason:
                                                                reason.trim(),
                                                        },
                                                    ),
                                                );
                                        }}
                                    >
                                        <p className={styles.detail}>
                                            For a purchase already executed
                                            outside the recommendation. This
                                            records evidence; it does not
                                            approve the purchase or bypass
                                            statement checks.
                                        </p>
                                        <label>
                                            Units bought
                                            <input
                                                required
                                                type="number"
                                                min="0"
                                                step="any"
                                                value={units}
                                                onChange={(event) =>
                                                    setUnits(event.target.value)
                                                }
                                                disabled={unavailable}
                                            />
                                        </label>
                                        <label>
                                            AUD spent
                                            <input
                                                required
                                                type="number"
                                                min="0"
                                                step="any"
                                                value={cash}
                                                onChange={(event) =>
                                                    setCash(event.target.value)
                                                }
                                                disabled={unavailable}
                                            />
                                        </label>
                                        <label>
                                            Exception reason
                                            <textarea
                                                required
                                                rows={2}
                                                value={reason}
                                                onChange={(event) =>
                                                    setReason(
                                                        event.target.value,
                                                    )
                                                }
                                                disabled={unavailable}
                                            />
                                        </label>
                                        <div className={styles.actions}>
                                            <button
                                                type="submit"
                                                className={styles.button}
                                                disabled={
                                                    unavailable ||
                                                    !parsedUnits ||
                                                    !unitsValid ||
                                                    !Number.isFinite(
                                                        Number(cash),
                                                    ) ||
                                                    Number(cash) <= 0 ||
                                                    !reason.trim()
                                                }
                                            >
                                                Record exception
                                            </button>
                                        </div>
                                    </form>
                                </details>
                            )}
                        </>
                    )}
                    {error && (
                        <p role="alert" className={styles.error}>
                            {error}
                        </p>
                    )}
                    <footer className={styles.footer}>
                        <button
                            type="button"
                            className={styles.button}
                            disabled={saving}
                            onClick={() => {
                                onClose();
                                openDecisionHistory(selection.ticker);
                            }}
                        >
                            <History />
                            Decision history
                        </button>
                    </footer>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
