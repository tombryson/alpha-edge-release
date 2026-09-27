'use client';

import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import * as Tooltip from '@radix-ui/react-tooltip';
import { ChevronDown, CircleHelp } from 'lucide-react';
import { api, type ETFManagementMode } from '@/lib/api';
import { managementTicker, useETFManagement } from '@/lib/etf-management-store';
import { useStore } from '@/lib/store';
import { requestTerminalTab } from '@/lib/terminal-route';
import { usePanelData } from './panel-data';
import styles from './panel.module.css';
import controlStyles from './etf-management.module.css';

const managementHints: Record<ETFManagementMode, string> = {
    tms: 'This script prioritises partial trims and stop-loss management over immediate full exits. It can retain exposure and defer realising gains, but may tolerate deeper drawdowns.',
    etf_tms: 'This script prioritises a full exit on a sell signal. It suits tactical holdings where reducing exposure takes priority over staying invested; profitable exits realise gains.',
};

export function ETFManagementControl({ ticker }: { ticker: string }) {
    const { modes, ready, error: loadError, accept } = useETFManagement();
    const current = modes[managementTicker(ticker)] || 'etf_tms';
    const { refresh } = usePanelData();
    const [open, setOpen] = useState(false);
    const [hintOpen, setHintOpen] = useState(false);
    const [mode, setMode] = useState<ETFManagementMode>(current);
    const [direction, setDirection] = useState<'BUY' | 'SELL' | ''>('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);
    const save = async () => {
        if (!direction || !ready || saving || current === mode) return;
        setSaving(true); setError('');
        try {
            accept(await api.updateETFManagement(ticker, { mode, previous_mode: current, initial_state: direction }));
            await Promise.all([useStore.getState().fetchActiveAlerts(), useStore.getState().fetchAlerts(), refresh()]);
            setSaved(true);
        } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to change management'); }
        finally { setSaving(false); }
    };
    return <Popover.Root open={open} onOpenChange={next => {
        if (saving) return;
        setHintOpen(false);
        if (next) { setMode(current); setDirection(''); setError(''); setSaved(false); }
        setOpen(next);
    }}>
        <Tooltip.Provider delayDuration={600}>
            <Tooltip.Root open={hintOpen && !open} onOpenChange={next => setHintOpen(next && !open)}>
                <Tooltip.Trigger asChild>
                    <Popover.Trigger asChild><button type="button" className={styles.coreTrigger} aria-label={`Management mode for ${ticker}`}>{ready ? current === 'tms' ? 'TMS' : 'ETF' : '...'}<ChevronDown aria-hidden="true" /></button></Popover.Trigger>
                </Tooltip.Trigger>
                <Tooltip.Portal><Tooltip.Content className={controlStyles.hint} side="top" sideOffset={6} collisionPadding={12}>
                    {ready ? managementHints[current] : loadError || 'Loading management mode'}
                </Tooltip.Content></Tooltip.Portal>
            </Tooltip.Root>
        </Tooltip.Provider>
        <Popover.Portal><Popover.Content className={`${styles.editor} ${controlStyles.editor}`} sideOffset={6} collisionPadding={12} align="start" aria-label={`Management for ${ticker}`} onClick={event => event.stopPropagation()}>
            <fieldset disabled={saving || !ready || saved}>
                <legend>Management</legend>
                <Tooltip.Provider delayDuration={250}>
                    <div className={controlStyles.options}>{(['etf_tms', 'tms'] as const).map(value => (
                        <div key={value} className={controlStyles.option}>
                            <label><input type="radio" name={`mode-${ticker}`} aria-description={managementHints[value]} checked={mode === value} onChange={() => { setMode(value); setDirection(''); }} />{value === 'tms' ? 'TMS' : 'ETF'}</label>
                            <Tooltip.Root>
                                <Tooltip.Trigger asChild>
                                    <button type="button" className={controlStyles.hintTrigger} aria-label={`About ${value === 'tms' ? 'TMS' : 'ETF'} management`}>
                                        <CircleHelp size={13} aria-hidden="true" />
                                    </button>
                                </Tooltip.Trigger>
                                <Tooltip.Portal><Tooltip.Content className={controlStyles.hint} side="top" sideOffset={6} collisionPadding={12}>
                                    {managementHints[value]}
                                </Tooltip.Content></Tooltip.Portal>
                            </Tooltip.Root>
                        </div>
                    ))}</div>
                </Tooltip.Provider>
            </fieldset>
            {mode !== current && <fieldset disabled={saving || !ready}>
                <legend>Current direction</legend>
                <div className={controlStyles.options}>{(['BUY', 'SELL'] as const).map(value => <label key={value}><input type="radio" name={`direction-${ticker}`} checked={direction === value} onChange={() => setDirection(value)} />{value === 'BUY' ? 'Buy' : 'Sell'}</label>)}</div>
                <p>Reconnect in Alerts after switching. Unexecuted old-script actions will be retired; recorded trades remain in history.</p>
            </fieldset>}
            {(error || loadError) && <p role="alert" className={styles.error}>{error || loadError}</p>}
            {saved ? <><p role="status">Mode saved. Confirm the new connections in Alerts.</p><button type="button" className={styles.command} onClick={() => { setOpen(false); requestTerminalTab('ALERTS'); }}>Open Alerts</button></> : <button type="button" className={styles.command} disabled={saving || !ready || !direction || mode === current} onClick={() => void save()}>{saving ? 'Saving...' : 'Save mode'}</button>}
        </Popover.Content></Popover.Portal>
    </Popover.Root>;
}
