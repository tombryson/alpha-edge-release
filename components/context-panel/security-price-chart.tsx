'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, RotateCw } from 'lucide-react';
import { mountTradingViewEmbed } from '@/lib/tradingview-embed';
import { getAccessMode } from '@/lib/access-mode';
import styles from './security-view.module.css';

export function SecurityPriceChart({ ticker }: { ticker: string }) {
    const hostRef = useRef<HTMLDivElement>(null);
    const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
    const [attempt, setAttempt] = useState(0);
    const symbol = ticker.trim().toUpperCase();
    const demo = getAccessMode() === 'demo';
    const hasExchange = !demo && /^[A-Z0-9_]+:[^:\s]+$/.test(symbol);
    const chartUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;

    useEffect(() => {
        const host = hostRef.current;
        if (!host || !hasExchange) return;
        const root = document.documentElement;
        let previousAppearance = '';
        let disposeWidget = () => {};

        const mount = () => {
            const theme = root.classList.contains('light') ? 'light' : 'dark';
            // Convert theme tokens (including OKLCH) to RGB for the provider.
            const context = document.createElement('canvas').getContext('2d');
            let background = theme === 'light' ? '#ffffff' : '#12151a';
            if (context) {
                context.fillStyle = getComputedStyle(host).backgroundColor;
                context.fillRect(0, 0, 1, 1);
                const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
                background = `rgb(${r}, ${g}, ${b})`;
            }
            const appearance = `${theme}:${background}`;
            if (appearance === previousAppearance) return;
            previousAppearance = appearance;
            disposeWidget();
            setStatus('loading');

            const timeout = window.setTimeout(() => setStatus('error'), 20000);
            const removeEmbed = mountTradingViewEmbed(host, {
                autosize: true, symbol, interval: 'D', range: '6M',
                overrides: {
                    'mainSeriesProperties.priceAxisProperties.autoScale': true,
                    'mainSeriesProperties.priceAxisProperties.lockScale': false,
                },
                timezone: 'Etc/UTC', theme, backgroundColor: background,
                gridColor: theme === 'light' ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.06)',
                style: '1', locale: 'en', hide_top_toolbar: true, hide_side_toolbar: true,
                hide_legend: true, hide_volume: true, save_image: false,
                allow_symbol_change: false, withdateranges: false,
                calendar: false, details: false, hotlist: false, studies: [],
                support_host: 'https://www.tradingview.com',
            }, {
                title: `${symbol} price chart by TradingView`,
                onLoad: () => {
                    window.clearTimeout(timeout);
                    setStatus('loaded');
                },
                onError: () => {
                    window.clearTimeout(timeout);
                    setStatus('error');
                },
            });
            disposeWidget = () => {
                window.clearTimeout(timeout);
                removeEmbed();
            };
        };

        mount();
        const themeObserver = new MutationObserver(mount);
        themeObserver.observe(root, { attributes: true, attributeFilter: ['data-theme', 'class'] });
        return () => { themeObserver.disconnect(); disposeWidget(); };
    }, [symbol, hasExchange, attempt]);

    return <section className={styles.section} aria-label="Price chart">
        <div className={styles.sectionHeading}>
            <h3>Price chart</h3>
            {hasExchange && <a className={styles.iconCommand} href={chartUrl} target="_blank" rel="noreferrer" title="Open in TradingView" aria-label={`Open ${symbol} in TradingView`}><ArrowUpRight aria-hidden="true" /></a>}
        </div>
        {hasExchange ? <>
            <div className={styles.chartFrame} data-testid="security-price-chart" data-symbol={symbol}>
                <div ref={hostRef} className={styles.chartHost} />
                {status !== 'loaded' && <div className={styles.chartStatus} role="status">
                    <p>{status === 'error' ? 'TradingView could not be loaded.' : 'Loading chart...'}</p>
                    {status === 'error' && <button type="button" className={styles.command} onClick={() => setAttempt(value => value + 1)}><RotateCw aria-hidden="true" />Retry chart</button>}
                </div>}
            </div>
            <a className={styles.chartSource} href={chartUrl} target="_blank" rel="noreferrer">TradingView</a>
        </> : <p className={styles.meta}>{demo ? 'Live charts are disabled in this demo.' : 'Chart unavailable: no exchange-qualified ticker.'}</p>}
    </section>;
}
