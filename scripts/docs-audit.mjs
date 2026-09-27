#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import SwaggerParser from '@apidevtools/swagger-parser';
import { walk, markdownFacts } from './docs-lib.mjs';

export function checkMarkdown(root, files) {
  const errors = [];
  let linkCount = 0;
  const facts = new Map();
  const getFacts = path => {
    if (!facts.has(path)) facts.set(path, markdownFacts(readFileSync(path, 'utf8')));
    return facts.get(path);
  };
  for (const file of files) {
    const absolute = resolve(root, file);
    const text = readFileSync(absolute, 'utf8');
    if (/\/Users\/|file:\/\//.test(text)) errors.push(`${file}: machine-specific path`);
    for (const href of getFacts(absolute).links) {
      if (/^(https?:|mailto:)/.test(href)) continue;
      linkCount++;
      let decoded;
      try { decoded = decodeURIComponent(href); } catch { errors.push(`${file}: malformed link ${href}`); continue; }
      const [path, anchor] = decoded.split('#');
      const target = resolve(dirname(absolute), path || '.');
      const destination = path ? target : absolute;
      if (relative(root, destination).startsWith('..') || path.startsWith('/')) {
        errors.push(`${file}: non-portable link ${href}`); continue;
      }
      if (!existsSync(destination)) { errors.push(`${file}: missing ${href}`); continue; }
      if (anchor && /^L\d+(?:-L?\d+)?$/.test(anchor)) {
        const lines = readFileSync(destination, 'utf8').split('\n').length;
        if ([...anchor.matchAll(/\d+/g)].some(match => Number(match[0]) > lines)) errors.push(`${file}: stale source line ${href}`);
      } else if (anchor && extname(destination) === '.md' && !getFacts(destination).anchors.has(anchor)) {
        errors.push(`${file}: missing heading ${href}`);
      }
    }
  }
  return { errors, linkCount };
}

async function main() {
  const root = process.cwd();
  const docs = walk('DOCS').filter(file => file.endsWith('.md'));
  const files = ['README.md', ...docs];
  const result = checkMarkdown(root, files);
  for (const folder of ['system', 'api', 'user', 'operations', 'development', 'decisions', 'archive']) {
    const index = `DOCS/${folder}/README.md`;
    if (!existsSync(index)) { result.errors.push(`Missing index ${index}`); continue; }
    const indexTargets = new Set(markdownFacts(readFileSync(index, 'utf8')).links.map(link => resolve(dirname(index), decodeURIComponent(link.split('#')[0]))));
    for (const doc of docs.filter(file => dirname(file) === `DOCS/${folder}` && file !== index)) {
      if (!indexTargets.has(resolve(doc))) result.errors.push(`${doc}: missing from its directory index`);
    }
  }
  for (const file of docs.filter(file => /DOCS\/(archive|decisions)\//.test(file) && !file.endsWith('/README.md'))) {
    if (!readFileSync(file, 'utf8').split('\n').slice(0, 12).some(line => /^> (Historical|Design record)/.test(line))) result.errors.push(`${file}: missing status banner`);
  }
  const webhook = readFileSync('DOCS/api/WEBHOOK_CONTRACT.md', 'utf8');
  if (!webhook.includes('POST /api/webhook/regime') || !webhook.includes('POST /api/webhook/etf-rebalance') || webhook.includes('/api/webhook/q4-crisis')) result.errors.push('Webhook routing contract regressed.');
  for (const error of result.errors) console.error(error);
  if (result.errors.length) throw new Error(`${result.errors.length} documentation errors.`);
  execFileSync(process.execPath, ['scripts/generate-api-docs.mjs', '--check'], { stdio: 'inherit' });
  execFileSync(process.execPath, ['scripts/generate-help-docs.mjs', '--check'], { stdio: 'inherit' });
  await SwaggerParser.validate(JSON.parse(readFileSync('DOCS/api/openapi.json', 'utf8')), { resolve: { external: false } });
  console.log(`Docs audit passed: ${files.length} Markdown files, ${result.linkCount} local links, indexes, archive status, route parity, generated Help and OpenAPI validation. External URLs were not fetched.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
