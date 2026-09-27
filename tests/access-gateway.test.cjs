const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { paths: apiPaths } = require('../DOCS/api/openapi.json');
const root = '/tmp/alpha-edge-access-tests';
const gateway = require(path.join(root, 'app/api/terminal/[...path]/route.js'));
const { authorizeCouncilRequest } = require(path.join(root, 'app/api/council/_lib.js'));
const context = route => ({ params: Promise.resolve({path:route.split('/').filter(Boolean)}) });

function configure(t, mode) {
    const oldEnv = { ...process.env }; const oldFetch = global.fetch;
    for (const key of ['TRADING_BACKEND_API_URL','COUNCIL_API_TOKEN','LLM_COUNCIL_API_URL','NEXT_PUBLIC_LLM_COUNCIL_API_URL','NEXT_PUBLIC_API_TOKEN','API_TOKEN','WEBHOOK_SECRET','PARALLEL_API_KEY','XAI_API_KEY','OPENAI_API_KEY','PERPLEXITY_API_KEY','GEMINI_API_KEY','ALPHA_EDGE_DEV_API_PROXY_URL']) delete process.env[key];
    process.env.APP_ACCESS_MODE = mode;
    delete process.env.DEMO_INCOMPLETE_RESEARCH;
    if(mode === 'owner') { process.env.APP_ORIGIN='https://owner.example'; process.env.TRADING_BACKEND_API_URL='https://backend.example/api'; }
    t.after(() => {process.env = oldEnv;global.fetch = oldFetch;});
    return (route, method='GET',headers={}) => new Request(`https://owner.example/api/terminal${route}`, {method,headers});
}

test('demo serves synthetic holdings and rejects every write without fetch', async t => {
    const request=configure(t,'demo');
    global.fetch=async()=>{throw new Error('demo must never fetch');};
    const book=await (await gateway.GET(request('/statements/latest'),context('/statements/latest'))).json();
    assert.equal(book.holdings.length,25);
    assert.equal(new Set(book.holdings.map(h=>h.ticker)).size,25);
    assert.ok(book.holdings.every(h=>!h.details.includes('Demo')));
    assert.equal(book.holdings.find(h=>h.ticker==='MVB').name,'VanEck Australian Banks ETF');
    for(const method of ['POST','PUT','PATCH','DELETE']) {
        const response=await gateway[method](request('/settings',method),context('/settings')); assert.equal(response.status,403);
    }
    assert.equal((await authorizeCouncilRequest(new Request('https://owner.example/api/council/jobs',{method:'POST'}))).status,403);
    assert.equal((await gateway.GET(request('/auth/session'),context('/auth/session'))).status,403);
    const subscriptions = await (await gateway.GET(request('/announcement-subscriptions'),context('/announcement-subscriptions'))).json();
    assert.equal(subscriptions.items.length, 25);
    assert.ok(subscriptions.items.every(row => !row.configured && !row.provider));
    assert.equal((await gateway.PATCH(request('/announcement-subscriptions','PATCH'),context('/announcement-subscriptions'))).status,403);
});

test('the entire Terminal REST inventory remains local and read-only in demo mode', async t => {
    const request = configure(t, 'demo');
    let upstreamCalls = 0;
    global.fetch = async () => { upstreamCalls++; throw new Error('No demo upstream permitted'); };
    let checked = 0;
    for (const [template, operations] of Object.entries(apiPaths)) {
        const route = template.replace(/^\/api/, '').replace(/\{[^}]+\}/g, '1');
        for (const [verb, operation] of Object.entries(operations)) {
            if (!operation.tags?.includes('terminal')) continue;
            const method = verb.toUpperCase();
            assert.equal(typeof gateway[method], 'function', `${method} ${template}`);
            const req = request(route, method, {
                Authorization: 'Bearer forged-owner-token', Cookie: '__Host-alpha-edge-session=forged',
                'X-CSRF-Token': 'forged', 'X-HTTP-Method-Override': 'GET',
            });
            const response = await gateway[method](req, context(route));
            assert.equal(response.headers.get('X-Alpha-Edge-Demo'), 'synthetic-read-only', template);
            if (!['GET', 'HEAD'].includes(method) && route !== '/sizing/allocations') {
                assert.equal(response.status, 403, `${method} ${template}`);
                assert.equal((await response.json()).code, 'DEMO_READ_ONLY');
                assert.equal(req.bodyUsed, false, 'Reject before reading the submitted payload');
            } else {
                assert.ok(response.status < 500, `${method} ${template}`);
            }
            checked++;
        }
    }
    assert.ok(checked >= 177, 'Keep the test tied to the complete API inventory');
    assert.equal(upstreamCalls, 0, 'Even GET requests must never reach a live backend');
    t.diagnostic(`${checked} Terminal operations checked without any upstream request`);
});

