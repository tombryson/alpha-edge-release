export type AnnouncementProvider = 'HOTCOPPER' | 'SEEKING_ALPHA';
export type AnnouncementSubscription = {
    kind: 'holding' | 'analysis';
    id: number;
    security_id: number;
    name: string;
    ticker: string;
    exchange_prefix: string;
    provider: AnnouncementProvider | '';
    configured: boolean;
    confirmed_at?: string;
    needs_recheck: boolean;
};
export type AnnouncementSetupUpdate = Pick<AnnouncementSubscription, 'kind' | 'id' | 'ticker' | 'exchange_prefix'> & {
    provider: AnnouncementProvider;
    configured: boolean;
};
export const announcementKey = (row: AnnouncementSubscription) => `${row.kind}:${row.id}`;
export function suggestedAnnouncementProvider(row: AnnouncementSubscription): AnnouncementProvider | '' {
    if (row.provider && !row.needs_recheck) return row.provider;
    const exchange = row.exchange_prefix.trim().toUpperCase().replace(/:$/, '');
    if (!exchange) return '';
    return /^(ASX|ASX_DLY)$/.test(exchange) ? 'HOTCOPPER' : 'SEEKING_ALPHA';
}
export const announcementProviders = {
    HOTCOPPER: { label: 'HotCopper', url: 'https://hotcopper.com.au/watchlist/' },
    SEEKING_ALPHA: { label: 'Seeking Alpha', url: 'https://seekingalpha.com/account/portfolio' },
} as const;
