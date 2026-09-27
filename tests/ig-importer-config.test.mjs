import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../backend/google_apps_script/ig_statement_sync.gs', import.meta.url), 'utf8');
function context(properties = {}) {
  const state = vm.createContext({ PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties[key] }) } });
  vm.runInContext(source, state);
  return state;
}
test('importer requires private Script Properties and never falls back to an owner identity', () => {
  const state = context();
  for (const expression of ['IG_SYNC_CONFIG.SPREADSHEET_ID', 'IG_SYNC_CONFIG.API_ENDPOINT', 'requiredIGProperty("IG_STATEMENT_GMAIL_QUERY")']) {
    assert.throws(() => vm.runInContext(expression, state), /Script Property/);
  }
});
test('importer accepts configured identities and rejects credential-bearing or insecure URLs', () => {
  const state = context({ IG_SPREADSHEET_ID: 'synthetic-sheet', IG_TERMINAL_API_ENDPOINT: 'https://terminal.example.invalid/api/statements/import', IG_STATEMENT_GMAIL_QUERY: 'from:broker@example.invalid subject:"Statement"' });
  assert.equal(vm.runInContext('IG_SYNC_CONFIG.SPREADSHEET_ID', state), 'synthetic-sheet');
  assert.equal(vm.runInContext('IG_SYNC_CONFIG.API_ENDPOINT', state), 'https://terminal.example.invalid/api/statements/import');
  for (const url of ['http://example.invalid/api/statements/import', 'https://user:password@example.invalid/api/statements/import', 'https://example.invalid/api/statements/import?token=synthetic']) {
    assert.throws(() => vm.runInContext('IG_SYNC_CONFIG.API_ENDPOINT', context({ IG_TERMINAL_API_ENDPOINT: url })), /HTTPS statement-import/);
  }
});
