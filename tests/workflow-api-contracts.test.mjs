import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import Ajv2020 from 'ajv/dist/2020.js';
import { workflowContracts, workflowSchemas } from '../scripts/workflow-api-contracts.mjs';
import { hardeningContracts } from '../scripts/hardening-api-contracts.mjs';

const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const validator = schema => ajv.compile({ ...schema, components: { schemas: workflowSchemas } });
const apiContracts = JSON.parse(readFileSync(new URL('../DOCS/api/contracts.json', import.meta.url), 'utf8'));

test('real authenticated SQLite workflow responses conform to published contracts', { timeout: 120000 }, t => {
  const directory = mkdtempSync(join(tmpdir(), 'alpha-edge-contracts-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  execFileSync('go', ['test', '.', '-run', '^Test(WorkflowContract|SourceResearchHTTPContract)', '-count=1'], {
    cwd: resolve('backend'), env: { ...process.env, ALPHA_EDGE_CONTRACT_CAPTURE_DIR: directory },
    stdio: 'pipe', timeout: 110000,
  });
  const captures = ['workflow.json', 'source-research.json'].flatMap(file => JSON.parse(readFileSync(join(directory, file), 'utf8')));
  assert.ok(captures.length >= 20);
  for (const capture of captures) {
    const path = capture.path.split('?')[0].replace(/\/security-actions\/\d+\//, '/security-actions/{id}/')
      .replace(/\/source-research\/jobs\/[^/]+/, '/source-research/jobs/{id}')
      .replace(/\/statements\/\d+\/revisions\/\d+/, '/statements/{id}/revisions/{revision}')
      .replace(/\/statements\/\d+\/revisions/, '/statements/{id}/revisions');
    const key = `${capture.method} ${path}`;
    const contract = workflowContracts[key] || hardeningContracts[key] || apiContracts[key];
    assert.ok(contract, `missing contract: ${key}`);
    if (capture.status < 400 && contract.requestBody) {
      const validate = validator(contract.requestBody.content['application/json'].schema);
      assert.ok(validate(capture.request), `${key} request: ${JSON.stringify(validate.errors)}`);
    }
    const response = contract.responses[capture.status];
    assert.ok(response, `${key} undocumented status ${capture.status}`);
    const media = capture.content_type.split(';')[0];
    assert.ok(response.content[media], `${key}: incorrect response media ${media}`);
    const payload = media === 'application/json' ? JSON.parse(capture.response) : capture.response;
    const validate = validator(response.content[media].schema);
    assert.ok(validate(payload), `${key} ${capture.status}: ${JSON.stringify(validate.errors)}`);
  }
});

test('request schemas reject missing statement fields and malformed execution amounts', () => {
  const execution = validator({ $ref: '#/components/schemas/SecurityExecution' });
  for (const payload of [{}, { units: 10 }, { units: null }, { units: 10, cash_value: 50, exception_reason: 'Reported broker fill' }]) assert.equal(execution(payload), true);
  for (const payload of [{ units: 0 }, { units: -1 }, { units: 'ten' }, { cash_value: 50 }, { exception_reason: 'reason' }, { units: null, cash_value: 50, exception_reason: 'reason' }]) assert.equal(execution(payload), false);
  const statement = validator({ $ref: '#/components/schemas/StatementImport' });
  assert.equal(statement({ account: { account_name: 'IG', statement_date: '2026-09-01T00:00:00Z', total_value_aud: 100, cash_aud: 100 }, holdings: [] }), true);
  for (const payload of [{}, { account: {}, holdings: [] }, { account: { account_name: 'IG', statement_date: '2026-09-01T00:00:00Z', total_value_aud: 100, cash_aud: 100 }, holdings: null }]) assert.equal(statement(payload), false);
});
