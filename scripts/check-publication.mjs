#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { excludedFromPublic, unsafePath } from './publication-policy.mjs';

const assets = JSON.parse(readFileSync(new URL('./publication-assets.json', import.meta.url), 'utf8'));

export function checkFiles(root, entries) {
  const errors = [];
  for (const { path, mode } of entries) {
    if (/(^|\/)(pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/.test(path)) {
      errors.push(`${path}: npm is the supported package manager; use package-lock.json only`);
    }
    if (unsafePath(path) || !['100644', '100755'].includes(mode)) {
      errors.push(`${path}: credentials, data exports, links and submodules are not publishable`);
      continue;
    }
    const contents = readFileSync(resolve(root, path));
    if ((!isUtf8(contents) || contents.includes(0)) && assets[path] !== createHash('sha256').update(contents).digest('hex')) {
      errors.push(`${path}: unreviewed binary asset; inspect before updating publication-assets.json`);
    }
    if (contents.subarray(0, 16).toString() === 'SQLite format 3\0') errors.push(`${path}: SQLite database content`);
    if (!excludedFromPublic(path)) {
      const text = contents.toString();
      if (/\b[\w.+-]+@(?:gmail|outlook|hotmail|icloud)\.com\b/i.test(text)) errors.push(`${path}: personal email address requires privacy review`);
      if (/\/Users\/(?!example(?:\/|\b)|test(?:\/|\b))[^\s/`]+\//.test(text) && path !== 'tests/docs-audit.test.mjs') errors.push(`${path}: personal workstation path`);
      if (/(?:SPREADSHEET_ID|spreadsheetId)\s*:\s*['"][A-Za-z0-9_-]{25,}['"]/.test(text)) errors.push(`${path}: hard-coded private spreadsheet identifier`);
    }
    if (path.endsWith('.sql') && !/^(?:backend\/internal\/database\/(?:migrations|testdata)\/|tests\/uat\/(?:reset_uat_state|seed_commodity_theme_fixture|seed_fake_portfolio)\.sql$)/.test(path)) {
      errors.push(`${path}: SQL outside reviewed schema/migration/synthetic fixture locations`);
    }
    if (/^backend\/internal\/database\/testdata\//.test(path) && /\bINSERT\s+INTO\b/i.test(contents.toString())) {
      errors.push(`${path}: schema-only fixture contains rows`);
    }
  }
  const vercel = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8'));
  if (vercel.git?.deploymentEnabled !== false) errors.push('Automatic Vercel deployment must remain disabled');
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const entries = execFileSync('git', ['ls-files', '-s', '-z']).toString().split('\0').filter(Boolean).map(line => {
    const [metadata, path] = line.split('\t');
    return { path, mode: metadata.split(' ')[0] };
  });
  const errors = checkFiles(process.cwd(), entries);
  for (const error of errors) console.error(error);
  if (errors.length) process.exitCode = 1;
  else console.log(`Publication file guard passed: ${entries.length} tracked files. A privacy review and secret scan are still required.`);
}