test('repeated paid-job requests cannot override the demo mode or parse a prompt', async t => {
    const request = configure(t, 'demo');
    let upstreamCalls = 0;
    global.fetch = async () => { upstreamCalls++; throw new Error('No demo upstream permitted'); };
    const routes = [
        '/source-research/jobs', '/source-research/jobs/1/recover', '/analysis/classify-asset-class',
        '/enrich/tickers', '/news/run', '/news/foundation-jobs', '/news/daily-jobs', '/news/deduplicate',
    ];
    for (let attempt = 0; attempt < 5; attempt++) {
        for (const route of routes) {
            const req = request(`${route}?APP_ACCESS_MODE=owner&force=true`, 'POST', {
                Authorization: 'Bearer forged', 'X-Access-Mode': 'owner',
                'Content-Type': 'multipart/form-data; boundary=invalid',
            });
            req.json = req.formData = req.arrayBuffer = async () => assert.fail('Must reject before parsing');
            const response = await gateway.POST(req, context(route));
            assert.equal(response.status, 403, route);
            assert.equal((await response.json()).code, 'DEMO_READ_ONLY');
        }
    }
    assert.equal(upstreamCalls, 0);
});

test('demo identities, class budgets and historical shapes reconcile without live services', async t => {
    const request=configure(t,'demo');
    global.fetch=async()=>{throw new Error('demo must never fetch');};
    const get=async route=>(await gateway.GET(request(route),context(route))).json();
    const book=await get('/statements/latest');
    const analysis=await get('/analysis');
    const heldAnalysis=analysis.filter(a=>!a.is_watchlist);
    const watchlist=analysis.filter(a=>a.is_watchlist);
    const opportunities=await get('/watchlist/opportunities');
    const weightPolicy=await get('/weight-policy');
    assert.equal(watchlist.length,6);
    assert.deepEqual(opportunities.items.map(item=>item.ticker),watchlist.map(item=>item.ticker));
    assert.deepEqual(opportunities.items.map(item=>item.state),['READY','CAPACITY','RESEARCH','CAPACITY','CAPACITY','CAPACITY']);
    for (const candidate of opportunities.items) {
        assert.ok(!book.holdings.some(holding=>`ASX:${holding.ticker}`===candidate.ticker));
        for (const peer of candidate.peers) {
            assert.equal(peer.before,weightPolicy.targets.find(target=>target.ticker===peer.ticker).percent);
            const target=weightPolicy.targets.find(target=>target.ticker===peer.ticker);
            if (target.role === 'CORE_ETF') assert.equal(peer.after,peer.before);
            else assert.ok(peer.after < peer.before);
        }
    }
    const groupData=await get('/groups');
    const current=await get('/portfolio-mix/current');
    const approved=await get('/portfolio-mix/approved');
    const history=await get('/portfolio-history');
    const {memos}=await get('/council/portfolio-memos');
    const ledger=await get('/etf/allocation-ledger');
    const config=await get('/asset-class-config');
    const catalogue=await get('/asset-classes');
    assert.ok(catalogue.length>40);
    assert.ok(catalogue.some(c=>c.code==='URANIUM_MINERS' && !c.in_mandate));
    for (const code of ['CONSUMER_STAPLES','GAMING_GAMBLING','INSURANCE']) {
        assert.equal(config.find(c=>c.key===code).overlay_eligible,true);
        assert.equal(config.find(c=>c.key===code).q3_beneficiary,true);
    }
    for (const code of ['PHARMA_BIOTECH','HEALTHCARE_SERVICES','INFRASTRUCTURE','ENERGY_PRODUCERS']) {
        assert.equal(config.find(c=>c.key===code).overlay_eligible,false);
        const shapeRow = approved.rows.find(c=>c.asset_class===code);
        if (shapeRow) assert.equal(shapeRow.governed_by_q1,false);
    }
    assert.equal(config.find(c=>c.key==='BANKS').overlay_eligible,true);
    assert.equal(config.find(c=>c.key==='BANKS').q3_beneficiary,false);
    const sizing=await get('/sizing/allocations');
    const near=(a,b)=>assert.ok(Math.abs(a-b)<0.000001,`${a} != ${b}`);
    const expectedStocks='BHP CBA NEM WBC NAB ANZ MQG CSL WES WDS RIO GMG FMG WOW TCL ALL QBE COL NST STO EVN'.split(' ').map(t=>`ASX:${t}`);
    assert.deepEqual(heldAnalysis.filter(a=>a.security_type==='STOCK').map(a=>a.ticker),expectedStocks);
    assert.equal(analysis.filter(a=>a.security_type==='ETF').length,4);
    assert.equal(analysis.find(a=>a.ticker==='ASX:MVB').primary_asset_class,'BANKS');
    assert.equal(new Set(groupData.groups.map(g=>g.id)).size,groupData.groups.length);
    assert.equal(groupData.assignments.length,25);
    assert.equal(groupData.groups.length,12);
    near(book.holdings.reduce((sum,h)=>sum+h.value_aud,book.statement.cash_aud),book.statement.total_value_aud);
    for (const security of heldAnalysis) {
        const holding=book.holdings.find(h=>`ASX:${h.ticker}`===security.ticker);
        assert.equal(holding.name,security.name);
        assert.equal(groupData.assignments.find(a=>a.company_name===security.name).group_id,security.primary_asset_class);
        near(holding.quantity*holding.current_price,holding.value_aud);
        assert.ok(security.gemini_quality<=100 && security.gpt_quality<=100);
    }
    for (const shape of [current,approved,...history.entries]) {
        near(shape.rows.reduce((sum,r)=>sum+r.weight_pct,0),100);
        near(shape.rows.reduce((sum,r)=>sum+r.value,0),283350);
        assert.equal(new Set(shape.rows.map(r=>r.asset_class)).size,shape.rows.length);
    }
    for (const entry of history.entries) assert.deepEqual(memos.find(m=>m.memo_job_id===entry.memo_job_id).target_allocations,entry.rows);
    assert.notDeepEqual(history.entries[0].rows,history.entries[1].rows);
    for (const group of groupData.groups) {
        const members=heldAnalysis.filter(a=>a.primary_asset_class===group.id);
        const stocks=members.filter(a=>a.security_type==='STOCK');
        near(stocks.reduce((sum,a)=>sum+a.allocation,0),100);
        const invested=members.reduce((sum,a)=>sum+book.holdings.find(h=>`ASX:${h.ticker}`===a.ticker).value_aud,0);
        near(current.rows.find(r=>r.asset_class===group.id).value,invested);
        const stockTarget=stocks.reduce((sum,a)=>sum+sizing.results.find(r=>r.id===a.id).allocation_dollar,0);
        const fundTarget=ledger.rows.filter(r=>r.asset_class===group.id).reduce((sum,r)=>sum+Math.max(r.effective_target_value,r.actual_value),0);
        near(stockTarget+fundTarget,approved.rows.find(r=>r.asset_class===group.id).value);
    }
    near(ledger.rows[0].actual_value,book.holdings.find(h=>h.ticker==='MVB').value_aud);
    near(ledger.rows[0].effective_target_value,approved.rows.find(r=>r.asset_class==='BANKS').value*0.25);
    near(ledger.rows[0].target_delta_value,ledger.rows[0].effective_target_value-ledger.rows[0].actual_value);
});

