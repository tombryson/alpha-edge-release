const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const source = readFileSync(require.resolve('../lib/action-presentation.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const moduleUnderTest = new Module('action-presentation');
moduleUnderTest._compile(compiled, 'action-presentation.cjs');
const { alertStackActions, mergeActionAlerts, actionStatusLabel, actionInstruction, decisionHistoryRecords } = moduleUnderTest.exports;
const action = { id: 1, alert_id: 10, ticker: 'AEVT', alert_type: 'TRIM', strength: 'Strong', scope: 'SECURITY', intent: 'REDUCE', status: 'AWAITING_STATEMENT', instruction: 'Trim using source instruction', created_at: '2026-08-09T06:52:21Z', execution_reported_at: '2026-08-09T07:20:00Z' };

test('recorded and blocked actions are hidden even if their raw alerts remain active', () => {
    const raw = { id: '10', symbol: 'AEVT', signal: 'TRIM', timestamp: new Date(action.created_at), dismissed: false };
    for (const status of ['AWAITING_STATEMENT', 'BLOCKED', 'CONFIRMED', 'IGNORED', 'EXPIRED', 'NOT_APPLICABLE']) {
        assert.deepEqual(mergeActionAlerts([raw], [{ ...action, status, is_primary: true }]), []);
        assert.deepEqual(mergeActionAlerts([], [{ ...action, status, is_primary: true }]), []);
    }
    assert.deepEqual(mergeActionAlerts([raw], [{ ...action, status: 'OPEN', is_primary: false }]), []);
    assert.equal(raw.dismissed, false, 'presentation must not mutate or dismiss source evidence');
});

test('one current instruction replaces a backlog, preserving independent alerts and class scopes', () => {
    const backlog = Array.from({ length: 10 }, (_, i) => ({ ...action, id: i + 1, alert_id: i + 10, status: i ? 'BLOCKED' : 'OPEN', is_primary: i === 0 }));
    const raw = backlog.map(row => ({ id: String(row.alert_id), symbol: row.ticker, signal: 'TRIM', timestamp: new Date(row.created_at), dismissed: false }));
    const independent = { id: '200', symbol: 'AEVT', signal: 'OUTPERFORM_LOST', timestamp: new Date(), dismissed: false };
    const shared = { ...action, id: 50, alert_id: 50, ticker: 'THEME:GOLD_MINERS', scope: 'ASSET_CLASS', status: 'OPEN', is_primary: true, alert_type: 'EQUITY_REGIME_STRONG_TRIM' };
    const merged = mergeActionAlerts([...raw, independent], [...backlog, shared]);
    assert.deepEqual(new Set(merged.map(row => row.id)), new Set(['10', '50', '200']));
    assert.equal(merged.find(row => row.id === '10').strength, 'Strong');
    assert.equal(backlog.filter(row => row.status === 'BLOCKED').length, 9);
    assert.equal(raw.length, 10);
});

test('statement mismatches return once per security without reviving awaiting or blocked actions', () => {
    const waiting = { ...action, is_primary: true };
    const mismatches = [2, 3].map(id => ({ ...action, id, alert_id: id + 10, status: 'VARIANCE', is_primary: false }));
    const result = alertStackActions([waiting, ...mismatches]);
    assert.deepEqual(result.map(row => row.id), [2]);
    assert.deepEqual(alertStackActions([...mismatches].reverse()).map(row => row.id), [2]);
    const exit = { ...action, id: 4, alert_id: 14, intent: 'EXIT', alert_type: 'SELL', status: 'OPEN', is_primary: true };
    assert.deepEqual(alertStackActions([...mismatches, exit]).map(row => row.id), [4]);
    assert.deepEqual(alertStackActions([...mismatches, { ...exit, status: 'OVERRIDDEN' }]).map(row => row.id), [4]);
    assert.equal(mergeActionAlerts([{ id: '14', dismissed: true }], [exit])[0].dismissed, false, 'an unresolved Exit cannot disappear through raw dismissal');
});

test('only backend promotion releases the next action after confirmation', () => {
    const later = { ...action, id: 2, alert_id: 11, status: 'BLOCKED', is_primary: false };
    assert.deepEqual(alertStackActions([{ ...action, status: 'AWAITING_STATEMENT', is_primary: true }, later]), []);
    assert.deepEqual(alertStackActions([{ ...action, status: 'CONFIRMED' }, later]), []);
    assert.deepEqual(alertStackActions([{ ...action, status: 'CONFIRMED' }, { ...later, status: 'OPEN', is_primary: true }]).map(row => row.id), [2]);
});

test('known managed IDs prevent stale raw alerts reviving after completion removes their pending API rows', () => {
    const raw = { id: '10', symbol: 'AEVT', signal: 'TRIM', timestamp: new Date(action.created_at), dismissed: false };
    const other = { ...raw, id: '11', signal: 'OUTPERFORM_LOST' };
    assert.deepEqual(mergeActionAlerts([raw, other], [], new Set(['10'])), [other]);
    assert.equal(mergeActionAlerts([raw], [{ ...action, status: 'VARIANCE', is_primary: true }], new Set(['10'])).length, 1);
});

test('closed records are not described as verified sales and trim instructions retain the known source rule', () => {
    assert.equal(actionStatusLabel({ ...action, status: 'NOT_APPLICABLE' }), 'Not applicable');
    assert.equal(actionStatusLabel({ ...action, status: 'CONFIRMED', reconciliation_method: 'MANUAL_EXTERNAL' }), 'Recorded externally');
    assert.match(actionInstruction(action), /20%/);
    assert.match(actionInstruction({ ...action, strength: 'Weak' }), /5%/);
    assert.equal(actionInstruction({ ...action, strength: '' }), 'Trim size was not supplied by the source');
});

test('Decision History joins existing decisions and retains system closures without duplicates or a second queue', () => {
    const decisions = [{ id: 5, alert_id: 10, ticker: 'AEVT', created_at: '2026-08-09T07:20:00Z', decision: 'TRIM', alert_type: 'TRIM' }];
    const closed = { ...action, id: 2, alert_id: 11, status: 'NOT_APPLICABLE', updated_at: '2026-08-10T00:00:00Z' };
    const rows = decisionHistoryRecords(decisions, [action, closed, { ...action, id: 3, alert_id: 12, status: 'BLOCKED' }]);
    assert.equal(rows.length, 3);
    assert.equal(rows.find(row => row.key === 'decision:5').action.status, 'AWAITING_STATEMENT');
    assert.equal(rows.find(row => row.key === 'action:2').action.status, 'NOT_APPLICABLE');
    assert.equal(rows.find(row => row.key === 'action:3').action.status, 'BLOCKED');
    assert.equal(rows.find(row => row.key === 'action:3').date, action.created_at);
    assert.equal(decisions.length, 1);
});
