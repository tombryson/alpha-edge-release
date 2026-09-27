const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { NextRequest } = require('next/server');
const root = '/tmp/alpha-edge-council-tests';
const { authorizeCouncilRequest, fetchCouncilJson } = require(`${root}/app/api/council/_lib.js`);
const jobs = require(`${root}/app/api/council/jobs/route.js`);
const { submitCouncilJob, isCouncilSubmissionUncertain } = require(`${root}/lib/council-submission.js`);

function setup(t, fetcher) {
    const before = global.fetch;
    const token = process.env.COUNCIL_API_TOKEN;
    const base = process.env.NEXT_PUBLIC_API_URL;
    process.env.COUNCIL_API_TOKEN = 'test-service-token';
    process.env.NEXT_PUBLIC_API_URL = 'https://backend.test/api';
    global.fetch = fetcher;
    t.after(() => {
        global.fetch = before;
        if (token === undefined) delete process.env.COUNCIL_API_TOKEN;
        else process.env.COUNCIL_API_TOKEN = token;
        if (base === undefined) delete process.env.NEXT_PUBLIC_API_URL;
        else process.env.NEXT_PUBLIC_API_URL = base;
    });
}

function request(body = '{"ticker":"ASX:TEST"}', token = 'test-user-token') {
    return new NextRequest('https://terminal.test/api/council/jobs', {
        method: 'POST', body,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
}

test('public demo rejects Council JSON, uploads and retries before reading input or spending tokens', async t => {
    const oldEnv = { ...process.env };
    const oldFetch = global.fetch;
    t.after(() => { process.env = oldEnv; global.fetch = oldFetch; });
    for (const key of ['TRADING_BACKEND_API_URL','COUNCIL_API_TOKEN','LLM_COUNCIL_API_URL','NEXT_PUBLIC_LLM_COUNCIL_API_URL','NEXT_PUBLIC_API_TOKEN','API_TOKEN','WEBHOOK_SECRET','PARALLEL_API_KEY','XAI_API_KEY','OPENAI_API_KEY','PERPLEXITY_API_KEY','GEMINI_API_KEY','ALPHA_EDGE_DEV_API_PROXY_URL']) delete process.env[key];
    process.env.APP_ACCESS_MODE = 'demo';
    let upstreamCalls = 0;
    global.fetch = async () => { upstreamCalls++; throw new Error('No demo upstream permitted'); };
    for (let attempt = 0; attempt < 10; attempt++) {
        for (const contentType of ['application/json', 'multipart/form-data; boundary=invalid']) {
            const req = request('{invalid', 'forged-owner-token');
            req.headers.set('Content-Type', contentType);
            req.headers.set('Cookie', '__Host-alpha-edge-session=forged');
            req.json = req.formData = async () => assert.fail('Must reject before parsing');
            const response = await jobs.POST(req);
            assert.equal(response.status, 403);
            assert.equal((await response.json()).code, 'DEMO_READ_ONLY');
            assert.equal(req.bodyUsed, false);
        }
    }
    for (const method of ['GET', 'POST']) {
        const result = await fetchCouncilJson('/api/analysis-jobs', { method }, { retries: 5 });
        assert.equal(result.status, 403, 'The upstream helper must also reject demo calls');
    }
    assert.equal(upstreamCalls, 0);
});

test('missing caller is rejected before parsing or any upstream request', async t => {
    setup(t, () => assert.fail('must not fetch'));
    const response = await jobs.POST(request('{invalid', ''));
    assert.equal(response.status, 401);
    assert.equal((await response.json()).submission_status, 'not_submitted');
});

test('invalid caller token is checked only by the trading backend', async t => {
    setup(t, async (url, init) => {
        assert.equal(url, 'https://backend.test/api/auth/check');
        assert.equal(init.headers.Authorization, 'Bearer test-user-token');
        assert.equal(init.redirect, 'error');
        return new Response('', { status: 401 });
    });
    assert.equal((await jobs.POST(request())).status, 401);
});

test('unavailable caller validation fails closed without blaming the key', async t => {
    setup(t, async () => { throw new Error('backend unavailable'); });
    const response = await jobs.POST(request());
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.code, 'CALLER_VALIDATION_UNAVAILABLE');
    assert.equal(body.submission_status, 'not_submitted');
});

test('only authenticated 204 is accepted, never a public health response', async t => {
    setup(t, async () => Response.json({ status: 'ok' }));
    assert.equal((await authorizeCouncilRequest(request())).status, 503);
});

test('valid JSON submission separates caller and service credentials', async t => {
    let calls = 0;
    setup(t, async (url, init) => {
        calls++;
        if (url.endsWith('/auth/check')) return new Response(null, { status: 204 });
        assert.equal(init.headers.get('Authorization'), 'Bearer test-service-token');
        assert.equal(init.method, 'POST');
        assert.equal(init.redirect, 'error');
        assert.equal(JSON.parse(init.body).ticker, 'ASX:TEST');
        return Response.json({ job_id: 'job-1', status: 'queued' }, { status: 202 });
    });
    const response = await jobs.POST(request());
    assert.equal(response.status, 202);
    assert.equal((await response.json()).job_id, 'job-1');
    assert.equal(calls, 2);
});

test('original portfolio job preserves nested investment plays without a saved memo', async t => {
    const payload = { job_type: 'portfolio_positioning', query: 'Independent market research',
        portfolio_context: { investment_plays: [{ title: 'Fertiliser', thesis: 'Test supply constraints and input costs.' }],
            asset_classes: [{ asset_class: 'CASH', weight_pct: 100 }] } };
    let submissions = 0;
    setup(t, async (url, init) => {
        if (url.endsWith('/auth/check')) return new Response(null, { status: 204 });
        submissions++;
        assert.deepEqual(JSON.parse(init.body), payload);
        return Response.json({ job_id: 'portfolio-with-plays', status: 'queued' }, { status: 202 });
    });
    assert.equal((await jobs.POST(request(JSON.stringify(payload)))).status, 202);
    assert.equal(submissions, 1);
});

test('malformed JSON and empty requests never reach Council', async t => {
    setup(t, async url => {
        assert.ok(url.endsWith('/auth/check'));
        return new Response(null, { status: 204 });
    });
    for (const body of ['{', '[]', '{}', 'null']) {
        assert.equal((await jobs.POST(request(body))).status, 400);
    }
});

test('multipart submission is forwarded once', async t => {
    let calls = 0;
    setup(t, async (url, init) => {
        if (url.endsWith('/auth/check')) return new Response(null, { status: 204 });
        calls++;
        assert.equal(init.body.get('ticker'), 'ASX:TEST');
        assert.equal(init.body.get('supplementary_file').name, 'notes.txt');
        return Response.json({ job_id: 'file-job', status: 'queued' });
    });
    const form = new FormData();
    form.set('ticker', 'ASX:TEST');
    form.set('supplementary_file', new Blob(['notes']), 'notes.txt');
    const response = await jobs.POST(new NextRequest('https://terminal.test/api/council/jobs', {
        method: 'POST', headers: { Authorization: 'Bearer user' }, body: form,
    }));
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
});

test('ambiguous upstream failures never retry POST even when requested', async t => {
    let calls = 0;
    let outcome;
    setup(t, async () => {
        calls++;
        if (outcome === 'network') throw new Error('lost response');
        if (outcome === 'malformed') return new Response('not json');
        if (outcome === 'missing-id') return Response.json({ status: 'queued' });
        return Response.json({ detail: 'uncertain server outcome' }, { status: Number(outcome) });
    });
    for (outcome of ['network', '500', '408', 'malformed', 'missing-id']) {
        calls = 0;
        const result = await fetchCouncilJson('/api/analysis-jobs', { method: 'POST' }, { retries: 3 });
        assert.equal(calls, 1, outcome);
        assert.equal(result.body.code, 'COUNCIL_SUBMISSION_UNCERTAIN', outcome);
    }
});

test('browser body timeout is uncertain and never retries', async () => {
    const calls = [];
    await assert.rejects(() => submitCouncilJob(async (_url, init) => {
        calls.push(init.method);
        return { ok: true, status: 200, json: () => new Promise((_, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('body stalled')), { once: true });
        }) };
    }, { method: 'POST' }, 20), isCouncilSubmissionUncertain);
    assert.deepEqual(calls, ['POST', 'GET']);
});

