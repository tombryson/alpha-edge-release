const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const buildDir = process.env.SHELL_LAYOUT_BUILD_DIR;
if (!buildDir) throw new Error('SHELL_LAYOUT_BUILD_DIR is required');
const {
  OPEN_SHELL,
  EXPANDED_SHELL,
  DEFAULT_LAYOUT,
  isCentreExpanded,
  toggleRail,
  revealRightRail,
  cycleShellExpansion,
  railWidth,
  restoreLayout,
} = require(path.join(buildDir, 'lib/shell-layout.js'));

const shell = (left, right) => ({ left, right });
const ALL = [
  shell('open', 'open'),
  shell('snapped', 'open'),
  shell('open', 'snapped'),
  shell('snapped', 'snapped'),
];

test('expanding moves rails out, not in', () => {
  // Close the left rail by hand, then expand from the nav bar. The right rail
  // is what should move; reopening the left would undo the click you just made.
  const layout = toggleRail(DEFAULT_LAYOUT, 'left');
  assert.deepEqual(layout, shell('snapped', 'open'));
  assert.deepEqual(cycleShellExpansion(layout), EXPANDED_SHELL);

  assert.deepEqual(cycleShellExpansion(shell('open', 'snapped')), EXPANDED_SHELL);
});

test('from fully open, expanding stows both rails', () => {
  assert.deepEqual(cycleShellExpansion(OPEN_SHELL), EXPANDED_SHELL);
});

test('from fully expanded, the same control opens both again', () => {
  assert.deepEqual(cycleShellExpansion(EXPANDED_SHELL), OPEN_SHELL);
});

test('a snapped rail keeps its handle — nothing is ever hidden outright', () => {
  for (const layout of ALL) {
    for (const side of ['left', 'right']) {
      const width = railWidth(layout, side, side === 'left' ? '18rem' : '328px');
      assert.notEqual(width, '0', `${side} rail vanished in ${JSON.stringify(layout)}`);
    }
  }
  assert.equal(railWidth(EXPANDED_SHELL, 'left', '18rem'), '0.75rem');
  assert.equal(railWidth(EXPANDED_SHELL, 'right', '328px'), '0.75rem');
});

test('every nav click changes the rendered widths — nothing is a no-op', () => {
  const rendered = (l) =>
    [railWidth(l, 'left', '18rem'), railWidth(l, 'right', '328px')].join('|');
  for (const start of ALL) {
    const after = cycleShellExpansion(start);
    assert.notEqual(rendered(after), rendered(start),
      `nav control produced no visible change from ${JSON.stringify(start)}`);
  }
});

test('the nav control is reversible from anywhere in one further click', () => {
  for (const start of ALL) {
    const once = cycleShellExpansion(start);
    const twice = cycleShellExpansion(once);
    assert.deepEqual(twice, once === EXPANDED_SHELL ? OPEN_SHELL : EXPANDED_SHELL);
  }
});

test('handles are independent of each other', () => {
  assert.deepEqual(toggleRail(shell('open', 'snapped'), 'left'), EXPANDED_SHELL);
  assert.deepEqual(toggleRail(EXPANDED_SHELL, 'right'), shell('snapped', 'open'));
  assert.deepEqual(toggleRail(OPEN_SHELL, 'right'), shell('open', 'snapped'));
});

test('a handle can always bring its own rail back from expanded', () => {
  assert.deepEqual(toggleRail(EXPANDED_SHELL, 'left'), shell('open', 'snapped'));
});

test('starting a buy flow opens the right rail', () => {
  assert.deepEqual(revealRightRail(EXPANDED_SHELL), shell('snapped', 'open'));
  assert.deepEqual(revealRightRail(shell('open', 'snapped')), OPEN_SHELL);
  assert.deepEqual(revealRightRail(OPEN_SHELL), OPEN_SHELL);
});

test('centre expansion is derived from the rails, not stored beside them', () => {
  assert.equal(isCentreExpanded(EXPANDED_SHELL), true);
  assert.equal(isCentreExpanded(shell('snapped', 'open')), false);
  assert.equal(isCentreExpanded(OPEN_SHELL), false);
});

test('restore reads the current shape', () => {
  assert.deepEqual(
    restoreLayout({ activeTab: 'POSITIONS', layout: { left: 'snapped', right: 'open' } }),
    { layout: shell('snapped', 'open'), hadRailState: true },
  );
});

test('restore migrates the four-boolean shape', () => {
  assert.deepEqual(
    restoreLayout({ leftSnapped: true, rightSnapped: false }),
    { layout: shell('snapped', 'open'), hadRailState: true },
  );
});

test('a stored hidden-rails state restores as centre-expanded, handles reachable', () => {
  for (const input of [
    { centerExpanded: true, leftSnapped: false, rightSnapped: false },
    { layout: { left: 'open', right: 'open', focusMode: true } },
  ]) {
    assert.deepEqual(restoreLayout(input), { layout: EXPANDED_SHELL, hadRailState: true });
  }
});

test('empty storage yields the default and defers to the caller', () => {
  for (const input of [undefined, null, {}, { activeTab: 'POSITIONS' }]) {
    assert.deepEqual(restoreLayout(input), { layout: DEFAULT_LAYOUT, hadRailState: false });
  }
});
