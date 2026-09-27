const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const build = '/tmp/alpha-edge-class-colours/lib';
const { ASSET_CLASS_IDENTITIES, ASSET_CLASS_COLOUR_VERSION, assetClassColor, assetClassDefaultColor, assetClassColourKey, assetClassGroupColor } = require(`${build}/asset-class-identity.js`);
const { classColourOverrides, classColourStyle, normaliseClassColour } = require(`${build}/asset-class-colour-settings.js`);
const { ASSET_CLASS_COLOUR_PRESETS } = require(`${build}/asset-class-colour-presets.js`);
const { getPortfolioAssetClassColor, PORTFOLIO_COMPACT_OTHER_COLOR } = require(`${build}/portfolio-composition-colors.js`);
const { buildPortfolioGroupDialModel } = require(`${build}/portfolio-group-dial.js`);
const { approvedShapeArchive, compareApprovedShapes } = require(`${build}/portfolio-shape-comparison.js`);
const { portfolioShapePreviewRows } = require(`${build}/portfolio-history-markers.js`);
const source = file => readFileSync(path.join(__dirname, '..', file), 'utf8');

test('the editor offers exactly 30 unique, named hex colours without changing class defaults', () => {
    assert.equal(ASSET_CLASS_COLOUR_PRESETS.length, 30);
    assert.equal(new Set(ASSET_CLASS_COLOUR_PRESETS.map(row => row.colour)).size, 30);
    assert.equal(new Set(ASSET_CLASS_COLOUR_PRESETS.map(row => row.name)).size, 30);
    for (const preset of ASSET_CLASS_COLOUR_PRESETS) {
        assert.ok(preset.name.trim());
        assert.equal(normaliseClassColour(preset.colour), preset.colour);
    }
    for (const [name, code] of [['Gold', 'GOLD_MINERS'], ['Silver', 'SILVER_MINERS'], ['Copper', 'COPPER_MINERS']]) {
        assert.equal(ASSET_CLASS_COLOUR_PRESETS.find(row => row.name === name).colour, assetClassDefaultColor(code));
    }
});

test('every class in the portfolio target catalogue has an explicit colour', () => {
    const file = ts.createSourceFile('taxonomy.ts', source('lib/portfolio-target-taxonomy.ts'), ts.ScriptTarget.Latest, true);
    const statement = file.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(file) === 'PORTFOLIO_TARGET_CLASSES'));
    const catalogue = statement.declarationList.declarations[0].initializer;
    assert.ok(ts.isArrayLiteralExpression(catalogue));
    for (const item of catalogue.elements) {
        const id = item.properties.find(property => property.name.getText(file) === 'id').initializer.text;
        assert.ok(ASSET_CLASS_IDENTITIES[id.toUpperCase()], `${id} must not depend on a fallback`);
    }
    for (const identity of Object.values(ASSET_CLASS_IDENTITIES)) assert.match(identity.color, /^#[\da-f]{6}$/);
    assert.equal(ASSET_CLASS_COLOUR_VERSION, 1);
});

test('intuitive metal identities survive legacy codes, punctuation and prefixes', () => {
    const expected = { GOLD_MINERS: '#d4a72c', SILVER_MINERS: '#c0c7d2', COPPER_MINERS: '#b87333' };
    for (const [code, colour] of Object.entries(expected)) {
        for (const alias of [code, code.toLowerCase(), code.replaceAll('_', ''), code.replace('_MINERS', ''), ` THEME:${code} `]) {
            assert.equal(assetClassColourKey(alias), code);
            assert.equal(assetClassDefaultColor(alias), colour);
            assert.equal(assetClassColor(alias), `var(--asset-class-colour-${code}, ${colour})`);
        }
    }
    for (const [code, identity] of Object.entries(ASSET_CLASS_IDENTITIES)) {
        for (const alias of identity.aliases || []) assert.equal(assetClassColor(alias), assetClassColor(code));
    }
});

test('physical commodities, producer equities, separate catalogue classes and Other remain distinct', () => {
    for (const [a, b] of [['GOLD_MINERS', 'PHYSICAL_GOLD'], ['SILVER_MINERS', 'PHYSICAL_SILVER'], ['STAPLES', 'CONSUMER_STAPLES'], ['GAMBLING', 'GAMING_GAMBLING'], ['CASH', 'OTHER']]) {
        assert.notEqual(assetClassColourKey(a), assetClassColourKey(b));
        assert.notEqual(assetClassColor(a), assetClassColor(b));
    }
    assert.equal(PORTFOLIO_COMPACT_OTHER_COLOR, assetClassColor('OTHER'));
    assert.equal(assetClassColor(null), assetClassColor('UNASSIGNED'));
    assert.notEqual(assetClassGroupColor('Materials'), assetClassColor('MATERIALS'));
});

