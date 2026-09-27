const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildAssetClassIndex, assetClassRiskBucket, filterAssetClassIndex } = require('/tmp/alpha-edge-class-index/lib/asset-class-index.js');
const { DEMO_ASSET_CLASS_CATALOGUE: catalogue } = require('/tmp/alpha-edge-class-index/lib/demo-asset-classes.generated.js');
const rows = buildAssetClassIndex(catalogue.assetClasses, catalogue.config);

test('index covers the complete registry, not just held classes, without ETF wrappers', () => {
    assert.ok(rows.length > 40);
    assert.equal(new Set(rows.map(row => row.code)).size, rows.length);
    assert.ok(rows.some(row => row.code === 'URANIUM_MINERS'));
    assert.ok(rows.some(row => row.code === 'MINING_SERVICES'));
    assert.ok(!rows.some(row => row.code === 'ETF'));
    for (const assetClass of catalogue.assetClasses) assert.ok(rows.some(row => row.code === assetClass.code));
});

test('classifications match the backend defaults, not a generic defensive-sector guess', () => {
    const expectBucket = (codes, bucket) => codes.forEach(code => assert.equal(rows.find(row => row.code === code)?.bucket, bucket, code));
    expectBucket(['BANKS', 'DIVERSIFIED_MINERS', 'GOLD_MINERS', 'TELECOMMUNICATIONS', 'REAL_ESTATE_REIT'], 'q1');
    expectBucket(['CONSUMER_STAPLES', 'INSURANCE', 'GAMING_GAMBLING'], 'defensive');
    expectBucket(['PHARMA_BIOTECH', 'ENERGY_PRODUCERS', 'HEALTHCARE_SERVICES', 'INFRASTRUCTURE', 'PHYSICAL_GOLD'], 'exempt');
    expectBucket(['CASH', 'UNASSIGNED'], 'other');
});

test('index keeps group labels distinct and gives class parentage and rationale', () => {
    assert.equal(rows.find(row => row.code === 'GOLD').kind, 'Group');
    assert.equal(rows.find(row => row.code === 'GOLD_MINERS').kind, 'Asset class');
    assert.equal(rows.find(row => row.code === 'GOLD_MINERS').parent, 'Gold');
    assert.match(rows.find(row => row.code === 'GOLD_MINERS').reason, /equity/i);
    assert.equal(rows.find(row => row.code === 'CASH').kind, 'System');
    assert.equal(rows.find(row => row.code === 'CONSUMER_DISCRETIONARY').parent, '');
});

test('missing classification is unclassified; live overrides and custom classes are respected', () => {
    const identity = { code: 'CUSTOM_CLASS', display_name: 'Custom allocation', active: true, allow_target_weight: true };
    const policy = { key: identity.code, display_name: identity.display_name, active: true, overlay_eligible: true, q3_beneficiary: true };
    assert.equal(assetClassRiskBucket(identity.code), 'other');
    assert.equal(buildAssetClassIndex([identity], [])[0].bucket, 'other');
    assert.equal(buildAssetClassIndex([identity], [policy])[0].bucket, 'defensive');
    assert.equal(buildAssetClassIndex([identity], [{ ...policy, overlay_eligible: false }])[0].bucket, 'exempt');
    assert.equal(buildAssetClassIndex([{ ...identity, active: false }], [policy]).length, 0);
});

test('search and category filters compose without changing the registry', () => {
    assert.equal(filterAssetClassIndex(rows, ' banks ', 'q1')[0].code, 'BANKS');
    assert.equal(filterAssetClassIndex(rows, 'banks', 'defensive').length, 0);
    assert.equal(filterAssetClassIndex(rows, 'IRON_ORE_MINERS', 'all')[0].code, 'IRON_ORE_MINERS');
    assert.equal(filterAssetClassIndex(rows, 'not-a-class', 'all').length, 0);
    assert.equal(filterAssetClassIndex(rows, '', 'all').length, rows.length);
});
