import { useState, type Dispatch, type SetStateAction } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { SecurityPerformanceChart, type SecurityChartEvent } from '@/components/security-performance-chart';
import type { SecurityPerformancePoint } from '@/lib/api';
import { audFormatter } from './formatters';
import { HISTORY_METRIC_TILE_CLASS, HISTORY_PANEL_CLASS } from './history';
import { HistoryRangeControl } from './history-controls';
import type { HistoryPerformanceRange } from './types';
import styles from './history-workspace.module.css';

type HistoryStockOption = { id: number; symbol: string; name: string };
type HistoryStockPanelProps = {
    historySelectedTicker: string;
    historySelectedStockName: string;
    setHistorySelectedTicker: Dispatch<SetStateAction<string>>;
    setHistorySelectedStockName: Dispatch<SetStateAction<string>>;
    historyStockOptions: HistoryStockOption[];
    historyPerformanceRange: HistoryPerformanceRange;
    setHistoryPerformanceRange: Dispatch<SetStateAction<HistoryPerformanceRange>>;
    historySecurityLoading: boolean;
    historySecurityError: string | null;
    selectedSecurityChartPointCount: number;
    selectedSecurityLatest: SecurityPerformancePoint | null;
    selectedSecurityPriceChange: number;
    selectedSecurityPriceChangePct: number;
    historyStockShowValue: boolean;
    setHistoryStockShowValue: Dispatch<SetStateAction<boolean>>;
    selectedSecurityValueChange: number;
    selectedSecurityValueChangePct: number;
    filteredSecurityPerformance: SecurityPerformancePoint[];
    selectedSecurityEvents: SecurityChartEvent[];
};

export function HistoryStockPanel({ historySelectedTicker, historySelectedStockName,
    setHistorySelectedTicker, setHistorySelectedStockName, historyStockOptions,
    historyPerformanceRange, setHistoryPerformanceRange, historySecurityLoading,
    historySecurityError, selectedSecurityChartPointCount, selectedSecurityLatest,
    selectedSecurityPriceChange, selectedSecurityPriceChangePct, historyStockShowValue,
    setHistoryStockShowValue, selectedSecurityValueChange, selectedSecurityValueChangePct,
    filteredSecurityPerformance, selectedSecurityEvents }: HistoryStockPanelProps) {
    const [pickerOpen, setPickerOpen] = useState(false);
    const emptyMessage = !historySelectedTicker ? 'Select a security to inspect its statement history.'
        : historySecurityLoading ? 'Loading stock history...'
        : historySecurityError || (selectedSecurityChartPointCount === 0 ? 'No statement snapshots for this stock.' : '');

    return <section className={HISTORY_PANEL_CLASS} aria-label="Stock history">
        <div className={styles.header}>
            <div className={styles.stockIdentity}>
                <h2>{historySelectedStockName || historySelectedTicker || 'Stock history'}</h2>
                {historySelectedTicker && <div className={styles.secondary}>{historySelectedTicker}</div>}
            </div>
            <div className={styles.controls}>
                <Popover.Root open={pickerOpen} onOpenChange={setPickerOpen}>
                    <Popover.Trigger asChild><button type="button" className={styles.button} aria-label="Select security">
                        <Search aria-hidden="true" />Security<ChevronsUpDown aria-hidden="true" />
                    </button></Popover.Trigger>
                    <Popover.Portal><Popover.Content className={styles.picker} align="end" sideOffset={6} collisionPadding={12} aria-label="Select security">
                        <Command label="Search securities">
                            <div className={styles.search}><Search aria-hidden="true" />
                                <Command.Input aria-label="Search securities" placeholder="Search name or ticker" />
                            </div>
                            <Command.List>
                                <Command.Empty>No matching securities.</Command.Empty>
                                {historyStockOptions.map(stock => <Command.Item key={stock.id}
                                    value={String(stock.id)} keywords={[stock.symbol, stock.name]} onSelect={() => {
                                        setHistorySelectedTicker(stock.symbol);
                                        setHistorySelectedStockName(stock.name || stock.symbol);
                                        setPickerOpen(false);
                                    }}>
                                    <div><strong>{stock.name || stock.symbol}</strong><span>{stock.symbol}</span></div>
                                    {stock.symbol === historySelectedTicker && <Check aria-hidden="true" />}
                                </Command.Item>)}
                            </Command.List>
                        </Command>
                    </Popover.Content></Popover.Portal>
                </Popover.Root>
                <HistoryRangeControl value={historyPerformanceRange} onChange={setHistoryPerformanceRange} />
            </div>
        </div>
        {emptyMessage ? <p className={styles.empty} role={historySecurityError ? 'alert' : 'status'}>{emptyMessage}</p> : <>
            <div className={`${styles.metrics} ${styles.stockMetrics}`}>
                <div className={HISTORY_METRIC_TILE_CLASS}><div>Price</div><div>{selectedSecurityLatest ? `$${selectedSecurityLatest.price.toFixed(3)}` : '-'}</div></div>
                <div className={HISTORY_METRIC_TILE_CLASS}><div>Price change</div>
                    <div style={{ color: selectedSecurityPriceChange >= 0 ? 'var(--success)' : 'var(--destructive)' }}>{selectedSecurityPriceChange >= 0 ? '+' : ''}{selectedSecurityPriceChangePct.toFixed(1)}%</div>
                </div>
                <div className={HISTORY_METRIC_TILE_CLASS}><div>Holding value</div>
                    <div>{selectedSecurityLatest ? audFormatter.format(selectedSecurityLatest.market_value_aud) : '-'}</div>
                    <span className={styles.secondary} style={{ color: selectedSecurityValueChange >= 0 ? 'var(--success)' : 'var(--destructive)' }}>
                        {audFormatter.format(selectedSecurityValueChange)} ({selectedSecurityValueChangePct.toFixed(1)}%)
                    </span>
                </div>
            </div>
            <div className={styles.header}>
                <div className={styles.legend} aria-label="Stock chart series">
                    <span><i style={{ borderColor: 'var(--warning)' }} />Price{historyStockShowValue ? ' (right)' : ''}</span>
                    {historyStockShowValue && <span><i style={{ borderColor: 'var(--info)' }} />Holding value (left)</span>}
                </div>
                <button type="button" className={styles.button} aria-pressed={historyStockShowValue}
                    onClick={() => setHistoryStockShowValue(value => !value)}>{historyStockShowValue ? 'Hide value' : 'Show value'}</button>
            </div>
            <div className={styles.stockPlot}>
                <SecurityPerformanceChart points={filteredSecurityPerformance} events={selectedSecurityEvents} showValue={historyStockShowValue} />
            </div>
        </>}
    </section>;
}
