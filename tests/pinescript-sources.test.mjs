import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const directory = new URL('../DOCS/Pinescripts/', import.meta.url);
// The PineScript sources stay in the private repository; public source releases
// omit them, so this suite skips when they are absent.
const available = existsSync(new URL('source-manifest.json', directory));
const manifest = available
    ? JSON.parse(readFileSync(new URL('source-manifest.json', directory), 'utf8'))
    : { scripts: [] };
const digest = value => createHash('sha256').update(value).digest('hex');
const fixtures = { tickerStr: 'ASX:TEST', priceJsonValue: '12.5', priceTargetJsonValue: '18.5', cdfStateJsonValue: 'BUY' };

// These exports use single-line string concatenation for alert JSON. Substitute
// only known fixture values; do not evaluate Pine or arbitrary source code.
function payloads(source, values = fixtures) {
  return source.split('\n').filter(line => /^\s*alert\(/.test(line)).map(line => {
    const match = line.match(/^\s*alert\('(.+)', alert\.freq_once_per_bar_close\)$/);
    assert.ok(match, `Unexpected alert template: ${line}`);
    const json = match[1].replace(/' \+ (\w+) \+ '/g, (_, variable) => {
      assert.ok(Object.hasOwn(values, variable), `Unknown payload variable: ${variable}`);
      return values[variable];
    });
    return JSON.parse(json);
  });
}

const expectedSignals = {
  cdf: ['buy', 'sell', 'price_target_update'],
  tms: ['strong_add', 'weak_add', 'strong_trim', 'weak_trim', 'cdf_buy_zone', 'cdf_sell_zone', 'sell', 'reentry'],
  etf_tms: ['buy', 'sell', 'strong_add', 'weak_add', 'strong_trim', 'weak_trim'],
};
const expectedCounts = { cdf: 3, tms: 16, etf_tms: 14 };

test('manifest distinguishes the supplied three sources from unverified live alerts', { skip: !available && 'PineScript sources are not included in this checkout' }, () => {
  assert.deepEqual(manifest.scripts.map(entry => entry.script).sort(), ['cdf', 'etf_tms', 'tms']);
  assert.equal(manifest.live_tradingview_revision_verified, false);
  assert.equal(manifest.normalization, 'CRLF to LF only');
});

for (const entry of manifest.scripts) {
  const source = readFileSync(new URL(encodeURIComponent(entry.file), directory), 'utf8');

  test(`${entry.script}: source and documented amendments match the original export`, () => {
    assert.equal(digest(source), entry.sha256);
    // Reverse only the documented transport amendment to verify that none of
    // the supplied strategy logic or settings changed during this repair.
    const imported = entry.script === 'tms'
      ? source.replace('cdfStateJsonValue = inBuyZone ? "BUY" : "SELL"\n', '')
        .replace(/, "cdf_state": "' \+ cdfStateJsonValue \+ '"/, '')
      : source;
    assert.equal(digest(imported), entry.imported_sha256 ?? entry.sha256);
    assert.equal(digest(imported.replace(/\n/g, '\r\n')), entry.source_sha256);
    assert.ok(source.startsWith('//@version=5\n'));
    assert.ok(!source.includes('\r'));
  });

  test(`${entry.script}: every emitted alert template is valid contract JSON`, () => {
    const emitted = payloads(source);
    assert.equal(emitted.length, expectedCounts[entry.script]);
    assert.deepEqual([...new Set(emitted.map(value => value.signal))].sort(), expectedSignals[entry.script].sort());
    for (const value of emitted) {
      assert.equal(value.ticker, 'ASX:TEST');
      assert.equal(value.script, entry.script);
      assert.equal(value.price, 12.5);
      assert.equal(Object.hasOwn(value, 'event_id'), false);
      assert.equal(Object.hasOwn(value, 'bar_closed_at'), false);
    }
    if (entry.script !== 'cdf') {
      for (const signal of ['strong_add', 'weak_add', 'strong_trim', 'weak_trim']) {
        assert.deepEqual(emitted.filter(value => value.signal === signal).map(value => value.timeframe).sort(), ['1D', '2D', '3D']);
      }
    }
    if (entry.script === 'cdf') {
      assert.ok(emitted.every(value => value.analystPriceTarget === 18.5));
      assert.ok(payloads(source, { ...fixtures, priceTargetJsonValue: 'null' }).every(value => value.analystPriceTarget === null));
      assert.ok(emitted.every(value => !Object.hasOwn(value, 'theme')));
    }
    if (entry.script === 'tms') {
      assert.match(source, /^cdfStateJsonValue = inBuyZone \? "BUY" : "SELL"$/m);
      const stop = emitted.find(value => value.signal === 'sell');
      assert.equal(stop.cdf_state, 'BUY');
      const bearishStop = payloads(source, { ...fixtures, cdfStateJsonValue: 'SELL' }).find(value => value.signal === 'sell');
      assert.equal(bearishStop.cdf_state, 'SELL');
      assert.ok(emitted.filter(value => value.signal !== 'sell').every(value => !Object.hasOwn(value, 'cdf_state')));
      assert.equal(Object.hasOwn(stop, 'cdf_zone'), false);
    }
  });
}
