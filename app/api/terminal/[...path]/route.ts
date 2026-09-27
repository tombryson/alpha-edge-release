import { checkOwnerOrigin, ownerRequestHeaders, serverAccessMode, tradingServerURL } from '../../../../lib/server-access';
import { demoResponse } from '../../../../lib/demo-data';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };
const MAX_BODY = 16 * 1024 * 1024;

async function proxy(request: Request, context: Context): Promise<Response> {
    try {
        const mode = serverAccessMode();
        if (mode === 'legacy') return Response.json({ error: 'Session gateway not enabled' }, { status: 404 });
        const { path } = await context.params;
        if (path.some(segment => !segment || segment === '.' || segment === '..' || /[\\/%?#]/.test(segment))) return new Response(null, { status: 400 });
        const route = '/' + path.map(encodeURIComponent).join('/');
        if (mode === 'demo') return demoResponse(route, request);
        const query = new URL(request.url).searchParams;
        if (query.has('token') || query.has('secret')) return new Response(null, { status: 403 });
        const denied = checkOwnerOrigin(request);
        if (denied) return denied;
        // Machine-ingress and migration endpoints are never browser operations.
        if (/^\/(webhook\/|migrate\/)/.test(route)) return new Response(null, { status: 403 });
        let body: ArrayBuffer | undefined;
        if (request.body && !['GET', 'HEAD'].includes(request.method)) {
            const reader = request.body.getReader();
            const chunks: Uint8Array[] = []; let size = 0;
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                size += value.length;
                if (size > MAX_BODY) { await reader.cancel(); return new Response(null, { status: 413 }); }
                chunks.push(value);
            }
            const bytes = new Uint8Array(size); let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
            body = bytes.buffer;
        }
        const upstream = await fetch(`${tradingServerURL()}${route}${new URL(request.url).search}`, {
            method: request.method, headers: ownerRequestHeaders(request), body,
            cache: 'no-store', redirect: 'error', signal: route === '/alerts/stream' ? request.signal : AbortSignal.any([request.signal, AbortSignal.timeout(30000)]),
        });
        const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        for (const name of ['content-type', 'retry-after']) {
            const value = upstream.headers.get(name); if (value) headers.set(name, value);
        }
        for (const cookie of upstream.headers.getSetCookie()) headers.append('Set-Cookie', cookie);
        return new Response(upstream.body, { status: upstream.status, headers });
    } catch {
        return Response.json({ error: 'Secure connection unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE, proxy as HEAD };
