'use client';

import { useStore } from '@/lib/store';
import { managementTicker, useETFManagement } from '@/lib/etf-management-store';
import { canonicalAlertScript, connectionTickersMatch, monitoringCoverage } from '@/lib/monitoring-coverage';

interface AlertStatusIndicatorProps {
    ticker: string;
    mode: 'position' | 'analysis' | 'regime';
    className?: string;
    securityType?: string | null;
    outperformBenchmark?: string | null;
}

const ovalStyle = {
    width: 'calc(var(--spacing) * 2)',
    height: 'calc(var(--spacing) * 6)',
    borderRadius: '30%',
};

export function AlertStatusIndicator({ ticker, mode, className = '', securityType, outperformBenchmark }: AlertStatusIndicatorProps) {
    const activeAlerts = useStore(state => state.activeAlerts);
    const connectionsReady = useStore(state => state.activeAlertsReady);
    const managementMode = useETFManagement(state => state.modes[managementTicker(ticker)] || 'etf_tms');
    const managementReady = useETFManagement(state => state.ready);
    const coverage = monitoringCoverage({
        ticker, securityType, connections: activeAlerts, connectionsReady,
        managementMode, managementReady, outperformBenchmark,
    });
    let title = coverage.title;
    let color = {
        full: 'bg-green-500',
        partial: mode === 'analysis' ? 'bg-yellow-500' : 'bg-orange-500',
        none: 'bg-red-500',
        unavailable: 'bg-gray-500',
    }[coverage.state];

    if (mode === 'regime' && connectionsReady) {
        const connected = activeAlerts.some(alert => connectionTickersMatch(alert.ticker, ticker) &&
            ['q4d', 'ctf'].includes(canonicalAlertScript(alert.script)));
        title = connected ? 'Regime alert active' : 'Regime alert inactive';
        color = connected ? 'bg-green-500' : 'bg-red-500';
    }

    return (
        <div className={`inline-flex items-center justify-center ${className}`} title={title}>
            <div className={color} style={ovalStyle} />
        </div>
    );
}
