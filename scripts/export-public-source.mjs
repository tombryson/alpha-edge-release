#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { marked } from 'marked';
import { excludedFromPublic, linksToOmitted, unsafePath } from './publication-policy.mjs';

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { maxBuffer: 64 * 1024 * 1024 });
}

export function exportPublicSource(root, destination, revision = 'HEAD') {
  root = realpathSync(root);
  destination = resolve(destination);
  const parent = realpathSync(dirname(destination));
  destination = resolve(parent, relative(dirname(destination), destination));
  const inside = relative(root, destination);
  if (!inside || (inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside)) || existsSync(destination) || existsSync(`${destination}.manifest.json`)) {
    throw new Error('Use a new destination outside the source checkout; existing directories are never overwritten.');
  }
  const commit = git(root, ['rev-parse', '--verify', `${revision}^{commit}`]).toString().trim();
  const tree = git(root, ['ls-tree', '-rz', commit]).toString().split('\0').filter(Boolean).map(entry => {
    const [metadata, path] = entry.split('\t');
    const [mode, type, oid] = metadata.split(' ');
    if (type !== 'blob' || !['100644', '100755'].includes(mode) || unsafePath(path)) {
      throw new Error(`Unpublishable entry: ${path}`);
    }
    return { path, mode, oid };
  });
  const overrides = new Map(tree.filter(entry => entry.path.startsWith('publication/overrides/'))
    .map(entry => [entry.path.slice('publication/overrides/'.length), entry]));
  const omitted = new Set(tree.filter(entry => excludedFromPublic(entry.path) && !overrides.has(entry.path)).map(entry => entry.path));
  const files = new Map(tree.filter(entry => !omitted.has(entry.path) && !entry.path.startsWith('publication/')).map(entry => [entry.path, entry]));
  for (const [path, entry] of overrides) files.set(path, entry);
  const manifest = [];
  const prepared = [];
  for (const [path, entry] of files) {
    let contents = git(root, ['cat-file', 'blob', entry.oid]);
    if (path.endsWith('.md')) {
      // Index entries (list items and table rows led by a link) to omitted files
      // are dropped; other links to omitted files keep only their text.
      const indexEntry = /^\s*(?:[-*+]|\d+\.)\s+\[[^\]]*\]\(([^)\s]+)[^)]*\)|^\s*\|\s*\[[^\]]*\]\(([^)\s]+)[^)]*\)/;
      const text = contents.toString('utf8').split('\n').filter(line => {
        const match = line.match(indexEntry);
        return !match || !linksToOmitted(path, match[1] || match[2], omitted);
      }).join('\n');
      const replacements = new Map();
      marked.walkTokens(marked.lexer(text), token => {
        if (token.type !== 'link' && token.type !== 'image') return;
        if (linksToOmitted(path, token.href, omitted)) replacements.set(token.raw, token.text);
      });
      let updated = text;
      for (const [before, after] of replacements) updated = updated.split(before).join(after);
      contents = Buffer.from(updated);
    }
    prepared.push({ path, contents, mode: entry.mode === '100755' ? 0o700 : 0o600 });
    manifest.push({ path, sha256: createHash('sha256').update(contents).digest('hex') });
  }
  // Nothing from .git, untracked files, local environment or deployment logs is copied.
  mkdirSync(destination, { mode: 0o700 });
  for (const file of prepared) {
    const target = resolve(destination, file.path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, file.contents, { flag: 'wx', mode: file.mode });
  }
  const report = { sourceCommit: commit, files: manifest, excluded: [...omitted].sort() };
  writeFileSync(`${destination}.manifest.json`, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const destination = process.argv[2];
    if (!destination) throw new Error('Usage: node scripts/export-public-source.mjs NEW_EXTERNAL_DIRECTORY [COMMIT]');
    const report = exportPublicSource(process.cwd(), destination, process.argv[3] || 'HEAD');
    console.log(`Prepared ${report.files.length} files; excluded ${report.excluded.length} private records. No repository was published.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
