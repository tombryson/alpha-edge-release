import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { marked } from 'marked';
import GithubSlugger from 'github-slugger';

export function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }).sort();
}

export function routesFromSource() {
  const routes = JSON.parse(execFileSync('go', ['run', './backend/cmd/route-manifest/main.go'], { encoding: 'utf8' }))
    .map(route => ({ ...route, service: 'terminal', source: 'backend/routes.go' }));
  for (const file of walk('app/api/council').filter(file => file.endsWith('/route.ts'))) {
    const text = readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    for (const node of source.statements) {
      if (!node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword)) continue;
      const names = ts.isFunctionDeclaration(node) ? [node.name?.text] : ts.isVariableStatement(node)
        ? node.declarationList.declarations.map(declaration => declaration.name.getText(source)) : [];
      for (const method of names.filter(name => /^(GET|POST|PUT|PATCH|DELETE|HEAD)$/.test(name))) {
        const path = file.replace(/^app/, '').replace(/\/route.ts$/, '').replace(/\[([^\]]+)\]/g, '{$1}');
        routes.push({ method, path, handler: method, service: 'council-proxy', source: file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
      }
    }
  }
  const keys = new Set();
  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    if (keys.has(key)) throw new Error(`Duplicate route ${key}`);
    keys.add(key);
  }
  return routes.sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
}

export function markdownFacts(text) {
  const links = [];
  const anchors = new Set();
  const slugger = new GithubSlugger();
  const tokens = marked.lexer(text);
  marked.walkTokens(tokens, token => {
    if (token.type === 'link' || token.type === 'image') links.push(token.href);
    if (token.type === 'heading') anchors.add(slugger.slug(token.text.replace(/<[^>]+>/g, '').replace(/[`*_]/g, '')));
    if (token.type === 'html') {
      for (const match of token.text.matchAll(/(?:id|name)=["']([^"']+)["']/g)) anchors.add(match[1]);
    }
  });
  return { links, anchors };
}