test('the response body remains inside the proxy timeout', async t => {
    let calls = 0;
    setup(t, async (_url, init) => {
        calls++;
        return { status: 200, ok: true, text: () => new Promise((_, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('body timeout')), { once: true });
        }) };
    });
    const result = await fetchCouncilJson('/api/analysis-jobs', { method: 'POST' }, { timeoutMs: 1000 });
    assert.equal(calls, 1);
    assert.equal(result.body.submission_status, 'uncertain');
});

test('service credentials and configuration failures are not caller 401s', async t => {
    setup(t, async () => new Response('unauthorized', { status: 401 }));
    const rejected = await fetchCouncilJson('/api/analysis-jobs', { method: 'POST' });
    assert.equal(rejected.status, 502);
    assert.equal(rejected.body.code, 'COUNCIL_AUTH_REJECTED');
    assert.equal(rejected.body.submission_status, 'not_submitted');
    delete process.env.COUNCIL_API_TOKEN;
    global.fetch = () => assert.fail('missing service token must not fetch');
    const missing = await fetchCouncilJson('/api/analysis-jobs', { method: 'POST' });
    assert.equal(missing.status, 503);
    assert.equal(missing.body.submission_status, 'not_submitted');
});

test('safe GET reads still retry', async t => {
    let calls = 0;
    setup(t, async () => ++calls === 1
        ? new Response('unavailable', { status: 503 })
        : Response.json({ job_id: 'job-1', status: 'running' }));
    const result = await fetchCouncilJson('/api/analysis-jobs/job-1', { method: 'GET' }, { retries: 1 });
    assert.equal(result.status, 200);
    assert.equal(calls, 2);
});

