const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const buildDir =
    process.env.TERMINAL_ROUTE_BUILD_DIR ||
    '/tmp/alpha-edge-terminal-route';
const {
    normalizeTerminalRouteTab,
    readTerminalRoute,
    requestTerminalTab,
    TERMINAL_TAB_REQUEST_EVENT,
    terminalRouteHash,
} = require(path.join(buildDir, 'lib', 'terminal-route.js'));

test('migrates retired portfolio tab identifiers to Portfolio', () => {
    assert.equal(normalizeTerminalRouteTab('PORTFOLIO2'), 'PORTFOLIO');
    assert.equal(normalizeTerminalRouteTab('EXPOSURE'), 'PORTFOLIO');
});

test('reads a legacy Portfolio 2 bookmark as the canonical Portfolio route', () => {
    const route = readTerminalRoute('#/portfolio2');
    assert.equal(route.tab, 'PORTFOLIO');
    assert.equal(terminalRouteHash(route), '#/portfolio');
});

test('continues to reject unknown terminal tabs', () => {
    assert.equal(normalizeTerminalRouteTab('PORTFOLIO3'), null);
    assert.equal(readTerminalRoute('#/portfolio3'), null);
});

test('hands shell navigation to the mounted terminal', () => {
    const originalWindow = global.window;
    const mockWindow = new EventTarget();
    mockWindow.location = { hash: '#/positions' };
    global.window = mockWindow;

    let requestedTab = null;
    mockWindow.addEventListener(TERMINAL_TAB_REQUEST_EVENT, (event) => {
        requestedTab = event.detail.tab;
        event.preventDefault();
    });

    try {
        requestTerminalTab('ANALYSIS');
        assert.equal(requestedTab, 'ANALYSIS');
        assert.equal(mockWindow.location.hash, '#/positions');
    } finally {
        global.window = originalWindow;
    }
});

test('falls back to the hash route before the terminal listener mounts', () => {
    const originalWindow = global.window;
    const mockWindow = new EventTarget();
    mockWindow.location = { hash: '#/positions' };
    global.window = mockWindow;

    try {
        requestTerminalTab('MARKETS');
        assert.equal(mockWindow.location.hash, '#/markets');
    } finally {
        global.window = originalWindow;
    }
});
