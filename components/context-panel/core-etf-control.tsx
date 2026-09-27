'use client';

import { useMemo, useState, type ReactElement } from 'react';
import * as Popover from '@radix-ui/react-popover';
import * as RadioGroup from '@radix-ui/react-radio-group';
import { Check, ChevronDown } from 'lucide-react';
import { api, type ETFAllocationCandidate, type ETFAllocationLedgerRow } from '@/lib/api';
import { formatCoreRatio } from '@/lib/etf-core-ratio';
import { usePanelData } from './panel-data';
import { ETFManagementControl } from './etf-management-control';
import styles from './panel.module.css';
import menuStyles from './core-etf-control.module.css';

type Fund = ETFAllocationLedgerRow | ETFAllocationCandidate;

export function CoreETFControl({ fund, trigger }: { fund: Fund; trigger?: ReactElement }) {
    const { ledger, errors, acceptLedger } = usePanelData();
    const [open, setOpen] = useState(false);
    const [ratio, setRatio] = useState(25);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
    // Viewport coordinates must not inherit the sidebar's transformed container.
    const pointAnchor = useMemo(() => ({ current: { getBoundingClientRect: () => new DOMRect(point?.x || 0, point?.y || 0, 1, 1) } }), [point]);
    const isCore = 'is_core' in fund && fund.is_core;
    const existing = ledger?.classes?.find(row => row.asset_class === fund.asset_class)?.core_ticker;
    const invalidClass = !fund.asset_class || fund.asset_class === 'UNASSIGNED' || ('asset_class_unassignable' in fund && fund.asset_class_unassignable);
    const save = async (selected: boolean) => {
        if (saving) return;
        setSaving(true); setError('');
        try {
            acceptLedger(await api.updateETFCorePolicy(fund.asset_class, selected ? { core_ticker: fund.ticker, core_ratio_pct: ratio } : { core_ticker: '' }));
            setOpen(false);
        } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to save Core policy'); }
        finally { setSaving(false); }
    };
    return <Popover.Root open={open} onOpenChange={next => {
        if (saving) return;
        if (next) { setError(''); setRatio('core_ratio_pct' in fund ? fund.core_ratio_pct : ledger?.policy.default_core_ratio_pct || 25); }
        setOpen(next);
    }}>
        <Popover.Trigger asChild onClickCapture={event => setPoint(event.detail > 0 ? { x: event.clientX, y: event.clientY } : null)}>
            {trigger || <button type="button" className={styles.coreTrigger} aria-label={`Configure Core ETF ${fund.ticker}`} title={`Core allocation for ${fund.ticker}`} onClick={event => event.stopPropagation()}>
                {isCore && 'core_ratio_pct' in fund ? formatCoreRatio(fund.core_ratio_pct) : 'Set Core'}<ChevronDown aria-hidden="true" />
            </button>}
        </Popover.Trigger>
        {point && <Popover.Anchor virtualRef={pointAnchor} />}
        <Popover.Portal>
            <Popover.Content className={menuStyles.editor} sideOffset={6} collisionPadding={12} align="start" aria-label={`Core allocation for ${fund.ticker}`} onClick={event => event.stopPropagation()}>
                <div className={menuStyles.grid}>
                    <RadioGroup.Root className={menuStyles.ratios} orientation="vertical" aria-label="Core share of asset class" value={String(ratio)} onValueChange={value => setRatio(Number(value))} disabled={saving}>
                        {[...new Set([25, 50, 100, ratio])].sort((a, b) => a - b).map(value => <RadioGroup.Item key={value} value={String(value)}><span className={menuStyles.check}>{ratio === value && <Check aria-hidden="true" />}</span>{formatCoreRatio(value)}</RadioGroup.Item>)}
                    </RadioGroup.Root>
                    <div className={menuStyles.roles}>
                        <button type="button" aria-pressed={isCore} disabled={saving || invalidClass || Boolean(errors.ledger)} onClick={() => void save(true)}>Core</button>
                        <button type="button" aria-pressed={!isCore} disabled={saving || Boolean(errors.ledger)} onClick={() => isCore ? void save(false) : setOpen(false)}>Non-Core</button>
                    </div>
                </div>
                {!isCore && existing && <p className={styles.meta}>Replaces {existing} in {fund.asset_class_name}.</p>}
                <div className={menuStyles.management}><span>Management</span><ETFManagementControl ticker={fund.ticker} /></div>
                {invalidClass && <p className={styles.notice}>Assign an asset class in Analysis first.</p>}
                {errors.ledger && <p role="alert" className={styles.notice}>Refresh allocation data before saving.</p>}
                {error && <p role="alert" className={`${styles.notice} ${styles.error}`}>{error}</p>}
            </Popover.Content>
        </Popover.Portal>
    </Popover.Root>;
}
