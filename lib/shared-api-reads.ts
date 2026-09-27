// Only small, repeatedly read Terminal projections are coalesced. No response
// cache: once the HTTP request finishes, the next caller obtains a fresh read.
const paths = new Set([
    '/alerts', '/alerts/active', '/positions', '/portfolio', '/statements/latest',
    '/security-actions', '/etf/allocation-ledger', '/etf/momentum', '/etf/management',
    '/portfolio-mix/current', '/portfolio-mix/approved', '/portfolio-overlay-summary',
    '/portfolio-overlay/reconciliation', '/commodity-themes', '/regimes/status',
    '/regimes', '/regimes/returns', '/sync/changes', '/regime/proposed-actions', '/etf/rebalance',
]);

export function createSharedAPIReads() {
    const pending = new Map<string, Promise<Response>>();
    return {
        invalidate: () => pending.clear(),
        fetch(input: RequestInfo | URL, init: RequestInit, loader: (signal?: AbortSignal) => Promise<Response>, apiBase: string): Promise<Response> {
            const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
            if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
                pending.clear();
                return Promise.resolve().then(() => loader()).finally(() => pending.clear());
            }
            // Requests with independent cancellation retain their own transport.
            if (method !== 'GET' || init.signal || input instanceof Request) return loader();
            const origin = typeof location === 'undefined' ? 'http://localhost' : location.origin;
            const url = new URL(String(input), origin);
            const base = new URL(apiBase, origin);
            const prefix = base.pathname.replace(/\/$/, '');
            if (url.origin !== base.origin || !url.pathname.startsWith(prefix + '/') || !paths.has(url.pathname.slice(prefix.length))) return loader();
            const key = JSON.stringify([url.href, { ...init, headers: [...new Headers(init.headers)] }]);
            let request = pending.get(key);
            if (!request) {
                request = Promise.resolve().then(() => loader(AbortSignal.timeout(30000))).finally(() => { if (pending.get(key) === request) pending.delete(key); });
                pending.set(key, request);
            }
            return request.then(response => response.clone());
        },
    };
}
