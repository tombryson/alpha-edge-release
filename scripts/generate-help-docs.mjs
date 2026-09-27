import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { marked } from 'marked';
import GithubSlugger from 'github-slugger';

const check = process.argv.includes('--check');
const sections = JSON.parse(readFileSync('DOCS/user/sections.json', 'utf8'));
const paths = JSON.parse(readFileSync('DOCS/user/paths.json', 'utf8'));
const hrefs = new Map(sections.map(section => [section.file, `#/help/${section.id === 'overview' ? '' : section.id}`.replace(/\/$/, '')]));
export function inline(tokens, links = hrefs) {
  return tokens.map(token => {
    if (token.type === 'text' || token.type === 'escape') return { type: 'text', text: token.text };
    if (token.type === 'codespan') return { type: 'code', text: token.text };
    if (token.type === 'strong' || token.type === 'em') return { type: token.type, children: inline(token.tokens, links) };
    if (token.type === 'link') {
      const href = links.get(token.href);
      if (!href && !/^https:\/\//.test(token.href)) throw new Error(`Unsupported Help link: ${token.href}`);
      return { type: 'link', href: href || token.href, children: inline(token.tokens, links) };
    }
    throw new Error(`Unsupported Help inline token ${token.type}; extend the renderer explicitly.`);
  });
}
const plain = tokens => tokens.map(token => token.tokens ? plain(token.tokens) : token.text || '').join('');
const result = sections.map(section => {
  const slugger = new GithubSlugger();
  const tokens = marked.lexer(readFileSync(`DOCS/user/${section.file}`, 'utf8')).filter(token => token.type !== 'space');
  const title = tokens.shift();
  const intro = tokens.shift();
  if (title.type !== 'heading' || title.depth !== 1 || intro.type !== 'paragraph') throw new Error(`${section.file}: use one H1 and an introductory paragraph.`);
  const blocks = tokens.map(token => {
    if (token.type === 'heading' && token.depth === 2) return { type: 'heading', text: plain(token.tokens), id: slugger.slug(plain(token.tokens)) };
    if (token.type === 'paragraph') {
      if (token.tokens.length === 1 && token.tokens[0].type === 'image') {
        const image = token.tokens[0];
        const id = Object.keys(paths).find(id => image.href === `../../public/help/${id}.svg`);
        if (!id) throw new Error(`Unknown Help diagram ${image.href}`);
        return { type: 'diagram', id, ...paths[id] };
      }
      return { type: 'paragraph', children: inline(token.tokens) };
    }
    if (token.type === 'list') return { type: 'list', ordered: token.ordered, items: token.items.map(item => {
      if (item.tokens.length !== 1 || item.tokens[0].type !== 'text') throw new Error('Help lists must be flat paragraphs.');
      return inline(item.tokens[0].tokens);
    }) };
    throw new Error(`Unsupported Help block ${token.type} in ${section.file}.`);
  });
  return { id: section.id, label: section.label, title: plain(title.tokens), body: plain(intro.tokens), blocks };
});
const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const output = (file, value) => {
  if (check) {
    if (readFileSync(file, 'utf8') !== value) throw new Error(`${file} is stale; run npm run docs:generate.`);
  } else writeFileSync(file, value);
};
if (!check) mkdirSync('public/help', { recursive: true });
for (const [id, path] of Object.entries(paths)) {
  const width = (path.nodes.length + (path.result ? 1 : 0)) * 120;
  const last = path.nodes.length * 120 - 60;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="90" viewBox="0 0 ${width} 90" role="img" aria-label="${xml(path.label)}"><rect width="${width}" height="90" fill="#f6f8fa"/><g fill="#16813c" stroke="#16813c">${path.nodes.map((name, i) => {
    const x = i * 120 + 60;
    return `${i > 0 ? `<path d="M${x - 120} 30H${x}" fill="none" stroke-width="2"/>` : ''}<rect x="${x - 7}" y="23" width="14" height="14" rx="2"/><text x="${x}" y="66" text-anchor="middle" stroke="none" fill="#24292f" font-family="sans-serif" font-size="12">${xml(name)}</text>`;
  }).join('')}${path.result ? `<path d="M${last} 30H${last + 45}" stroke-width="2"/><text x="${last + 55}" y="35" stroke="none" font-family="sans-serif" font-size="12">${xml(path.result)}</text>` : ''}</g></svg>\n`;
  output(`public/help/${id}.svg`, svg);
}
output('lib/help-content.generated.ts', `// Generated from DOCS/user/*.md by npm run docs:generate. Do not edit.\nimport type { HelpSection } from './help-content';\n\nexport const HELP_SECTIONS: HelpSection[] = ${JSON.stringify(result, null, 2)};\n`);
console.log(`Help: ${result.length} shared guides; ${Object.keys(paths).length} diagrams.`);
