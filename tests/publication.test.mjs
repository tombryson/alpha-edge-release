import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportPublicSource } from '../scripts/export-public-source.mjs';
import { unsafePath } from '../scripts/publication-policy.mjs';
import { checkFiles } from '../scripts/check-publication.mjs';

function fixture(t) {
  const folder = mkdtempSync(join(tmpdir(), 'publication-test-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const source = join(folder, 'source');
  mkdirSync(source);
  const git = (...args) => execFileSync('git', ['-C', source, ...args], { stdio: 'pipe' });
  git('init', '-b', 'main');
  git('config', 'user.name', 'Publication Test');
  git('config', 'user.email', 'test@example.invalid');
  const put = (path, value) => { mkdirSync(join(source, path, '..'), { recursive: true }); writeFileSync(join(source, path), value); };
  const commit = () => { git('add', '.'); git('commit', '-m', 'Synthetic test'); };
  put('README.md', '# Product\n[Private record](DOCS/archive/private.md)\n');
  put('DOCS/archive/private.md', 'Synthetic private record - must not export');
  put('publication/overrides/DOCS/archive/README.md', '# Archive\nNot distributed.\n');
  put('vercel.json', JSON.stringify({ git: { deploymentEnabled: false } }));
  commit();
  return { folder, source, git, put, commit, output: join(folder, 'output') };
}

test('exports only committed source, excludes private history and uses reviewed overrides', t => {
  const f = fixture(t);
  f.put('.env.local', 'UNTRACKED=test-only');
  f.put('README.md', 'Uncommitted change');
  const result = exportPublicSource(f.source, f.output);
  assert.ok(!existsSync(join(f.output, '.git')));
  assert.ok(!existsSync(join(f.output, '.env.local')));
  assert.ok(!existsSync(join(f.output, 'DOCS/archive/private.md')));
  assert.ok(!existsSync(join(f.output, 'publication')));
  const readme = readFileSync(join(f.output, 'README.md'), 'utf8');
  assert.match(readme, /Private record/);
  assert.doesNotMatch(readme, /DOCS\/archive\/private\.md|\]\(/, 'links to omitted records become plain text');
  assert.match(readFileSync(join(f.output, 'DOCS/archive/README.md'), 'utf8'), /Not distributed/);
  assert.ok(result.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256)));
  assert.ok(existsSync(`${f.output}.manifest.json`));
});

test('refuses existing destinations, source descendants and symlink entries', t => {
  const f = fixture(t);
  assert.throws(() => exportPublicSource(f.source, f.source), /outside/);
  assert.throws(() => exportPublicSource(f.source, join(f.source, 'output')), /outside/);
  mkdirSync(f.output);
  assert.throws(() => exportPublicSource(f.source, f.output), /outside/);
  symlinkSync('README.md', join(f.source, 'link.md'));
  f.commit();
  assert.throws(() => exportPublicSource(f.source, join(f.folder, 'other')), /Unpublishable/);
});

test('rejects credentials, dumps and disguised databases without printing their content', t => {
  const f = fixture(t);
  for (const path of ['.env', '.env.production', 'backend/trading.db', 'snapshot.sqlite3', 'backup.sql', 'key.pem', '.git/config', '../outside', '/tmp/outside']) assert.ok(unsafePath(path), path);
  f.put('payload.txt', 'SQLite format 3\0synthetic');
  f.put('backend/internal/database/testdata/schema.sql', 'INSERT INTO positions VALUES (1);');
  const errors = checkFiles(f.source, [
    { path: 'payload.txt', mode: '100644' },
    { path: 'backend/internal/database/testdata/schema.sql', mode: '100644' },
  ]);
  assert.ok(errors.some(error => error.includes('SQLite database')));
  assert.ok(errors.some(error => error.includes('schema-only')));
  assert.ok(errors.some(error => error.includes('unreviewed binary')));
  assert.ok(!errors.join().includes('VALUES'));
  f.put('backup.sql', 'Synthetic dump');
  f.commit();
  assert.throws(() => exportPublicSource(f.source, f.output), /Unpublishable/);
  assert.ok(!existsSync(f.output));
});

test('rejects competing package-manager lockfiles', t => {
  const f = fixture(t);
  for (const path of ['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'frontend/bun.lockb']) {
    f.put(path, 'Synthetic obsolete dependency graph');
    const errors = checkFiles(f.source, [{ path, mode: '100644' }]);
    assert.ok(errors.some(error => error.includes('use package-lock.json only')), path);
  }
});

test('keeps PineScript sources and private logs out of the export', t => {
  const f = fixture(t);
  f.put('DOCS/Pinescripts/Strategy.pine', '// synthetic strategy');
  f.put('DOCS/development/TESTING_LOG.md', 'Synthetic log');
  f.put('DOCS/api/SCRIPTS.md', '# Scripts\nSee the [sources](../Pinescripts/Strategy.pine) and the [folder](../Pinescripts/).\n\n- [Strategy source](../Pinescripts/Strategy.pine) - private\n- [Webhooks](WEBHOOKS.md) - public\n\n| Guide | Purpose |\n| --- | --- |\n| [Log](../development/TESTING_LOG.md) | private |\n');
  f.commit();
  const result = exportPublicSource(f.source, f.output);
  assert.ok(!existsSync(join(f.output, 'DOCS/Pinescripts')));
  assert.ok(!existsSync(join(f.output, 'DOCS/development/TESTING_LOG.md')));
  assert.ok(result.excluded.includes('DOCS/Pinescripts/Strategy.pine'));
  assert.equal(readFileSync(join(f.output, 'DOCS/api/SCRIPTS.md'), 'utf8'), '# Scripts\nSee the sources and the folder.\n\n- [Webhooks](WEBHOOKS.md) - public\n\n| Guide | Purpose |\n| --- | --- |\n', 'index entries to omitted files are dropped');
});
