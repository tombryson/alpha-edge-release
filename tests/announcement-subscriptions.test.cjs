const test = require('node:test');
const assert = require('node:assert/strict');
const { suggestedAnnouncementProvider } = require('/tmp/alpha-edge-announcements/lib/announcement-subscriptions.js');

const security = {
    kind: 'holding', id: 1, security_id: 1, name: 'Example', ticker: 'ABC',
    exchange_prefix: 'ASX:', provider: '', configured: false, needs_recheck: false,
};

test('ASX listings default to HotCopper, including delayed and normalised prefixes', () => {
    for (const exchange_prefix of ['ASX:', 'ASX', 'ASX_DLY:', ' asx: ']) {
        assert.equal(suggestedAnnouncementProvider({ ...security, exchange_prefix }), 'HOTCOPPER');
    }
});

test('every other known exchange defaults to Seeking Alpha, not just US listings', () => {
    for (const exchange_prefix of ['NASDAQ:', 'NYSE:', 'NYSEARCA:', 'AMEX:', 'BATS:', 'LSE:', 'TSX:', 'TSXV:', 'HKEX:', 'XETR:', 'NZX:']) {
        assert.equal(suggestedAnnouncementProvider({ ...security, exchange_prefix }), 'SEEKING_ALPHA');
    }
});

test('missing exchanges require identity resolution rather than guessing a provider', () => {
    for (const exchange_prefix of ['', ' ', ':']) {
        assert.equal(suggestedAnnouncementProvider({ ...security, exchange_prefix }), '');
    }
});

test('saved explicit setup is preserved until the listing needs rechecking', () => {
    assert.equal(suggestedAnnouncementProvider({ ...security, provider: 'SEEKING_ALPHA', configured: true }), 'SEEKING_ALPHA');
    assert.equal(suggestedAnnouncementProvider({ ...security, provider: 'HOTCOPPER', exchange_prefix: 'LSE:', needs_recheck: true }), 'SEEKING_ALPHA');
    assert.equal(suggestedAnnouncementProvider({ ...security, provider: 'SEEKING_ALPHA', needs_recheck: true }), 'HOTCOPPER');
});
