const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const ts = require('typescript');

function load(file) {
    const exports = {};
    new Function('exports', ts.transpileModule(readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText)(exports);
    return exports;
}
const { fillResearchPrompt, fillWebUIResearchPrompt } = load('lib/research-prompts.ts');
const { extractCopyPastePrompt } = load('lib/prompt-yaml.ts');
const directory = 'public/enrichment-prompts/copy-paste-research-prompts';
const identity = { name: 'Ricegrowers Limited', ticker: 'ASX:SGLLV', exchange: 'ASX' };

test('all Web UI rubrics resolve company and exchange and include an unambiguous ticker', () => {
    const files = readdirSync(directory).filter(file => file.endsWith('.yaml'));
    assert.ok(files.length >= 47);
    for (const file of files) {
        const source = extractCopyPastePrompt(readFileSync(`${directory}/${file}`, 'utf8'));
        assert.ok(source, file);
        const prompt = fillWebUIResearchPrompt(source, identity);
        assert.ok(prompt.includes(identity.name), file);
        assert.ok(prompt.includes('- Exchange: ASX.'), file);
        assert.ok(prompt.includes('- Ticker: ASX:SGLLV.'), file);
        assert.doesNotMatch(prompt, /\[COMPANY_NAME\]|\[EXCHANGE_CODE\]|\[TICKER\]|listing venue not preselected/, file);
        assert.equal(fillWebUIResearchPrompt(prompt, identity), prompt, `${file}: repeat filling must not duplicate the ticker`);
    }
});

test('agriculture uses the complete original investment rubric, changing only identity context', () => {
    const source = extractCopyPastePrompt(readFileSync(`${directory}/agriculture_agribusiness.yaml`, 'utf8'));
    const prompt = fillWebUIResearchPrompt(source, identity);
    assert.match(prompt, /- Template: agriculture_agribusiness/);
    assert.match(prompt, /- Company type: agriculture_agribusiness/);
    const expected = fillResearchPrompt(source, identity);
    assert.equal(prompt.replace('\n- Ticker: ASX:SGLLV.', '')
        .replace('Exchange profile: ASX.', 'Exchange profile: listing venue not preselected.'), expected);
    assert.equal(fillWebUIResearchPrompt(source), source, 'the global library stays generic without a selected security');
});

test('ticker normalization does not duplicate exchange prefixes or interpret replacement tokens in names', () => {
    const source = '- Company name: [COMPANY_NAME].\n- Exchange: [EXCHANGE_CODE].\nResearch [COMPANY_NAME] ([EXCHANGE_CODE]:[TICKER]).';
    const filled = fillWebUIResearchPrompt(source, { ...identity, name: 'A $& Holdings' });
    assert.equal(filled.match(/A \$& Holdings/g).length, 2);
    assert.doesNotMatch(filled, /ASX:ASX:/);
    assert.equal(fillWebUIResearchPrompt(source, { ...identity, ticker: 'SGLLV' }), fillWebUIResearchPrompt(source, identity));
});