test('browser-to-proxy-to-Council timeout submits exactly once', async t => {
    let upstream = 0;
    setup(t, async url => {
        if (url.endsWith('/auth/check')) return new Response(null, { status: 204 });
        upstream++;
        throw new Error('connection lost after acceptance');
    });
    const browser = [];
    await assert.rejects(() => submitCouncilJob(async (url, init) => {
        browser.push(init.method);
        if (init.method === 'GET') return Response.json({}, { status: 404 });
        const headers = new Headers(init.headers);
        headers.set('Authorization', 'Bearer user'); headers.set('Content-Type', 'application/json');
        return jobs.POST(new NextRequest(`https://terminal.test${url}`, { ...init, headers }));
    }, { method: 'POST', body: '{"ticker":"ASX:TEST"}' }), isCouncilSubmissionUncertain);
    assert.deepEqual(browser, ['POST', 'GET']);
    assert.equal(upstream, 1);
});

test('lost POST response recovers its durable job using only a GET', async () => {
    let id; const methods = [];
    const job = await submitCouncilJob(async (url, init) => {
        methods.push(init.method);
        if (init.method === 'POST') { id = new Headers(init.headers).get('Idempotency-Key'); throw new Error('lost reply'); }
        assert.equal(new URL(url, 'https://test').searchParams.get('submission_id'), id);
        return Response.json({ job_id: 'accepted-once', status: 'queued', submission_id: id });
    }, { method: 'POST' });
    assert.equal(job.job_id, 'accepted-once');
    assert.deepEqual(methods, ['POST', 'GET']);
});

test('structured funding rejection is shown instead of generic failure', async () => {
    await assert.rejects(() => submitCouncilJob(async () => Response.json({ detail: { message: 'Insufficient provider credits', funding: { status: 'insufficient' } } }, { status: 402 }), { method: 'POST' }), /Insufficient provider credits/);
});

