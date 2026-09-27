const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function store(api) {
    const compiled = ts.transpileModule(readFileSync('lib/asset-class-colour-store.ts', 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const exports = {};
    vm.runInNewContext(compiled, { exports, localStorage: { setItem() { throw new Error('storage disabled'); } },
        require: name => name === './api' ? { api } : name.startsWith('./')
            ? require(`/tmp/alpha-edge-class-colours/lib/${name.slice(2)}.js`) : require(name) });
    return exports.useClassColours;
}

test('a pre-save refresh cannot undo a confirmed colour, including when local storage is disabled', async () => {
    let finish;
    let initial = true;
    const state = store({
        getClassColourSettings: () => initial ? (initial = false, Promise.resolve({})) : new Promise(resolve => { finish = resolve; }),
        saveClassColour: async (code, colour) => colour,
    });
    await state.getState().refresh();
    const stale = state.getState().refresh();
    await state.getState().save('GOLD_MINERS', '#123456');
    finish({ 'asset_class_colour:GOLD_MINERS': '#abcdef' });
    await stale;
    assert.equal(state.getState().overrides.GOLD_MINERS, '#123456');
    assert.equal(state.getState().refreshing, false);
    assert.equal(state.getState().saving, false);
});

test('failed save or refresh retains loaded colours and reset clears only its class', async () => {
    let failing = false;
    const state = store({
        getClassColourSettings: async () => { if (failing) throw new Error('offline'); return { 'asset_class_colour:GOLD_MINERS': '#123456', 'asset_class_colour:SILVER_MINERS': '#abcdef' }; },
        saveClassColour: async (code, colour) => { if (failing) throw new Error('offline'); return colour; },
    });
    await assert.rejects(state.getState().save('GOLD_MINERS', '#555555'));
    await state.getState().refresh();
    failing = true;
    await state.getState().refresh();
    await assert.rejects(state.getState().save('GOLD_MINERS', '#555555'));
    assert.equal(state.getState().overrides.GOLD_MINERS, '#123456');
    assert.equal(state.getState().saving, false);
    failing = false;
    await state.getState().save('GOLD_MINERS', '');
    assert.equal(state.getState().overrides.GOLD_MINERS, undefined);
    assert.equal(state.getState().overrides.SILVER_MINERS, '#abcdef');
});

test('duplicate saves and invalid colours cannot issue a second write', async () => {
    let finish, writes = 0;
    const state = store({ getClassColourSettings: async () => ({}),
        saveClassColour: async () => { ++writes; return new Promise(resolve => { finish = resolve; }); } });
    await state.getState().refresh();
    await assert.rejects(state.getState().save('GOLD_MINERS', 'red'));
    const pending = state.getState().save('GOLD_MINERS', '#123456');
    await assert.rejects(state.getState().save('GOLD_MINERS', '#123456'));
    assert.equal(writes, 1);
    finish('#123456');
    await pending;
    assert.equal(state.getState().overrides.GOLD_MINERS, '#123456');
});
