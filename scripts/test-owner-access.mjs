import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { strict as assert } from 'node:assert';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:net';

const children = [];
function start(cmd, args, env, cwd = process.cwd()) {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
    child.logs = () => log;
    children.push(child); return child;
}
async function waitURL(url, child) {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(child.logs());
        try { if ((await fetch(url)).ok) return; } catch {}
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`Server timeout: ${url}\n${child.logs()}`);
}
async function authenticator(context, page) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    return cdp;
}
let browser;
try {
    for (const port of [3311,3313,8311]) await new Promise((resolve,reject) => {
        const server = createServer(); server.once('error', reject);
        server.listen(port,'127.0.0.1',() => server.close(resolve));
    });
    const backend = start('go', ['test', '-run', '^TestOwnerBrowserServer$', '-count=1', '-timeout=10m', '-v'], { OWNER_BROWSER_TEST: '1', OWNER_BROWSER_ADDRESS: '127.0.0.1:8311' }, `${process.cwd()}/backend`);
    await waitURL('http://127.0.0.1:8311/api/health', backend);
    const dist = process.env.NEXT_DIST_DIR || '.next-access';
    const ownerEnv = { NEXT_DIST_DIR: dist, APP_ACCESS_MODE: 'owner', APP_ORIGIN: 'http://localhost:3311', TRADING_BACKEND_API_URL: 'http://127.0.0.1:8311/api' };
    const owner = start(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3311', '-H', '127.0.0.1'], ownerEnv);
    await waitURL('http://localhost:3311/api/terminal/auth/session', owner);
    const clean = Object.fromEntries(['TRADING_BACKEND_API_URL','COUNCIL_API_TOKEN','LLM_COUNCIL_API_URL','NEXT_PUBLIC_LLM_COUNCIL_API_URL','NEXT_PUBLIC_API_TOKEN','API_TOKEN','WEBHOOK_SECRET','PARALLEL_API_KEY','XAI_API_KEY','OPENAI_API_KEY','PERPLEXITY_API_KEY','GEMINI_API_KEY','ALPHA_EDGE_DEV_API_PROXY_URL'].map(key => [key, '']));
    const demo = start(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3313', '-H', '127.0.0.1'], { ...clean, NEXT_DIST_DIR: dist, APP_ACCESS_MODE: 'demo' });
    await waitURL('http://127.0.0.1:3313/api/terminal/portfolio', demo);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.addInitScript(() => localStorage.setItem('alpha-edge:welcome-guide:v1:owner', 'dismissed'));
    const page = await context.newPage(); await authenticator(context, page);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    assert.equal((await context.request.get('http://localhost:3311/api/terminal/portfolio')).status(), 401);
    await page.goto('http://localhost:3311/');
    await page.getByLabel('Setup token', { exact: true }).fill('test-only-setup-token-with-at-least-32-characters');
    await page.getByRole('button', { name: 'Register passkey', exact: true }).click();
    await page.getByText('Keep your recovery codes', { exact: true }).waitFor();
    const codes = await page.locator('.access-codes code').allTextContents(); assert.equal(codes.length, 8);
    await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: 'Manage owner session', exact: true }).waitFor();
    const cookie = (await context.cookies()).find(c => c.name === 'alpha-edge-local-session');
    assert.ok(cookie.httpOnly); assert.equal(cookie.sameSite, 'Strict');
    assert.equal((await context.request.get('http://localhost:3311/api/terminal/portfolio')).status(), 200);
    const session = await (await context.request.get('http://localhost:3311/api/terminal/auth/session')).json();
    assert.equal((await context.request.post('http://localhost:3311/api/terminal/auth/refresh', { data: {}, headers: { Origin: ownerEnv.APP_ORIGIN, 'X-CSRF-Token': session.csrf_token } })).status(), 200);
    assert.equal((await context.request.post('http://localhost:3311/api/terminal/auth/refresh', { data: {}, headers: { Origin: ownerEnv.APP_ORIGIN } })).status(), 403);
    assert.equal((await context.request.post('http://localhost:3311/api/terminal/auth/refresh', { data: {}, headers: { Origin: 'https://evil.example', 'X-CSRF-Token': session.csrf_token } })).status(), 403);
    await page.reload(); await page.getByRole('button', { name: 'Manage owner session', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Manage owner session', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
    assert.equal((await context.request.get('http://localhost:3311/api/terminal/portfolio', { headers: { Cookie: `${cookie.name}=${cookie.value}` } })).status(), 401);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Manage owner session', exact: true }).waitFor();
    const recoveryContext = await browser.newContext();
    await recoveryContext.addInitScript(() => localStorage.setItem('alpha-edge:welcome-guide:v1:owner', 'dismissed'));
    const recoveryPage = await recoveryContext.newPage(); await authenticator(recoveryContext,recoveryPage);
    await recoveryPage.goto('http://localhost:3311/');
    await recoveryPage.getByRole('button', { name: 'Use a recovery code', exact: true }).click();
    await recoveryPage.getByLabel('Recovery code', { exact: true }).fill(codes[0]);
    await recoveryPage.getByRole('button', { name: 'Use recovery code', exact: true }).click();
    await recoveryPage.getByText('Replace your passkey', { exact: true }).waitFor();
    assert.equal((await recoveryContext.request.get('http://localhost:3311/api/terminal/portfolio')).status(), 403);
    await recoveryPage.getByRole('button', { name: 'Register replacement', exact: true }).click();
    await recoveryPage.getByText('Keep your recovery codes', { exact: true }).waitFor();
    const replacementCodes = await recoveryPage.locator('.access-codes code').allTextContents();
    assert.equal(replacementCodes.length,8); assert.notEqual(replacementCodes[0],codes[0]);
    assert.equal((await context.request.get('http://localhost:3311/api/terminal/portfolio')).status(),401);
    assert.equal((await context.request.post('http://localhost:3311/api/terminal/auth/recover', { data:{code:codes[1]}, headers:{Origin:ownerEnv.APP_ORIGIN} })).status(),401);
    await recoveryPage.getByRole('checkbox').check(); await recoveryPage.getByRole('button', { name: 'Continue', exact: true }).click();
    await recoveryPage.getByRole('button', { name: 'Manage owner session', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: real browser passkey enrollment/login, reload, CSRF, logout, limited recovery, replacement and revocation.');

    const demoContext = await browser.newContext();
    await demoContext.addInitScript(() => localStorage.setItem('alpha-edge:welcome-guide:v1:demo', 'dismissed'));
    const demoPage = await demoContext.newPage();
    await demoPage.addInitScript(() => localStorage.setItem('terminal-cached-data',JSON.stringify({portfolio:{totalValue:999999,cashOnHand:1},stocks:[{id:999,name:'PRIVATE_CACHE_SENTINEL',symbol:'SECRET',positionValue:999999}]})));
    const demoErrors = []; const external = []; const failed = [];
    demoPage.on('pageerror', error => demoErrors.push(error.message));
    demoPage.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:3313') && /^https?:/.test(request.url())) external.push(request.url()); });
    demoPage.on('response', response => { if (response.status() >= 500) failed.push(`${response.status()} ${response.url()}`); });
    for (const route of ['positions','analysis','portfolio','system','markets','alerts','news','history','etf','help']) {
        await demoPage.goto(`http://127.0.0.1:3313/#/${route}`);
        await demoPage.locator('.terminal-unified-header').waitFor();
        await demoPage.waitForTimeout(500);
        assert.ok(!(await demoPage.locator('body').innerText()).includes('PRIVATE_CACHE_SENTINEL'));
        if(route==='positions') {
            await demoPage.getByText('BHP Group Limited',{exact:true}).first().waitFor();
            await demoPage.getByText('Banks (6)',{exact:true}).waitFor();
            await demoPage.getByText('VanEck Australian Banks ETF',{exact:true}).first().waitFor();
            const text = await demoPage.locator('.positions-grid tbody').innerText();
            assert.ok(text.includes('Q1-Defensive'));
            assert.ok(text.includes('Q1-Exempt'));
            assert.ok(text.indexOf('Q1-Defensive') < text.indexOf('Consumer Staples (2)'));
            assert.ok(text.indexOf('Q1-Exempt') < text.indexOf('Energy Producers (2)'));
        }
        if(route==='system') {
            await demoPage.getByRole('button',{name:'Asset classes',exact:true}).click();
            const index = demoPage.getByTestId('asset-class-index');
            await index.locator('[data-class-code="URANIUM_MINERS"]').waitFor();
            await index.getByRole('searchbox',{name:'Search asset classes'}).fill('Banks');
            await expect(index.locator('[data-class-code]')).toHaveCount(2);
            await expect(index.locator('[data-class-code="BANKS"]')).toBeVisible();
            await expect(index.locator('[data-class-code="FINANCIALS"]')).toBeVisible();
            await index.getByRole('button',{name:'Q1-Defensive',exact:true}).click();
            await index.getByText('No matching asset classes.',{exact:true}).waitFor();
            await index.getByRole('button',{name:'Clear asset-class search',exact:true}).click();
            await index.locator('[data-class-code="INSURANCE"]').waitFor();
            assert.equal(await index.locator('[data-class-code="BANKS"]').count(),0);
            await demoPage.getByRole('button',{name:'Decision flow',exact:true}).click();
            await demoPage.getByTestId('system-layer-risk').waitFor();
        }
    }
    for (const path of ['/api/terminal/portfolio-mix/approve','/api/terminal/source-research/jobs','/api/terminal/webhook/tradingview','/api/council/jobs']) {
        const response = await demoContext.request.post(`http://127.0.0.1:3313${path}`, { data: {} }); assert.equal(response.status(),403,path);
    }
    await demoPage.setViewportSize({width:390,height:844});
    await demoPage.goto('http://127.0.0.1:3313/#/positions');
    await demoPage.locator('.terminal-unified-header').waitFor();
    assert.deepEqual(demoErrors, []); assert.deepEqual(external, []); assert.deepEqual(failed, []);
    console.log('PASS: demo tabs/mobile render; no external browser requests; writes, ingress and paid jobs blocked.');
} catch (error) {
    console.error(error);
    // Server output contains only synthetic test traffic; never log cookies or codes.
    for (const child of children) console.error(child.logs().slice(-2500));
    process.exitCode = 1;
} finally {
    await browser?.close();
    for (const child of children.reverse()) {
        if (child.exitCode !== null || child.signalCode !== null) continue;
        try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if(error.code !== 'ESRCH') throw error; }
        await Promise.race([once(child,'exit'),new Promise(resolve => setTimeout(resolve,2000))]);
        if (child.exitCode === null && child.signalCode === null) {
            try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if(error.code !== 'ESRCH') throw error; }
        }
    }
}
