import { spawn } from 'node:child_process';

// Explicit empty values prevent Next dotenv loading private integration settings.
const env = { ...process.env, APP_ACCESS_MODE: 'demo', NEXT_DIST_DIR: '.next-demo', NEXT_PUBLIC_API_URL: '/api/terminal', PORT: '3312' };
for (const key of ['TRADING_BACKEND_API_URL','COUNCIL_API_TOKEN','LLM_COUNCIL_API_URL','NEXT_PUBLIC_LLM_COUNCIL_API_URL','NEXT_PUBLIC_API_TOKEN','API_TOKEN','WEBHOOK_SECRET','PARALLEL_API_KEY','XAI_API_KEY','OPENAI_API_KEY','PERPLEXITY_API_KEY','GEMINI_API_KEY','ALPHA_EDGE_DEV_API_PROXY_URL']) env[key] = '';
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '-p', '3312', '-H', '127.0.0.1'], { env, stdio: 'inherit' });
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code ?? 0; });