test('custom colours ignore ordering, filtering, names and legacy fallback indices', () => {
    const codes = ['GOLD_MINERS', 'CUSTOM_FUND_A', 'CUSTOM_FUND_B', 'CASH'];
    const before = Object.fromEntries(codes.map((code, index) => [code, getPortfolioAssetClassColor(code, index)]));
    for (const code of codes.toReversed()) {
        for (const index of [0, 1, 10, 999]) assert.equal(getPortfolioAssetClassColor(code, index), before[code]);
    }
    assert.equal(assetClassColor('custom fund a'), before.CUSTOM_FUND_A);
});

test('saved settings are strictly hex, canonical and independent of unrelated settings', () => {
    const settings = { 'asset_class_colour:GOLD': '#112233', 'asset_class_colour:GOLD_MINERS': '#AABBCC',
        'asset_class_colour:CUSTOM_FUND_A': '#abcdef', 'asset_class_colour:SILVER_MINERS': 'url(javascript:bad)', etf_core_sleeve_ratio_pct: '25' };
    assert.deepEqual(classColourOverrides(settings), { GOLD_MINERS: '#aabbcc', CUSTOMFUNDA: '#abcdef' });
    assert.deepEqual(classColourOverrides(Object.fromEntries(Object.entries(settings).reverse())), classColourOverrides(settings));
    assert.equal(normaliseClassColour(' #AAbbCC '), '#aabbcc');
    for (const invalid of [null, 123, '#fff', '#12345678', 'red', 'var(--foo)', '#ffffff; color:red']) assert.equal(normaliseClassColour(invalid), null);
});

test('reset removes only its override and CSS declarations cannot inject rules', () => {
    assert.deepEqual(classColourOverrides({ 'asset_class_colour:GOLD': '#112233', 'asset_class_colour:GOLD_MINERS': '', 'asset_class_colour:SILVER_MINERS': '#abcdef' }), { SILVER_MINERS: '#abcdef' });
    assert.equal(classColourStyle({ GOLD_MINERS: '#AABBCC', SILVER_MINERS: 'red; } body { display:none;' }), ':root { --asset-class-colour-GOLD_MINERS: #aabbcc; }');
    assert.equal(classColourStyle({}), ':root {  }');
    assert.doesNotMatch(classColourStyle({ 'BAD;} html {display:none': '#abcdef' }), /html \{|display:/);
});

test('comparison dial, historical previews and comparison charts share exact colour identity without altering weights', () => {
    const row = (code, name, weight) => ({ asset_class: code, display_name: name, weight_pct: weight });
    const a = [row('GOLD', 'Old gold name', 70), row('SILVER_MINERS', 'Silver miners', 30)];
    const b = [row('SILVER_MINERS', 'Silver miners', 50), row('GOLD', 'Renamed gold', 50)];
    const dial = buildPortfolioGroupDialModel({ currentRows: b, approvedRows: a });
    const archive = approvedShapeArchive([a, b].map((rows, index) => ({ id: `shape:${index}`, kind: 'shape', status: 'APPROVED', occurred_at: `2026-08-0${index + 1}T12:00:00Z`, rows })));
    const comparison = compareApprovedShapes(archive, archive[0], archive[1], { GOLD: { name: 'Gold miners', color: '#123456' } });
    const preview = portfolioShapePreviewRows(archive[1], archive[0]);
    for (const slice of dial.slices) {
        assert.equal(slice.color, assetClassColor(slice.key));
        assert.equal(slice.color, comparison.rows.find(row => row.code === slice.key).color);
        assert.equal(slice.color, preview.find(row => row.code === slice.key).color);
    }
    assert.equal(dial.currentSourceTotalPct, 100);
    assert.equal(dial.targetSourceTotalPct, 100);
    assert.equal(dial.slices.find(row => row.key === 'GOLD').driftPct, -20);
});

test('view adapters cannot reintroduce index palettes, transformed hues or alert-only overrides', () => {
    const visual = source('components/stock-table/portfolio-visual-data.ts');
    const history = source('components/stock-table/history-performance-panel.tsx');
    const alerts = source('components/alerts-panel.tsx');
    assert.match(visual, /getPortfolioAssetClassColor.*getPortfolioGroupColor/s);
    assert.match(visual, /color-mix\(in srgb, \$\{hex\} 12%, var\(--panel-bg-alt\)\)/);
    assert.doesNotMatch(visual, /portfolioColorToHsl|COLOR_MAP|COLOR_FALLBACK/);
    assert.match(history, /assetClassPerformanceShape.classCodes\[key\]/);
    assert.doesNotMatch(history, /PERFORMANCE_CHART_COLORS/);
    assert.match(alerts, /const color = assetClassColor\(setting.key\)/);
    assert.match(alerts, /return \{ \.\.\.presentation, color: assetClassColor\(assetClass\) \}/);
    assert.match(alerts, /const groupKey = assetClassColourKey/);
    assert.doesNotMatch(alerts, /setting.alert_color|fallbackAssetClassColor/);
    const markets = source('components/commodity-market-map.tsx');
    assert.match(markets, /background: assetClassColor\(theme.equity_sleeve/);
    assert.match(markets, /background: marketStatusBarColor\(nextStep.tone\)/);
});
