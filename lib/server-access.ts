import type { AccessMode } from './access-mode';

export function serverAccessMode(): AccessMode {
    const mode = process.env.APP_ACCESS_MODE || 'legacy';
    if (!['legacy', 'owner', 'demo'].includes(mode)) throw new Error('Invalid APP_ACCESS_MODE');
    if (mode === 'demo') {
        for (const name of ['TRADING_BACKEND_API_URL', 'COUNCIL_API_TOKEN', 'LLM_COUNCIL_API_URL', 'NEXT_PUBLIC_LLM_COUNCIL_API_URL', 'NEXT_PUBLIC_API_TOKEN', 'API_TOKEN', 'WEBHOOK_SECRET', 'PARALLEL_API_KEY', 'XAI_API_KEY', 'OPENAI_API_KEY', 'PERPLEXITY_API_KEY', 'GEMINI_API_KEY', 'ALPHA_EDGE_DEV_API_PROXY_URL']) {
            if (process.env[name]) throw new Error(`Public demo must not be configured with ${name}`);
        }
    }
    if (mode === 'owner') { ownerOrigin(); tradingServerURL(); }
    return mode as AccessMode;
}

export function ownerOrigin(): string {
    const raw = process.env.APP_ORIGIN || '';
    const url = new URL(raw);
    const local = url.hostname === 'localhost';
    if (raw !== url.origin || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) throw new Error('APP_ORIGIN must be an HTTPS origin (or loopback development)');
    return raw;
}

export function tradingServerURL(): string {
    const raw = process.env.TRADING_BACKEND_API_URL || '';
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid TRADING_BACKEND_API_URL');
    return raw.replace(/\/+$/, '');
}

export function ownerRequestHeaders(request: Request): Headers {
    const headers = new Headers();
    const secure = ownerOrigin().startsWith('https:');
    const prefix = secure ? '__Host-alpha-edge-' : 'alpha-edge-local-';
    const cookies = (request.headers.get('cookie') || '').split(';').map(c => c.trim()).filter(c =>
        ['session', 'challenge'].some(name => c.startsWith(`${prefix}${name}=`)),
    );
    if (cookies.length) headers.set('Cookie', cookies.join('; '));
    for (const name of ['content-type', 'x-csrf-token', 'origin']) {
        const value = request.headers.get(name);
        if (value) headers.set(name, value);
    }
    return headers;
}

export function checkOwnerOrigin(request: Request): Response | null {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.get('origin') !== ownerOrigin()) {
        return Response.json({ error: 'Request origin rejected' }, { status: 403 });
    }
    return null;
}