test('demo sizing honours the requested universe without a provider or private-data call', async t => {
    configure(t, 'demo');
    global.fetch = async () => { throw new Error('unexpected fetch'); };
    const size = async ids => (await gateway.POST(new Request('https://owner.example/api/terminal/sizing/allocations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stocks: ids.map(id => ({ id })) }),
    }), context('/sizing/allocations'))).json();
    const a = await size([2, 4]);
    assert.deepEqual(a.results.map(row => row.id), [2, 4]);
    assert.ok(Math.abs(a.results.reduce((sum, row) => sum + row.allocation_pct, 0) - 100) < 1e-8);
    const only = await size([2]);
    assert.equal(only.results[0].allocation_pct, 100);
    assert.equal(only.results[0].allocation_dollar, 51003);
    assert.equal((await size([])).results.length, 0);
    assert.equal((await size([999])).results.length, 0);
});

test('local incomplete-research preview withholds Bank stock weights without changing holdings or Core ETF', async t => {
    const request = configure(t, 'demo');
    process.env.NODE_ENV = 'development';
    global.fetch = async () => { throw new Error('demo must never fetch'); };
    const get = async route => (await gateway.GET(request(route), context(route))).json();
    const book = await get('/statements/latest');
    const before = await get('/weight-policy');
    process.env.DEMO_INCOMPLETE_RESEARCH = '1';
    const research = await get('/analysis');
    const westpac = research.find(row => row.ticker === 'ASX:WBC');
    assert.equal(westpac.gemini_pt, 0);
    assert.equal(westpac.gpt_pt, 0);
    const policy = await get('/weight-policy');
    const banks = policy.targets.filter(row => row.asset_class === 'BANKS' && row.role === 'STOCK');
    assert.equal(banks.length, 5);
    for (const row of banks) {
        assert.equal(row.available, false);
        assert.equal(row.research_missing, 1);
        assert.equal(row.ideal, 0);
        assert.match(row.reason, /Incomplete class research/);
    }
    for (const row of policy.targets.filter(row => row.asset_class !== 'BANKS' || row.role === 'CORE_ETF')) {
        assert.deepEqual(row, before.targets.find(target => target.ticker === row.ticker));
    }
    assert.deepEqual(await get('/statements/latest'), book);
    process.env.NODE_ENV = 'production';
    assert.deepEqual(await get('/weight-policy'), before, 'Local scenario must not change a deployed demo');
    process.env.NODE_ENV = 'development';
    delete process.env.DEMO_INCOMPLETE_RESEARCH;
    assert.deepEqual(await get('/weight-policy'), before, 'Restarting without the flag restores complete research');
});

