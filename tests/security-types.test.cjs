const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const buildDir = process.env.SECURITY_TYPES_BUILD_DIR;
if (!buildDir) throw new Error('SECURITY_TYPES_BUILD_DIR is required');

const {
    requiresNonAllocatingConfirmation,
} = require(path.join(buildDir, 'lib/security-types.js'));

test('zero and display-zero positions do not require confirmation', () => {
    assert.equal(requiresNonAllocatingConfirmation(0), false);
    assert.equal(requiresNonAllocatingConfirmation(0.49), false);
    assert.equal(requiresNonAllocatingConfirmation(null), false);
});

test('a material broker position requires confirmation', () => {
    assert.equal(requiresNonAllocatingConfirmation(0.5), true);
    assert.equal(requiresNonAllocatingConfirmation(436), true);
});
