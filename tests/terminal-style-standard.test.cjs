const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const postcss = require('postcss');

const root = path.resolve(__dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const shared = postcss.parse(read('styles/terminal-workspace.css'));
const portfolio = postcss.parse(read('components/stock-table/portfolio-overview-v3.module.css'));
function declarations(css, selector) {
    const result = {};
    css.walkRules(selector, (rule) => {
        if (rule.parent.type === 'root') {
            rule.walkDecls((decl) => { result[decl.prop] = decl.value; });
        }
    });
    return result;
}

test('shared style rules are opt-in, not global table or shell overrides', () => {
    shared.walkRules((rule) => assert.ok(rule.selector.startsWith('.terminal-workspace'), rule.selector));
    shared.walkDecls((decl) => {
        assert.equal(Boolean(decl.important), false);
        assert.notEqual(decl.prop, 'zoom');
        assert.ok(!/\b(?:vw|vh)\b/.test(decl.prop === 'font-size' ? decl.value : ''));
        assert.ok(!(decl.prop === 'transition' && /\ball\b/.test(decl.value)));
    });
    for (const file of ['analysis-panel.tsx', 'position-grid-styles.tsx', 'analysis-toolbar.tsx']) {
        assert.ok(!read(`components/stock-table/${file}`).includes('terminal-workspace'));
    }
});

test('the shared hierarchy preserves readable body and secondary type', () => {
    assert.equal(declarations(shared, '.terminal-workspace')['font-size'], '13px');
    assert.equal(declarations(shared, '.terminal-workspace-title')['font-size'], '15px');
    assert.equal(declarations(shared, '.terminal-workspace-group-title')['font-size'], '14px');
    assert.equal(declarations(shared, '.terminal-workspace-column')['font-size'], '11px');
    assert.equal(declarations(shared, '.terminal-workspace-title')['text-transform'], 'none');
    assert.equal(declarations(shared, '.terminal-workspace')['line-height'], '1.5');
});

test('workspace neutrals resolve from theme tokens', () => {
    const surface = declarations(shared, '.terminal-workspace');
    for (const key of ['--workspace-surface', '--workspace-group', '--workspace-text', '--workspace-muted', '--workspace-border']) {
        assert.match(surface[key], /var\(--/);
        assert.doesNotMatch(surface[key], /#[\da-f]{3,8}\b/i);
    }
    assert.equal(surface['--workspace-hover'], 'var(--analysis-stock-row-hover-bg)');
    assert.equal(declarations(portfolio, '.toolbarTitle').color, 'var(--overview-text)');
    assert.equal(declarations(portfolio, '.ribbonCaption').color, 'var(--overview-text-muted)');
});

test('control tokens are opt-in and do not change the terminal density or protected widgets', () => {
    const controls = declarations(shared, '.terminal-workspace-controls');
    assert.equal(controls['--control-height'], '30px');
    assert.equal(controls['--control-touch-height'], '36px');
    assert.equal(controls['--control-font-size'], '12px');
    assert.equal(controls['--control-radius'], '3px');
    assert.match(controls['--control-hover'], /var\(--background\)/);
    assert.match(controls['--control-selected'], /var\(--background\)/);
    assert.equal(controls['--spacing'], undefined);
    assert.equal(controls['font-size'], undefined);
    for (const file of ['components/portfolio-composition-pie.tsx', 'components/portfolio-group-dial.tsx', 'components/stock-table/analysis-panel.tsx', 'components/commodity-market-map.tsx']) {
        assert.doesNotMatch(read(file), /terminal-workspace-controls/);
    }
    const etf = read('components/etf-allocations-tab.module.css');
    assert.match(etf, /--etf-row-hover: var\(--analysis-stock-row-hover-bg\)/);
    assert.doesNotMatch(etf, /:focus\s*\{\s*outline: none/);
    const source = read('components/etf-allocations-tab.tsx');
    assert.match(source, /aria-pressed=\{allocationFilter === 'review'\}/);
    assert.match(source, /aria-pressed=\{allocationFilter === 'all'\}/);
});

test('Portfolio retains the bar geometry, rail and numeric alignment', () => {
    assert.equal(declarations(portfolio, '.rail').width, '228px');
    assert.equal(declarations(portfolio, '.row')['min-height'], '46px');
    assert.equal(declarations(portfolio, '.visualCell').height, '46px');
    assert.equal(declarations(portfolio, '.ribbon').height, '46px');
    assert.equal(declarations(portfolio, '.targetRibbon').height, '20px');
    assert.equal(declarations(portfolio, '.ribbonPct')['font-weight'], '500');
    const number = declarations(portfolio, '.numberCell');
    assert.equal(number['font-variant-numeric'], 'tabular-nums');
    assert.equal(number['text-align'], 'right');
    assert.equal(number['text-overflow'], undefined);
    assert.equal(declarations(portfolio, '.toolbar')['flex-wrap'], 'wrap');
});

test('Portfolio radial shading uses the shared row surface and flat class colours', () => {
    const source = read('components/stock-table/portfolio-radial-chart.tsx');
    const css = postcss.parse(read('components/stock-table/portfolio-radial-chart.module.css'));
    assert.equal(declarations(css, '.root')['--radial-surface'], 'var(--analysis-stock-row-bg)');
    assert.equal(declarations(css, '.root').background, 'var(--radial-surface)');
    assert.equal(declarations(css, '.heldFill')['fill-opacity'], '0.24');
    assert.equal(declarations(css, '.tick').stroke, 'var(--radial-surface)');
    assert.match(source, /fill=\{rows\[from\]\.color\} className=\{styles\.heldFill\}/);
    assert.doesNotMatch(source, /radialGradient|linearGradient|<filter\b/);
    css.walkDecls((decl) => {
        assert.notEqual(decl.prop, 'box-shadow');
        assert.notEqual(decl.prop, 'transition');
    });
});

test('System removes hard-coded black bands and sub-11px state labels', () => {
    const source = read('components/system-architecture-tab.tsx');
    assert.doesNotMatch(source, /bg-\[#080a0d\]|text-\[(?:8|9|10)px\]/);
    const css = postcss.parse(read('components/system-architecture-tab.module.css'));
    assert.equal(declarations(css, '.sectionHeading h2')['font-size'], '16px');
    assert.equal(declarations(css, '.sectionHeading h2')['font-weight'], '600');
    assert.equal(declarations(css, '.sectionHeading')['margin-bottom'], '6px');
    assert.equal(declarations(css, '.sectionHeading')['min-height'], '42px');
    assert.equal(declarations(css, '.root .allocationRow')['min-height'], '26px');
    assert.equal(declarations(css, '.root .groupButton')['min-height'], '31px');
    assert.equal(declarations(css, '.identityButton strong')['font-size'], '13px');
    assert.equal(declarations(css, '.identityButton strong')['font-weight'], '500');
    assert.equal(declarations(css, '.groupButton > span')['font-size'], '14px');
    assert.equal(declarations(css, '.groupButton > span')['font-weight'], '600');
    assert.equal(declarations(css, '.positionTable .identityButton')['padding-inline-start'], '48px');
    assert.equal(declarations(css, '.table .groupRow th')['border-block'], '1px solid var(--workspace-border)');
    assert.equal(declarations(css, '.table td').background, 'var(--analysis-stock-row-bg)');
    assert.doesNotMatch(source, /LayerConnector|max-h-\[430px\]/);
    assert.match(source, /system-layer-positions/);
});

test('History owns bounded ledger scrolling and readable page-scoped chart controls', () => {
    const constants = read('components/stock-table/history.ts');
    const css = postcss.parse(read('components/stock-table/history-workspace.module.css'));
    assert.equal(declarations(css, '.tableScroll').overflow, 'auto');
    assert.equal(declarations(css, '.tableScroll')['min-height'], '0');
    assert.equal(declarations(css, '.ledger').flex, '1');
    assert.equal(declarations(css, '.chartPlot').height, '340px');
    assert.equal(declarations(css, '.search input').height, '32px');
    assert.equal(declarations(css, '.table').font, '400 13px/1.5 system-ui, sans-serif');
    assert.doesNotMatch(constants, /shadow-\[|rounded-lg|tracking-\[/);
    for (const name of ['signals', 'performance', 'stock']) {
        const source = read(`components/stock-table/history-${name}-panel.tsx`);
        assert.match(source, /styles\.header/);
        assert.doesNotMatch(source, /uppercase tracking-/);
        assert.doesNotMatch(source, /max-h-\[80%\]|auto-rows-fr/);
    }
});

test('Markets retains immediate hover and its existing stage/evidence controls', () => {
    const source = read('components/commodity-market-map.tsx');
    assert.doesNotMatch(source, /terminal-workspace/);
    assert.match(source, /transition: 'none'/);
    assert.match(source, /data-market-stage-cell=\{stage.key\}/);
    assert.match(source, /data-market-evidence-control/);
    assert.match(source, /data-market-edit-hover-zone/);
    assert.match(source, /data-market-identity-bar/);
});

test('News uses readable role typography without tracked capitals or dark-only text', () => {
    const source = read('components/news-tab.tsx');
    assert.match(source, /terminal-workspace-title">Macro Narrative/);
    assert.match(source, /terminal-workspace-group-title">Daily brief/);
    assert.doesNotMatch(source, /text-\[(?:8|9|10)px\]|uppercase|tracking-\[|leading-none/);
    assert.doesNotMatch(source, /text-(?:sky|teal|violet|amber|emerald|red)-[234]00/);
    assert.match(source, /aria-pressed=\{timeframe === value\}/);
    assert.match(source, /aria-pressed=\{sentimentFilter === value\}/);
    assert.match(source, /aria-expanded=\{showItems\}/);
    assert.match(source, /aria-label="Close thesis"/);
});

test('News presentation is page-scoped and handles constrained workspace dimensions', () => {
    const css = postcss.parse(read('styles/news-workspace.css'));
    css.walkRules((rule) => {
        for (const selector of rule.selectors) assert.ok(selector.startsWith('.news-workspace'), selector);
    });
    css.walkDecls((decl) => {
        assert.equal(Boolean(decl.important), false);
        assert.notEqual(decl.prop, 'zoom');
    });
    assert.equal(declarations(css, '.news-workspace .news-row').background, 'var(--analysis-stock-row-bg)');
    assert.equal(declarations(css, '.news-workspace .news-layout').overflow, 'hidden');
    const narrow = css.nodes.find((node) => node.type === 'atrule' && node.name === 'container');
    assert.equal(narrow.params, 'news (max-width: 1100px)');
    const layout = narrow.nodes.find((node) => node.selector === '.news-workspace .news-layout');
    assert.ok(layout.nodes.some((node) => node.prop === 'display' && node.value === 'block'));
    assert.ok(layout.nodes.some((node) => node.prop === 'overflow' && node.value === 'auto'));
    assert.ok(css.nodes.some((node) => node.type === 'atrule' && node.params === '(max-height: 850px)'));
});
