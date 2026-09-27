const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const postcss = require('postcss');

const read = (file) => readFileSync(path.resolve(__dirname, '..', file), 'utf8');
const mobile = postcss.parse(read('styles/terminal-mobile.css'));
const mediaAncestors = (node) => {
    const result = [];
    for (let parent = node.parent; parent; parent = parent.parent) {
        if (parent.type === 'atrule' && parent.name === 'media') result.push(parent.params);
    }
    return result;
};
function declarations(css, selector, query) {
    const result = {};
    css.walkRules(selector, (rule) => {
        if (!query || mediaAncestors(rule).includes(query)) {
            rule.walkDecls((decl) => { result[decl.prop] = decl.value; });
        }
    });
    return result;
}

test('existing surfaces are overridden only at narrow breakpoints or reduced motion', () => {
    mobile.walkRules((rule) => {
        if (rule.selectors.every((selector) => /^\.terminal-mobile-|^\.market-mobile-/.test(selector))) return;
        assert.ok(mediaAncestors(rule).some((query) =>
            ['(max-width: 767px)', '(max-width: 1023px)', '(prefers-reduced-motion: reduce)'].includes(query)), rule.selector);
    });
    mobile.walkDecls((decl) => {
        assert.equal(Boolean(decl.important), false, decl.toString());
        assert.notEqual(decl.prop, 'zoom');
        if (decl.prop === 'font-size') assert.doesNotMatch(decl.value, /v[wh]|cq[wh]/);
        if (decl.prop === 'transform') assert.doesNotMatch(decl.value, /scale/);
    });
});

test('shell and page hooks match their CSS breakpoints without writing preferences', () => {
    const hook = read('lib/use-mobile-layout.ts');
    assert.match(hook, /MOBILE_LAYOUT_QUERY = "\(max-width: 767px\)"/);
    assert.match(hook, /COMPACT_SHELL_QUERY = "\(max-width: 1023px\)"/);
    assert.match(hook, /removeEventListener\("change", callback\)/);
    assert.match(hook, /\(\) => false/);
    assert.doesNotMatch(hook, /localStorage|setItem|setLayout/);
    const page = read('app/page.tsx');
    assert.match(page, /useMobileLayout\(COMPACT_SHELL_QUERY\)/);
    assert.match(page, /if \(mobile\) setMobilePanel\("right"\)/);
    assert.match(page, /readTerminalRoute\(\)\?\.tab \?\? nextActiveTab/);
    assert.equal(declarations(mobile, '.terminal-shell .terminal-desktop-rail', '(max-width: 1023px)').display, 'none');
});

test('drawers use an accessible dialog and restore keyboard focus', () => {
    const dialog = read('components/shell/mobile-shell-dialog.tsx');
    for (const token of ['Dialog.Root', 'Dialog.Overlay', 'Dialog.Content', 'Dialog.Title', 'Dialog.Close', 'onCloseAutoFocus', 'returnFocus.current.focus()']) {
        assert.ok(dialog.includes(token), token);
    }
    assert.equal(declarations(mobile, '.terminal-mobile-drawer').height, '100dvh');
    assert.equal(declarations(mobile, '.terminal-mobile-icon').width, '44px');
    const header = read('components/shell/terminal-unified-header.tsx');
    assert.match(header, /aria-label="Mobile navigation"/);
    for (const name of ['Open navigation', 'Open Alert Stack', 'Open portfolio tools', 'ETF allocations', 'Help']) assert.ok(header.includes(name), name);
});

test('dense tables keep all columns with a narrower phone identity column', () => {
    const positions = read('components/stock-table/position-grid.tsx');
    const analysis = read('components/stock-table/analysis-panel.tsx');
    const grid = read('components/stock-table/resizable-grid.tsx');
    assert.match(positions, /ResizableGrid/);
    assert.match(grid, /mobile && column.key === 'name'/);
    assert.match(grid, /widthPx: 200, minWidthPx: 200/);
    assert.match(grid, /\$\{widthScope\}-mobile/);
    assert.match(analysis, /<ResizableGrid<AnalysisGridColumnKey>/);
    assert.equal(declarations(mobile, '.terminal-shell .position-grid-scroll').overflow, 'auto');
    assert.equal(declarations(mobile, '.terminal-shell .positions-grid td:first-child').position, 'sticky');
    assert.equal(declarations(mobile, '.terminal-shell .analysis-grid .analysis-company-name')['white-space'], 'normal');
    assert.equal(declarations(mobile, '.terminal-shell .analysis-grid td[colspan]').position, 'static');
});

test('markets retain four labelled stages and discoverable touch controls', () => {
    const source = read('components/commodity-market-map.tsx');
    assert.match(source, /market-mobile-stage-title/);
    assert.match(source, /<StageProgressTrack/);
    assert.match(source, /data-market-evidence-control/);
    assert.equal(declarations(mobile, '.terminal-shell .market-map-open')['grid-template-columns'], 'repeat(4, minmax(0, 1fr))');
    assert.equal(declarations(mobile, '.terminal-shell [data-market-stage-label]')['min-height'], '20px');
    assert.equal(declarations(mobile, '.terminal-shell [data-market-stage-label]').height, 'auto');
    assert.equal(declarations(mobile, '.terminal-shell [data-market-edit-hover-zone] button')['pointer-events'], 'auto');
});

test('portfolio phone summary preference is independent of the desktop rail', () => {
    const source = read('components/stock-table/portfolio-overview-v3.tsx');
    assert.match(source, /mobileSummaryCollapsed/);
    assert.match(source, /aria-expanded=\{!collapsed\}/);
    for (const label of ['Approved', 'Return %', 'Approved cumulative', 'Approved per $1K', 'Held', 'Difference']) {
        assert.ok(source.includes(`data-mobile-label="${label}"`), label);
    }
});

test('ETF mobile rows retain hidden desktop-narrow metrics with explicit labels', () => {
    const css = postcss.parse(read('components/etf-allocations-tab.module.css'));
    const source = read('components/etf-allocations-tab.tsx');
    const phone = css.nodes.find((node) => node.type === 'atrule' && node.params === '(max-width: 767px)');
    assert.ok(phone);
    assert.match(phone.toString(), /display: block/);
    for (const label of ['Held / target', 'Score', 'Model weight']) assert.ok(source.includes(`data-mobile-label="${label}"`), label);
});

test('timeline owns its responsive typography and comparison tables retain horizontal overflow', () => {
    const css = postcss.parse(read('components/stock-table/portfolio-timeline-view.module.css'));
    assert.equal(declarations(css, '.allocation')['overflow-x'], 'auto');
    assert.ok(css.nodes.some(node => node.type === 'atrule' && node.name === 'container'));
    assert.doesNotMatch(mobile.toString(), /portfolio-timeline.*font-size: 11px/);
});
