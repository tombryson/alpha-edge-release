'use client';

import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { Archive, X } from 'lucide-react';
import styles from './non-allocating-instrument-dialog.module.css';

type NonAllocatingInstrumentDialogProps = {
    open: boolean;
    name: string;
    ticker?: string | null;
    positionValue: number;
    onCancel: () => void;
    onConfirm: () => void;
};

const formatBrokerValue = (value: number) =>
    `$${Math.round(Math.abs(value || 0)).toLocaleString()}`;

export function NonAllocatingInstrumentDialog({
    open,
    name,
    ticker,
    positionValue,
    onCancel,
    onConfirm,
}: NonAllocatingInstrumentDialogProps) {
    return (
        <AlertDialog.Root
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen) onCancel();
            }}
        >
            <AlertDialog.Portal>
                <AlertDialog.Overlay className={styles.overlay} />
                <AlertDialog.Content className={styles.dialog}>
                    <header className={styles.header}>
                        <AlertDialog.Title className={styles.title}>
                            <Archive size={16} aria-hidden="true" />
                            Exclude from strategy
                        </AlertDialog.Title>
                        <AlertDialog.Cancel asChild>
                            <button
                                type="button"
                                className={styles.close}
                                aria-label="Cancel exclusion"
                                title="Close"
                            >
                                <X size={16} aria-hidden="true" />
                            </button>
                        </AlertDialog.Cancel>
                    </header>

                    <div className={styles.body}>
                        <div className={styles.security}>
                            <div className={styles.identity}>
                                <div className={styles.name}>
                                    {name}
                                </div>
                                {ticker && (
                                    <div className={styles.ticker}>
                                        {ticker}
                                    </div>
                                )}
                            </div>
                            <dl className={styles.value}>
                                <dt>
                                    Broker value
                                </dt>
                                <dd>
                                    {formatBrokerValue(positionValue)}
                                </dd>
                            </dl>
                        </div>

                        <AlertDialog.Description className={styles.description}>
                            Remove from allocations, rankings and strategy views.
                            <span>Broker holdings, account value and statement history stay unchanged.</span>
                        </AlertDialog.Description>
                    </div>

                    <footer className={styles.footer}>
                        <AlertDialog.Cancel asChild>
                            <button
                                type="button"
                                className={styles.cancel}
                            >
                                Cancel
                            </button>
                        </AlertDialog.Cancel>
                        <AlertDialog.Action asChild>
                            <button
                                type="button"
                                onClick={onConfirm}
                                className={styles.confirm}
                            >
                                <Archive size={14} aria-hidden="true" />
                                Exclude
                            </button>
                        </AlertDialog.Action>
                    </footer>
                </AlertDialog.Content>
            </AlertDialog.Portal>
        </AlertDialog.Root>
    );
}
