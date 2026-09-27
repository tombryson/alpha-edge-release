import type { TerminalRouteTab } from './terminal-route';

export const OPEN_WELCOME_GUIDE = 'alpha-edge:open-welcome-guide';
export const WELCOME_GUIDE_STORAGE_KEY = 'alpha-edge:welcome-guide:v1';

export const WELCOME_STEPS: ReadonlyArray<{
    tab: TerminalRouteTab;
    label: string;
    title: string;
    body: string;
    reminder: string;
}> = [
    {
        tab: 'PORTFOLIO', label: 'Portfolio', title: 'Start with constructing your portfolio',
        body: 'Your approved shape is the plan: how much of the portfolio belongs in each asset class. Compare it with current holdings to see where the two differ.',
        reminder: 'An approval sets the plan. It does not place trades.',
    },
    {
        tab: 'ANALYSIS', label: 'Analysis', title: 'Build the evidence for each investment',
        body: 'Explore holdings and watchlist securities, open their research, and review the sources behind their scores. Ideal wt is a model suggestion, not an approved allocation.',
        reminder: 'Missing research is missing evidence, not a zero score.',
    },
    {
        tab: 'POSITIONS', label: 'Positions', title: 'See what you actually own',
        body: 'Positions brings together broker holdings, class weights and current signals. Open a security for more context; use Actions to review the work that needs a response.',
        reminder: 'Record a trade only after you have placed it at your broker.',
    },
    {
        tab: 'ALERTS', label: 'Alerts', title: 'Connect the information you rely on',
        body: 'Check TradingView connections and announcement subscriptions here. ASX securities default to HotCopper; other known exchanges default to Seeking Alpha.',
        reminder: 'Set up subscriptions with the provider before confirming them here.',
    },
    {
        tab: 'MARKETS', label: 'Markets', title: 'Read the market context',
        body: 'Commodity trend, producer-equity strength and company outperformance describe different evidence. A bullish market signal alone is not an instruction to buy.',
        reminder: 'Physical commodity Sell does not itself request producer-equity cuts.',
    },
    {
        tab: 'SYSTEM', label: 'System', title: 'Understand what is permitted now',
        body: 'Follow the decision flow from portfolio risk to individual position signals. Q3, Q4, available cash and class capacity can limit an otherwise valid purchase.',
        reminder: 'The asset-class index explains where each class sits in the risk framework.',
    },
    {
        tab: 'HISTORY', label: 'History', title: 'Close the loop with evidence',
        body: 'Review performance, approved shapes and recorded decisions over time. A later broker statement confirms an execution; recording a sale does not immediately release cash.',
        reminder: 'Help keeps the detailed rules and this tour in one place.',
    },
];

export function openWelcomeGuide() {
    window.dispatchEvent(new Event(OPEN_WELCOME_GUIDE));
}
