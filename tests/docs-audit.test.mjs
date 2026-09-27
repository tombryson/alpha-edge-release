import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { checkMarkdown } from '../scripts/docs-audit.mjs';
import { markdownFacts, routesFromSource } from '../scripts/docs-lib.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'alpha-edge-doc-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('checks Markdown links, duplicate headings, encoded paths and source lines', t => {
  const root = fixture(t);
  writeFileSync(join(root, 'Guide.md'), '# Guide\n\n## One\n\n## One\n');
  writeFileSync(join(root, 'source file.ts'), 'first\nsecond\n');
  writeFileSync(join(root, 'README.md'), '[Guide](Guide.md#one-1)\n[Source](source%20file.ts#L2)\n[Markdown source](Guide.md#L2)\n');
  assert.deepEqual(checkMarkdown(root, ['README.md']).errors, []);
});

test('rejects missing files, bad anchors, stale line numbers and local machine paths', t => {
  const root = fixture(t);
  writeFileSync(join(root, 'Guide.md'), '# Guide\n');
  writeFileSync(join(root, 'README.md'), '[Missing](gone.md)\n[Heading](Guide.md#absent)\n[Line](Guide.md#L99)\n[Private](/Users/someone/private.md)\n[Escape](../secret.md)\n');
  const { errors } = checkMarkdown(root, ['README.md']);
  assert.equal(errors.length, 6);
  assert.ok(errors.some(error => error.includes('machine-specific')));
});

test('ignores apparent links inside fenced examples, parses real reference links', () => {
  const facts = markdownFacts('```text\n[not a link](missing.md)\n```\n\n[real][ref]\n\n[ref]: actual.md\n');
  assert.deepEqual(facts.links, ['actual.md']);
});

test('Go AST ignores comments, extracts wrappers and refuses unhandled registrations', t => {
  const root = fixture(t);
  const file = join(root, 'routes.go');
  writeFileSync(file, 'package main\nfunc routes() {\n// router.HandleFunc("/fake", fake).Methods("POST")\nrouter.HandleFunc("/real", wrap(handler)).Methods("GET", "OPTIONS")\n}\n');
  const args = ['run', './backend/cmd/route-manifest/main.go', '-source', file];
  const result = JSON.parse(execFileSync('go', args, { encoding: 'utf8' }));
  assert.deepEqual(result.map(row => [row.method, row.path, row.handler]), [['GET', '/real', 'wrap(handler)']]);
  writeFileSync(file, 'package main\nfunc routes() { router.HandleFunc("/unchecked", handler) }');
  assert.throws(() => execFileSync('go', args, { stdio: 'pipe' }));
});

test('generated OpenAPI accounts for the two service origins and actual routes', () => {
  const routes = routesFromSource();
  const spec = JSON.parse(readFileSync('DOCS/api/openapi.json', 'utf8'));
  const operations = Object.entries(spec.paths).flatMap(([path, methods]) => Object.keys(methods).map(method => `${method.toUpperCase()} ${path}`));
  assert.deepEqual(operations.sort(), routes.map(route => `${route.method} ${route.path}`).sort());
  assert.equal(routes.filter(route => route.service === 'council-proxy').length, 9);
  assert.equal(spec.paths['/api/health'].get.security.length, 0);
  assert.equal(spec.paths['/api/webhook/tradingview'].post.security.length, 2);
  assert.notEqual(spec.paths['/api/council/jobs'].get.servers[0].url, spec.paths['/api/health'].get.servers[0].url);
  assert.equal(spec.paths['/api/etf/core-policies/{assetClass}'].put['x-contract-level'], 'request-documented');
  assert.equal(spec.paths['/api/portfolio'].get['x-contract-level'], 'route-inventory');
});

test('all ten Help routes use generated task content and preserve market diagrams', () => {
  const source = ts.transpileModule(readFileSync('lib/help-content.generated.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function('exports', source)(exports);
  const sections = exports.HELP_SECTIONS;
  assert.equal(sections.length, 10);
  assert.equal(new Set(sections.map(section => section.id)).size, 10);
  assert.ok(sections.every(section => section.body && section.blocks.length >= 4));
  assert.ok(sections.some(section => section.id === 'news'));
  assert.ok(sections.some(section => section.id === 'history'));
  const market = sections.find(section => section.id === 'markets');
  assert.deepEqual(market.blocks.find(block => block.id === 'market-equity').nodes, ['Equity', 'Company', 'Outperform']);
  assert.ok(!JSON.stringify(sections).includes('dangerouslySetInnerHTML'));
  assert.ok(!JSON.stringify(sections).includes('/Users/'));
});

test('adding a route without an annotation fails generation', t => {
  const root = fixture(t);
  mkdirSync(join(root, 'backend/cmd/route-manifest'), { recursive: true });
  mkdirSync(join(root, 'app/api/council'), { recursive: true });
  mkdirSync(join(root, 'DOCS/api'), { recursive: true });
  cpSync('backend/cmd/route-manifest/main.go', join(root, 'backend/cmd/route-manifest/main.go'));
  writeFileSync(join(root, 'backend/routes.go'), 'package main\nfunc routes() { router.HandleFunc("/new", handler).Methods("GET") }');
  writeFileSync(join(root, 'DOCS/api/contracts.json'), '{}');
  assert.throws(() => execFileSync(process.execPath, [resolve('scripts/generate-api-docs.mjs'), '--check'], { cwd: root, stdio: 'pipe' }), error => error.stderr.toString().includes('Missing: GET /new'));
});

test('stale generated Help fails the offline check', t => {
  const root = fixture(t);
  mkdirSync(join(root, 'DOCS'), { recursive: true });
  mkdirSync(join(root, 'public'), { recursive: true });
  mkdirSync(join(root, 'lib'), { recursive: true });
  cpSync('DOCS/user', join(root, 'DOCS/user'), { recursive: true });
  cpSync('public/help', join(root, 'public/help'), { recursive: true });
  writeFileSync(join(root, 'lib/help-content.generated.ts'), '// stale');
  assert.throws(() => execFileSync(process.execPath, [resolve('scripts/generate-help-docs.mjs'), '--check'], { cwd: root, stdio: 'pipe' }), error => error.stderr.toString().includes('is stale'));
});
