export interface PortfolioInvestmentPlay {
    title: string;
    thesis: string;
}

export interface SavedInvestmentPlay extends PortfolioInvestmentPlay {
    id: string;
    version: 1;
    created_at: string;
    updated_at: string;
}

export const INVESTMENT_PLAY_PREFIX = 'portfolio_investment_play:';

export function readInvestmentPlayLibrary(settings: Record<string, unknown>): SavedInvestmentPlay[] {
    return Object.entries(settings).filter(([key, value]) => key.startsWith(INVESTMENT_PLAY_PREFIX) && value !== '')
        .map(([key, value]) => {
            let row: SavedInvestmentPlay;
            try { row = JSON.parse(String(value)); } catch { throw new Error('A saved investment play could not be read. Nothing has been overwritten.'); }
            if (!row || row.version !== 1 || typeof row.id !== 'string' || key !== `${INVESTMENT_PLAY_PREFIX}${row.id}` ||
                typeof row.title !== 'string' || typeof row.thesis !== 'string' ||
                typeof row.created_at !== 'string' || typeof row.updated_at !== 'string') {
                throw new Error('A saved investment play has an unsupported format. Nothing has been overwritten.');
            }
            return row;
        }).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

export function investmentPlaySettings(rows: SavedInvestmentPlay[]): Record<string, string> {
    return Object.fromEntries(rows.map(row => [`${INVESTMENT_PLAY_PREFIX}${row.id}`, JSON.stringify(row)]));
}

// Write only changed records, so saving one play cannot erase another browser's additions.
export function investmentPlayChanges(rows: SavedInvestmentPlay[], saved: Record<string, string>): Record<string, string> {
    const next = investmentPlaySettings(rows);
    return Object.fromEntries([...new Set([...Object.keys(saved), ...Object.keys(next)])]
        .filter(key => (saved[key] || '') !== (next[key] || ''))
        .map(key => [key, next[key] || '']));
}

export function prepareInvestmentPlays(rows: PortfolioInvestmentPlay[]): PortfolioInvestmentPlay[] {
    return rows.flatMap((row, index) => {
        const title = row.title.trim();
        const thesis = row.thesis.trim();
        if (!title && !thesis) return [];
        if (!title || !thesis) {
            throw new Error(`Complete the title and thesis for play ${index + 1}, or remove it.`);
        }
        return [{ title, thesis }];
    });
}