test('demo refuses a backend URL or provider credential instead of using it',async t=>{
    const request=configure(t,'demo'); let upstreamCalls=0;
    global.fetch=async()=>{upstreamCalls++;throw new Error('unexpected fetch');};
    for(const key of ['TRADING_BACKEND_API_URL','COUNCIL_API_TOKEN','LLM_COUNCIL_API_URL','NEXT_PUBLIC_LLM_COUNCIL_API_URL','NEXT_PUBLIC_API_TOKEN','API_TOKEN','WEBHOOK_SECRET','PARALLEL_API_KEY','XAI_API_KEY','OPENAI_API_KEY','PERPLEXITY_API_KEY','GEMINI_API_KEY','ALPHA_EDGE_DEV_API_PROXY_URL']) {
        process.env[key]='unsafe-demo-configuration';
        assert.equal((await gateway.GET(request('/portfolio'),context('/portfolio'))).status,503);
        assert.equal((await authorizeCouncilRequest(new Request('https://demo.example/api/council/jobs',{method:'POST'}))).status,503);
        delete process.env[key];
    }
    assert.equal(upstreamCalls,0);
});

test('owner gateway strips machine credentials and unrelated cookies; preserves streaming and Set-Cookie',async t=>{
    const request=configure(t,'owner'); let captured;
    global.fetch=async(url,init)=>{captured={url,init}; return new Response('data: {}\n\n',{headers:{'Content-Type':'text/event-stream','Set-Cookie':'__Host-alpha-edge-session=new; Path=/; Secure; HttpOnly; SameSite=Strict'}});};
    const response=await gateway.GET(request('/alerts/stream','GET',{Cookie:'other=private; __Host-alpha-edge-session=owner',Authorization:'Bearer machine', 'X-CSRF-Token':'csrf'}),context('/alerts/stream'));
    assert.equal(captured.url,'https://backend.example/api/alerts/stream');
    assert.equal(captured.init.headers.get('cookie'),'__Host-alpha-edge-session=owner');
    assert.equal(captured.init.headers.get('authorization'),null);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.match(response.headers.get('set-cookie'),/HttpOnly/);
    assert.equal(await response.text(),'data: {}\n\n');
});

test('owner rejects bad origin, encoded traversal and query credentials before fetch',async t=>{
    const request=configure(t,'owner');global.fetch=async()=>{throw new Error('unexpected fetch');};
    assert.equal((await gateway.POST(request('/settings','POST',{Origin:'https://evil.example'}),context('/settings'))).status,403);
    assert.equal((await gateway.GET(request('/settings'),{params:Promise.resolve({path:['..','portfolio']})})).status,400);
    assert.equal((await gateway.GET(request('/alerts/stream?token=old-key'),context('/alerts/stream'))).status,403);
    assert.equal((await gateway.POST(request('/webhook/regime','POST',{Origin:'https://owner.example'}),context('/webhook/regime'))).status,403);
});

test('Council verifies the cookie and CSRF with the backend; cannot use bearer fallback',async t=>{
    configure(t,'owner');let calls=0;
    global.fetch=async(url,init)=>{
        calls++;assert.equal(url,'https://backend.example/api/auth/check');assert.equal(init.method,'POST');
        assert.equal(init.headers.get('authorization'),null); assert.equal(init.headers.get('x-csrf-token'),'csrf');
        return new Response(null,{status:204});
    };
    const request=new Request('https://owner.example/api/council/jobs',{method:'POST',headers:{Origin:'https://owner.example',Cookie:'__Host-alpha-edge-session=owner','X-CSRF-Token':'csrf',Authorization:'Bearer ignored'}});
    assert.equal(await authorizeCouncilRequest(request),null);assert.equal(calls,1);
    global.fetch=async()=>new Response(null,{status:401});
    assert.equal((await authorizeCouncilRequest(request)).status,401);
});
