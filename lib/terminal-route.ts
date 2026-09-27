'use client';

export type TerminalRouteTab =
    | 'POSITIONS'
    | 'PORTFOLIO'
    | 'SYSTEM'
    | 'MARKETS'
    | 'ANALYSIS'
    | 'HISTORY'
    | 'ALERTS'
    | 'ETF'
    | 'NEWS'
    | 'HELP';

export type TerminalRoute = {
    tab: TerminalRouteTab;
    marketCode?: string;
    helpSection?: string;
};

export const TERMINAL_TAB_REQUEST_EVENT = 'alpha-edge:terminal-tab-request';

export type TerminalTabRequestDetail = {
    tab: TerminalRouteTab;
};

export function requestTerminalTab(tab: TerminalRouteTab): void {
    const handled = !window.dispatchEvent(
        new CustomEvent<TerminalTabRequestDetail>(TERMINAL_TAB_REQUEST_EVENT, {
            detail: { tab },
            cancelable: true,
        }),
    );
    if (!handled) {
        window.location.hash = terminalRouteHash({ tab });
    }
}

const routeStateKey = 'alpha-edge-terminal-route';

const terminalTabs = new Set<TerminalRouteTab>([
    'POSITIONS',
    'PORTFOLIO',
    'SYSTEM',
    'MARKETS',
    'ANALYSIS',
    'HISTORY',
    'ALERTS',
    'ETF',
    'NEWS',
    'HELP',
]);

export function normalizeTerminalRouteTab(value: unknown): TerminalRouteTab | null {
    if (typeof value !== 'string') return null;
    const tab = value.toUpperCase();
    if (tab === 'PORTFOLIO2' || tab === 'EXPOSURE') return 'PORTFOLIO';
    return terminalTabs.has(tab as TerminalRouteTab)
        ? tab as TerminalRouteTab
        : null;
}

function routeState(route: TerminalRoute): Record<string, TerminalRoute> {
    return { [routeStateKey]: route };
}

function currentHistoryState(): Record<string, unknown> {
    const state = window.history.state;
    return state && typeof state === 'object' ? state as Record<string, unknown> : {};
}

export function terminalRouteHash(route: TerminalRoute): string {
    const tab = route.tab.toLowerCase();
    if (route.tab === 'MARKETS' && route.marketCode) {
        return `#/${tab}/${encodeURIComponent(route.marketCode)}`;
    }
    if (route.tab === 'HELP' && route.helpSection) {
        return `#/${tab}/${encodeURIComponent(route.helpSection.toLowerCase())}`;
    }
    return `#/${tab}`;
}

export function readTerminalRoute(hash = window.location.hash): TerminalRoute | null {
    const match = /^#\/?([a-z0-9]+)(?:\/([A-Za-z0-9_-]+))?$/i.exec(hash);
    if (!match) return null;

    const tab = normalizeTerminalRouteTab(match[1]);
    if (!tab) return null;
    const childRoute = match[2] ? decodeURIComponent(match[2]) : undefined;

    return {
        tab,
        marketCode: tab === 'MARKETS' && match[2]
            ? childRoute?.toUpperCase()
            : undefined,
        helpSection: tab === 'HELP' ? childRoute?.toLowerCase() : undefined,
    };
}

export function currentTerminalRouteState(): TerminalRoute | null {
    const route = currentHistoryState()[routeStateKey];
    if (!route || typeof route !== 'object') return null;
    const candidate = route as Partial<TerminalRoute>;
    const tab = normalizeTerminalRouteTab(candidate.tab);
    if (!tab) return null;
    return { ...candidate, tab } as TerminalRoute;
}

export function pushTerminalRoute(route: TerminalRoute): boolean {
    const hash = terminalRouteHash(route);
    if (window.location.hash === hash) return false;
    window.history.pushState(
        { ...currentHistoryState(), ...routeState(route) },
        '',
        hash,
    );
    return true;
}

export function replaceTerminalRoute(route: TerminalRoute): void {
    window.history.replaceState(
        { ...currentHistoryState(), ...routeState(route) },
        '',
        terminalRouteHash(route),
    );
}
