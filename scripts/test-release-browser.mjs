import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';

// The owner UI reads an isolated demo backend. Tests stub authentication and writes
// in the browser; actual passkey security is covered by test:access:browser.
const port = 3315;
const ownerPort = 3316;
const demoBase = `http://127.0.0.1:${port}`;
const base = `http://localhost:${ownerPort}`;
const env = { ...process.env, APP_ACCESS_MODE: 'demo', NEXT_DIST_DIR: '.next-release',
    CONTEXT_PANEL_BASE_URL: base, MODEL_WEIGHT_BASE_URL: base, PORTFOLIO_CYCLE_BASE_URL: base };
for (const key of Object.keys(env)) {
    if (/(TOKEN|SECRET|PASSWORD|API_KEY|DATABASE_URL)$/.test(key) || /^(TRADING_BACKEND_API_URL|LLM_COUNCIL_API_URL|NEXT_PUBLIC_.*URL|ALPHA_EDGE_DEV_API_PROXY_URL)$/.test(key)) env[key] = '';
}
// Empty values also block Next from loading these keys out of local dotenv files.
for (const key of ['TRADING_BACKEND_API_URL','COUNCIL_API_TOKEN','LLM_COUNCIL_API_URL','NEXT_PUBLIC_LLM_COUNCIL_API_URL','NEXT_PUBLIC_API_TOKEN','API_TOKEN','WEBHOOK_SECRET','PARALLEL_API_KEY','XAI_API_KEY','OPENAI_API_KEY','PERPLEXITY_API_KEY','GEMINI_API_KEY','ALPHA_EDGE_DEV_API_PROXY_URL']) env[key] = '';
env.NEXT_PUBLIC_API_URL = '/api/terminal';
const suites = ['weight-policy', 'positions-model-weight', 'portfolio-cycle', 'portfolio-reference',
    'portfolio-theme', 'portfolio-plays', 'announcement-subscriptions', 'positions-pinned-column',
    'positions-shape-footer', 'alert-action-integration', 'header-stats', 'sidebar-density'];
const children = [];
function start(args, overrides = {}) {
    const child = spawn(process.execPath, args, { env: { ...env, ...overrides }, detached: true, stdio: 'inherit' });
    children.push(child);
    return child;
}
async function complete(child) {
    const [code] = await once(child, 'exit');
    if (code !== 0) throw new Error(`Release check exited ${code}`);
}
try {
    for (const availablePort of [port, ownerPort]) await new Promise((resolve, reject) => {
        const server = createServer(); server.once('error', reject);
        server.listen(availablePort, '127.0.0.1', () => server.close(resolve));
    });
    await complete(start(['node_modules/next/dist/bin/next', 'build']));
    const server = start(['node_modules/next/dist/bin/next', 'start', '-p', String(port), '-H', '127.0.0.1']);
    const deadline = Date.now() + 60000;
    let ready = false;
    while (Date.now() < deadline) {
        if (server.exitCode !== null) throw new Error('Release preview exited before readiness');
        try { if ((await fetch(`${demoBase}/api/terminal/portfolio`)).ok) { ready = true; break; } } catch {}
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    if (!ready) throw new Error('Isolated release preview did not become ready');
    const owner = start(['node_modules/next/dist/bin/next', 'start', '-p', String(ownerPort), '-H', '127.0.0.1'], {
        APP_ACCESS_MODE: 'owner', APP_ORIGIN: base, TRADING_BACKEND_API_URL: `${demoBase}/api/terminal`,
    });
    ready = false;
    const ownerDeadline = Date.now() + 60000;
    while (Date.now() < ownerDeadline) {
        if (owner.exitCode !== null) throw new Error('Owner fixture preview exited before readiness');
        try { if ((await fetch(`${base}/api/terminal/portfolio`)).ok) { ready = true; break; } } catch {}
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    if (!ready) throw new Error('Owner fixture preview did not become ready');
    await complete(start(['--test', '--test-concurrency=1', ...suites.map(name => `tests/${name}.browser.test.cjs`)]));
} catch (error) {
    console.error(error); process.exitCode = 1;
} finally {
    for (const child of children.reverse()) {
        if (child.exitCode !== null || child.signalCode !== null) continue;
        try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 2000))]);
        if (child.exitCode === null && child.signalCode === null) {
            try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
            await once(child, 'exit');
        }
    }
}
