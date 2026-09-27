import { readFileSync, writeFileSync } from 'node:fs';
import { routesFromSource } from './docs-lib.mjs';
import { workflowContracts, workflowSchemas } from './workflow-api-contracts.mjs';
import { ownerAccessContracts, ownerAccessSchemas } from './owner-access-contracts.mjs';
import { portfolioCycleContracts, portfolioCycleSchemas } from './portfolio-cycle-contracts.mjs';
import { hardeningContracts } from './hardening-api-contracts.mjs';

const check = process.argv.includes('--check');
const routes = routesFromSource();
const contracts = JSON.parse(readFileSync('DOCS/api/contracts.json', 'utf8'));
const keys = routes.map(route => `${route.method} ${route.path}`);
const missing = keys.filter(key => !contracts[key]);
const stale = Object.keys(contracts).filter(key => !keys.includes(key));
if (missing.length || stale.length) throw new Error(`API contract inventory differs. Missing: ${missing.join(', ')}; stale: ${stale.join(', ')}`);
for (const [key, detail] of Object.entries({ ...workflowContracts, ...ownerAccessContracts, ...portfolioCycleContracts, ...hardeningContracts })) {
  if (!contracts[key]) throw new Error(`Workflow contract has no route: ${key}`);
  contracts[key] = { ...contracts[key], ...detail };
}
const paths = {};
for (const route of routes) {
  const contract = contracts[`${route.method} ${route.path}`];
  const webhook = route.path.startsWith('/api/webhook/') && route.method === 'POST';
  const security = route.path === '/api/health' ? [] : webhook ? [{ bearerAuth: [] }, { webhookSecret: [] }] : route.path === '/api/alerts/stream' ? [{ bearerAuth: [] }, { streamToken: [] }] : [{ bearerAuth: [] }];
  const operation = {
    operationId: `${route.service}_${route.method}_${route.path.replace(/[^a-zA-Z0-9]+/g, '_')}`,
    summary: contract.summary,
    description: [contract.description, contract.responses ? 'Selected request/response contract; workflow constraints still require handler validation.' : 'Route and handler are checked against source. Response schemas are not yet complete; consult the linked reference and handler before integrating.', webhook ? 'Webhook authentication also accepts a JSON secret field. Acknowledgement is not proof of successful downstream processing.' : ''].filter(Boolean).join('\n\n'),
    tags: [route.service],
    servers: [{ url: route.service === 'terminal' ? 'http://localhost:8080' : 'http://localhost:3100', description: 'Local development only; select the correct service origin.' }],
    security: contract.security || (route.path.startsWith('/api/webhook/') || route.path === '/api/health' ? security : [...security, ['GET','HEAD'].includes(route.method) ? { ownerSession: [] } : { ownerSession: [], ownerCSRF: [] }]),
    parameters: [...route.path.matchAll(/\{([^}]+)\}/g)].map(match => ({ name: match[1], in: 'path', required: true, schema: { type: 'string' } })).concat(contract.parameters || []),
    responses: contract.responses || { default: { description: 'Status and body are operation-specific. See API_REFERENCE.md and the source handler; no uniform success or error schema is asserted here.' } },
    'x-contract-level': contract.responses ? 'workflow-documented' : contract.requestBody ? 'request-documented' : 'route-inventory',
    'x-source': `${route.source}#L${route.line}`,
    'x-handler': route.handler,
    ...(contract.requestBody ? { requestBody: contract.requestBody } : {}),
  };
  (paths[route.path] ||= {})[route.method.toLowerCase()] = operation;
}
const spec = {
  openapi: '3.1.0',
  info: { title: 'Alpha Edge Terminal and Council Proxy API', version: '0.1.0', description: 'Source-checked route inventory with selected request contracts. Not a complete schema specification, deployment certification, or an API for the independent Intelligence Service. OPTIONS is handled by middleware and omitted. No production server is preselected.' },
  paths,
  components: { schemas: { ...workflowSchemas, ...ownerAccessSchemas, ...portfolioCycleSchemas }, securitySchemes: {
    ownerSession: { type:'apiKey',in:'cookie',name:'__Host-alpha-edge-session',description:'Owner mode only. Host-only Secure HttpOnly SameSite=Strict cookie; localhost uses alpha-edge-local-session.' },
    ownerChallenge: { type:'apiKey',in:'cookie',name:'__Host-alpha-edge-challenge',description:'Single-use, five-minute WebAuthn challenge. localhost uses alpha-edge-local-challenge.' },
    ownerCSRF: { type:'apiKey',in:'header',name:'X-CSRF-Token',description:'Required with owner session for mutations, alongside exact Origin. Not an alternative to authentication.' },
    bearerAuth: { type: 'http', scheme: 'bearer', description: 'Terminal API_TOKEN; Council proxy validates the same browser credential before using its own server-side credential.' },
    webhookSecret: { type: 'apiKey', in: 'query', name: 'secret', description: 'WEBHOOK_SECRET; body secret is also accepted. Avoid logging or sharing URLs containing secrets.' },
    streamToken: { type: 'apiKey', in: 'query', name: 'token', description: 'EventSource alternative to the bearer header.' },
  } },
};
const requestCount = Object.values(contracts).filter(contract => contract.requestBody).length;
const responseCount = Object.values(contracts).filter(contract => contract.responses).length;
const catalogue = `# API Route Catalogue\n\nGenerated by \`npm run docs:generate\` from the Go router, Next Council handlers, [route annotations](contracts.json) and [workflow contracts](../../scripts/workflow-api-contracts.mjs). Do not edit this file.\n\n${routes.filter(r => r.service === 'terminal').length} Terminal operations; ${routes.filter(r => r.service === 'council-proxy').length} Council proxy operations; ${requestCount} selected request schemas; ${responseCount} selected response/error contracts. Other operations remain inventory or request-only contracts. See [OpenAPI](openapi.json), [contract detail](API_REFERENCE.md) and [signal tracing](SIGNAL_TRACE.md).\n\n| Service | Method | Path | Purpose | Source |\n| --- | --- | --- | --- | --- |\n` + routes.map(route => `| ${route.service} | \`${route.method}\` | \`${route.path}\` | ${contracts[`${route.method} ${route.path}`].summary.replaceAll('|', '\\|')} | [Handler](../../${route.source}#L${route.line}) |`).join('\n') + '\n';
for (const [file, data] of [['DOCS/api/openapi.json', JSON.stringify(spec, null, 2) + '\n'], ['DOCS/api/ROUTES.md', catalogue]]) {
  if (check) {
    if (readFileSync(file, 'utf8') !== data) throw new Error(`${file} is stale. Run npm run docs:generate.`);
  } else writeFileSync(file, data);
}
console.log(`API inventory: ${routes.length} operations; ${requestCount} selected request schemas; ${responseCount} selected response contracts.`);
