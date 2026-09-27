const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareInvestmentPlays, readInvestmentPlayLibrary, investmentPlaySettings, investmentPlayChanges, INVESTMENT_PLAY_PREFIX } = require('/tmp/alpha-edge-plays-tests/portfolio-investment-plays.js');

test('plays are optional and blank drafts are omitted', () => {
    assert.deepEqual(prepareInvestmentPlays([]), []);
    assert.deepEqual(prepareInvestmentPlays([{ title: ' ', thesis: '\n' }]), []);
});

test('complete hypotheses are trimmed without changing their meaning or order', () => {
    const rows = [{ title: ' Fertiliser ', thesis: ' Supply constraints versus input costs.\n' },
        { title: 'Duration', thesis: 'Test the real-yield downside.' }];
    const before = JSON.stringify(rows);
    assert.deepEqual(prepareInvestmentPlays(rows), [
        { title: 'Fertiliser', thesis: 'Supply constraints versus input costs.' },
        rows[1],
    ]);
    assert.equal(JSON.stringify(rows), before);
});

test('partial ideas are reported rather than silently discarded', () => {
    assert.throws(() => prepareInvestmentPlays([{ title: 'Gold miners', thesis: '' }]), /play 1/);
    assert.throws(() => prepareInvestmentPlays([{ title: '', thesis: 'Margin sensitivity' }]), /play 1/);
});

test('saved library round-trips drafts and ignores unrelated settings and deleted records', () => {
    const rows = [{ id: 'p1', version: 1, title: 'Draft', thesis: '', created_at: '2026-09-18T00:00:00Z', updated_at: '2026-09-18T00:00:00Z' }];
    assert.deepEqual(readInvestmentPlayLibrary({ ...investmentPlaySettings(rows), unrelated: 'private', [`${INVESTMENT_PLAY_PREFIX}deleted`]: '' }), rows);
    assert.throws(() => readInvestmentPlayLibrary({ [`${INVESTMENT_PLAY_PREFIX}invalid`]: '{bad' }), /Nothing has been overwritten/);
    assert.throws(() => readInvestmentPlayLibrary({ [`${INVESTMENT_PLAY_PREFIX}wrong-id`]: JSON.stringify(rows[0]) }), /unsupported format/);
});

test('changes update individual records, including deletions, without replacing the library', () => {
    const row = { id: 'p1', version: 1, title: 'Gold', thesis: 'Margins', created_at: 'today', updated_at: 'today' };
    const saved = investmentPlaySettings([row]);
    assert.deepEqual(investmentPlayChanges([row], saved), {});
    assert.deepEqual(investmentPlayChanges([], saved), { [`${INVESTMENT_PLAY_PREFIX}p1`]: '' });
    const second = { ...row, id: 'p2', title: 'Rates' };
    assert.deepEqual(Object.keys(investmentPlayChanges([row, second], saved)), [`${INVESTMENT_PLAY_PREFIX}p2`]);
});