test('explicit preflight 503 stays a rejection while generic 503 remains uncertain', async t => {
    let upstreamPosts = 0;
    setup(t, async (url, init) => {
        if (url.endsWith('/auth/check')) return new Response(null, { status: 204 });
        upstreamPosts++;
        assert.equal(init.method, 'POST');
        return Response.json({ detail: { code: 'COUNCIL_PREFLIGHT_REJECTED', submission_status: 'not_submitted', message: 'Funding check unavailable' } }, { status: 503 });
    });
    await assert.rejects(submitCouncilJob(async (_url, init) => jobs.POST(new NextRequest('https://terminal.test/api/council/jobs', {
        ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), Authorization: 'Bearer test-user-token' },
    })), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"ticker":"ASX:TEST"}' }), error => {
        assert.equal(isCouncilSubmissionUncertain(error), false);
        assert.equal(error.message, 'Funding check unavailable');
        return true;
    });
    assert.equal(upstreamPosts, 1);
});

test('pending submission survives reload and can only recover by GET, never create another paid run', async t => {
    const previousWindow = global.window;
    const previousStorage = global.localStorage;
    const values = new Map();
    global.window = {};
    global.localStorage = {
        getItem: key => values.get(key) || null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
    };
    t.after(() => {
        if (previousWindow === undefined) delete global.window; else global.window = previousWindow;
        if (previousStorage === undefined) delete global.localStorage; else global.localStorage = previousStorage;
    });
    const key = 'portfolio_positioning:portfolio';
    const storageKey = `alpha-edge-council-submission:${key}`;
    let posts = 0;
    const lost = async (_url, init) => {
        if (init.method === 'POST') posts++;
        throw new Error('Connection lost');
    };
    await assert.rejects(submitCouncilJob(lost, { method: 'POST' }, 100, key), isCouncilSubmissionUncertain);
    const saved = values.get(storageKey);
    assert.match(saved, /^[0-9a-f-]{36}$/);
    await assert.rejects(submitCouncilJob(lost, { method: 'POST' }, 100, key), isCouncilSubmissionUncertain);
    assert.equal(posts, 1);
    assert.equal(values.get(storageKey), saved);
    const recovered = await submitCouncilJob(async (url, init) => {
        assert.equal(init.method, 'GET');
        assert.ok(url.includes(saved));
        return Response.json({ job_id: 'durable-job', status: 'running' });
    }, { method: 'POST' }, 100, key);
    assert.equal(recovered.job_id, 'durable-job');
    assert.equal(values.has(storageKey), false);
});

test('browser transport failures and invalid success bodies are uncertain', async () => {
    for (const fetcher of [
        async () => { throw new Error('network'); },
        async () => new Response('<html>gateway</html>', { status: 502 }),
        async () => Response.json({ status: 'queued' }),
    ]) {
        await assert.rejects(() => submitCouncilJob(fetcher, { method: 'POST' }), isCouncilSubmissionUncertain);
    }
});

test('explicit rejection is not described as uncertain', async () => {
    for (const status of [400, 401, 422, 429, 503]) {
        await assert.rejects(() => submitCouncilJob(async () => Response.json({
            detail: 'Not submitted', submission_status: 'not_submitted',
        }, { status }), { method: 'POST' }), error => {
            assert.equal(isCouncilSubmissionUncertain(error), false);
            return true;
        });
    }
});

test('every exposed Council handler calls the shared guard', () => {
    const dir = path.join(__dirname, '../app/api/council');
    const files = fs.readdirSync(dir, { recursive: true }).filter(file => file.endsWith('route.ts'));
    assert.equal(files.length, 8);
    for (const file of files) {
        const source = fs.readFileSync(path.join(dir, file), 'utf8');
        const handlers = source.match(/export async function (GET|POST)\(/g) || [];
        assert.equal((source.match(/await authorizeCouncilRequest\(/g) || []).length, handlers.length, file);
    }
});
