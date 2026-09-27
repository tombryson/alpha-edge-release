import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const load = path => {
    const exports = {};
    runInNewContext(ts.transpileModule(readFileSync(new URL(path, root), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports });
    return exports;
};
const { ENRICHMENT_TEMPLATES } = load('lib/enrichment-templates.ts');
const { sourceOnlyInstructions } = load('lib/research-prompts.ts');
const templates = ENRICHMENT_TEMPLATES.filter(t => t.kind === 'retrieval_brief').map(t => {
    const text = readFileSync(new URL(`public${t.path}`, root), 'utf8');
    const fenced = text.match(/```text\s*\n([\s\S]*?)```/);
    if (!fenced) throw new Error(`Missing retrieval instructions: ${t.id}`);
    const prompt = sourceOnlyInstructions(fenced[1].trim(), t.templateIds[0]);
    return { id: t.templateIds[0], label: t.label.replace(/ Brief$/, ''), prompt,
        version: createHash('sha256').update(prompt).digest('hex') };
});
if (new Set(templates.map(t => t.id)).size !== templates.length) throw new Error('Duplicate research template');
const path = new URL('backend/research-catalogue.json', root);
const output = JSON.stringify(templates, null, 2) + '\n';
if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8') !== output) throw new Error('Run npm run research:generate');
} else writeFileSync(path, output);
console.log(`${templates.length} research templates: ${fileURLToPath(path)}`);
