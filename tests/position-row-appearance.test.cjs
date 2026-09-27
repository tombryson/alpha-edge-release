const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const file = path.join(__dirname, '../lib/position-row-appearance.ts');
const compiled = new Module(file, module);
compiled._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { emptyRowPreferences, parseRowPreferences, positionRowClassKey, resolveRowIcon, rowIconUsesClassColour, ROW_ICON_CATALOGUE, ROW_EMBLEMS, rowIconForClass } = compiled.exports;

test('fresh preferences retain the existing neutral row with no icon', () => {
    assert.deepEqual(emptyRowPreferences(), { version: 3, icons: {} });
    const a = emptyRowPreferences();
    a.icons.GOLD_MINERS = 'gem';
    assert.deepEqual(emptyRowPreferences().icons, {});
});

test('icons are class-specific and survive label/order changes', () => {
    const settings = emptyRowPreferences();
    settings.icons.GOLD_MINERS = 'gem';
    const saved = parseRowPreferences(JSON.stringify(settings));
    assert.equal(resolveRowIcon(saved, ' gold_miners '), 'gem');
    assert.equal(resolveRowIcon(saved, 'SILVER_MINERS'), 'none');
});

test('custom codes remain distinct; names, selectors and prototype keys are not accepted', () => {
    assert.equal(positionRowClassKey('MY_CLASS'), 'MY_CLASS');
    assert.notEqual(positionRowClassKey('MY_CLASS'), positionRowClassKey('MYCLASS'));
    for (const code of ['', 'my class', '__proto__', 'Gold; color:red', 'x'.repeat(97)]) assert.equal(positionRowClassKey(code), '');
    assert.deepEqual(parseRowPreferences('{"version":1,"overrides":{"__proto__":{"emblem":"gem"}}}').icons, {});
});

test('invalid and future preferences recover without emitting CSS or unsafe icon sources', () => {
    for (const input of [null, '{', 'null', '[]', '{"version":4}', '{"version":1,"overrides":null}']) {
        assert.deepEqual(parseRowPreferences(input), emptyRowPreferences());
    }
    const unsafe = parseRowPreferences('{"version":2,"icons":{"GOLD_MINERS":"<svg>","__proto__":"gem"}}');
    assert.deepEqual(unsafe.icons, {});
});

test('settings contain icons only, never borders, financial data or a second colour store', () => {
    const settings = parseRowPreferences(JSON.stringify({ version: 3, defaults: { border: 'rule', target: 100, colour: '#ff0000' }, colours: { GOLD_MINERS: '#ff0000' } }));
    assert.deepEqual(settings, emptyRowPreferences());
});

test('v1 migration drops backgrounds/global icons but retains explicit per-class choices', () => {
    const saved = parseRowPreferences(JSON.stringify({ version: 1,
        defaults: { shade: 'tint', intensity: 18, border: 'rule', emblem: 'energy' },
        overrides: { GOLD_MINERS: { shade: 'soft', border: 'accent', emblem: 'gem' }, SILVER_MINERS: { emblem: 'none' } },
    }));
    assert.deepEqual(saved, { version: 3, icons: { GOLD_MINERS: 'gem' } });
    assert.equal(resolveRowIcon(saved, 'ENERGY_PRODUCERS'), 'none');
    assert.deepEqual(parseRowPreferences(JSON.stringify(saved)), saved);
});

test('v2 migration removes borders while preserving every explicit icon', () => {
    const saved = parseRowPreferences(JSON.stringify({ version: 2, defaults: { border: 'rule' }, overrides: { GOLD_MINERS: { border: 'accent' } }, icons: { GOLD_MINERS: 'gold', SILVER_MINERS: 'silver' } }));
    assert.deepEqual(saved, { version: 3, icons: { GOLD_MINERS: 'gold', SILVER_MINERS: 'silver' } });
});

test('class-colour icons are opt-in per class and store no independent colour values', () => {
    assert.equal(rowIconUsesClassColour(emptyRowPreferences(), 'GOLD_MINERS'), false);
    const saved = parseRowPreferences(JSON.stringify({ version: 3, icons: { GOLD_MINERS: 'gold' },
        classColourIcons: { gold_miners: true, SILVER_MINERS: false, MY_CLASS: true, ENERGY_PRODUCERS: '#ff0000', TECHNOLOGY: 'true', 'Invalid code': true },
    }));
    assert.deepEqual(saved.classColourIcons, { GOLD_MINERS: true, MY_CLASS: true });
    assert.equal(rowIconUsesClassColour(saved, ' gold_miners '), true);
    assert.equal(rowIconUsesClassColour(saved, 'SILVER_MINERS'), false);
    assert.equal(rowIconUsesClassColour(saved, 'MYCLASS'), false);
    assert.equal(resolveRowIcon(saved, 'GOLD_MINERS'), 'gold');
    assert.deepEqual(parseRowPreferences(JSON.stringify(saved)), saved);
    assert.deepEqual(parseRowPreferences('{"version":3,"classColourIcons":{"__proto__":true}}'), emptyRowPreferences());
    assert.equal(rowIconUsesClassColour(parseRowPreferences('{"version":2,"classColourIcons":{"GOLD_MINERS":true}}'), 'GOLD_MINERS'), false);
});

test('icon catalogue covers every shared class identity with more symbols than classes', () => {
    const identityFile = path.join(__dirname, '../lib/asset-class-identity.ts');
    const identity = new Module(identityFile, module);
    identity._compile(ts.transpileModule(fs.readFileSync(identityFile, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, identityFile);
    const { ASSET_CLASS_IDENTITIES, assetClassColourKey } = identity.exports;
    const codes = Object.keys(ASSET_CLASS_IDENTITIES);
    const icons = ROW_ICON_CATALOGUE.filter(option => !['auto', 'none'].includes(option.value));
    assert.ok(icons.length >= codes.length);
    assert.equal(new Set(ROW_EMBLEMS).size, ROW_EMBLEMS.length);
    const mapped = ROW_ICON_CATALOGUE.flatMap(option => option.classes || []);
    assert.equal(new Set(mapped).size, mapped.length, 'one explicit automatic mapping per canonical class');
    for (const code of codes) {
        assert.ok(mapped.includes(code), `Missing automatic icon for ${code}`);
        const choice = rowIconForClass(code);
        assert.ok(icons.some(option => option.value === choice));
        const settings = emptyRowPreferences();
        settings.icons[code] = choice;
        assert.equal(resolveRowIcon(parseRowPreferences(JSON.stringify(settings)), code), choice);
    }
    for (const [alias, expected] of [['GOLD', 'gold'], ['SILVER', 'silver'], ['URANIUM_MINERS', 'uranium'], ['LITHIUM_MINERS', 'lithium'], ['DATA_CENTERS', 'data-centres'], ['PHARMA', 'pharma']]) {
        assert.equal(rowIconForClass(assetClassColourKey(alias)), expected);
    }
    assert.equal(rowIconForClass('CUSTOM_UNKNOWN'), 'global');
});
