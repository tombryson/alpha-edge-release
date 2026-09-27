'use client';

import { useEffect, useRef } from 'react';
import { ChartNoAxesCombined, FileSearch, PieChart } from 'lucide-react';
import * as Tabs from '@radix-ui/react-tabs';
import { useContextPanelStore } from '@/lib/context-panel-store';
import { restorePanelView } from '@/lib/context-panel-model';
import { SECURITY_DETAILS_REQUESTED } from '@/lib/security-navigation';
import { ETFMonitor } from '@/components/etf-monitor';
import { SecurityView } from './security-view';
import { ShapeView } from './shape-view';
import styles from './panel.module.css';
import headerStyles from '@/components/shell/sidebar-header.module.css';

export function ContextPanel() {
    const view = useContextPanelStore(state => state.view);
    const setView = useContextPanelStore(state => state.setView);
    const scroll = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const resetScroll = () => scroll.current?.scrollTo(0, 0);
        window.addEventListener(SECURITY_DETAILS_REQUESTED, resetScroll);
        return () => window.removeEventListener(SECURITY_DETAILS_REQUESTED, resetScroll);
    }, []);
    return <Tabs.Root value={view} onValueChange={value => { setView(restorePanelView(value)); scroll.current?.scrollTo(0, 0); }} asChild>
        <aside className={`${styles.panel} panel-border`} aria-label="Portfolio tools" data-testid="context-panel" data-view={view}>
        <header className={`${headerStyles.header} ${styles.workspaceHeader}`}>
            <Tabs.List className={styles.viewTabs} aria-label="Panel view">
                <Tabs.Trigger className={styles.viewTab} value="etf" aria-label="ETFs" title="ETF allocations"><ChartNoAxesCombined strokeWidth={1.75} aria-hidden="true" /></Tabs.Trigger>
                <Tabs.Trigger className={styles.viewTab} value="security" aria-label="Security" title="Security details"><FileSearch strokeWidth={1.75} aria-hidden="true" /></Tabs.Trigger>
                <Tabs.Trigger className={styles.viewTab} value="shape" aria-label="Shape" title="Portfolio shape"><PieChart strokeWidth={1.75} aria-hidden="true" /></Tabs.Trigger>
            </Tabs.List>
        </header>
        <div className={styles.scroll} ref={scroll} data-testid="context-panel-scroll">
            <div className={styles.content}>
                <Tabs.Content value="etf"><ETFMonitor /></Tabs.Content>
                <Tabs.Content value="security"><SecurityView /></Tabs.Content>
                <Tabs.Content value="shape"><ShapeView /></Tabs.Content>
            </div>
        </div>
        </aside>
    </Tabs.Root>;
}
