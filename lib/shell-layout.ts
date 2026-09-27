// Shell layout — the single expansion axis behind both shell controls.
//
// A rail is open or snapped. Snapped means stowed behind its 12px handle, not
// gone: the handle stays on screen and one click brings the rail back. There is
// no third "hidden" state — rails that vanish entirely leave nothing to grab,
// which is the wrong answer to "give the centre more room".
//
// Two controls act on the same axis, in the same direction:
//
//   nav tab toggle   expand the centre  ->  snap BOTH rails
//                    (from fully expanded, the same click opens both again)
//   rail handle      expand the centre by one rail  ->  snap just that one
//
// So expanding always moves rails OUT. With one rail already snapped, the nav
// toggle snaps the other one rather than reopening the first — the click
// continues the direction you were already going. Only from both-snapped does
// it reverse and open everything.
//
// Centre expansion is therefore not a stored flag; it is "both rails snapped",
// derived. The four booleans this replaced (leftSnapped, rightSnapped,
// sidePanelsHidden, centerStretched) could disagree with each other, and the
// nav control read only the last two, so with both rails snapped its click
// changed nothing you could see.
//
// This lives in lib/ rather than inline in the page so the rules above are
// testable: see tests/shell-layout.test.cjs.

export type RailSide = "left" | "right";
export type RailState = "open" | "snapped";

export type ShellLayout = {
  left: RailState;
  right: RailState;
};

/** Both rails in view. */
export const OPEN_SHELL: ShellLayout = { left: "open", right: "open" };

/** Centre at full width, both rails stowed behind their handles. */
export const EXPANDED_SHELL: ShellLayout = { left: "snapped", right: "snapped" };

export const DEFAULT_LAYOUT: ShellLayout = OPEN_SHELL;

export function isCentreExpanded(layout: ShellLayout): boolean {
  return layout.left === "snapped" && layout.right === "snapped";
}

/** A rail's own handle: stow this rail, or bring it back. */
export function toggleRail(layout: ShellLayout, side: RailSide): ShellLayout {
  return { ...layout, [side]: layout[side] === "open" ? "snapped" : "open" };
}

/** Starting a buy flow has to actually show the buy ledger, so it opens the
 *  right rail rather than assuming it is already open. */
export function revealRightRail(layout: ShellLayout): ShellLayout {
  return { ...layout, right: "open" };
}

/** The nav-bar control. Expands the centre by stowing whatever is still open;
 *  from fully expanded it reverses and opens both. Either way at least one rail
 *  moves, so the click is always visible. */
export function cycleShellExpansion(layout: ShellLayout): ShellLayout {
  return isCentreExpanded(layout) ? OPEN_SHELL : EXPANDED_SHELL;
}

/** Widths are derived in one place so no combination of state can disagree with
 *  what is on screen. A snapped rail keeps its handle's width — never zero. */
export function railWidth(
  layout: ShellLayout,
  side: RailSide,
  openWidth: string,
  handleWidth = "0.75rem",
): string {
  return layout[side] === "snapped" ? handleWidth : openWidth;
}

type PersistedLayout = Partial<ShellLayout> & {
  // Shapes this replaced, read once and migrated.
  focusMode?: boolean;
  leftSnapped?: boolean;
  rightSnapped?: boolean;
  centerExpanded?: boolean;
};

export type RestoredLayout = {
  layout: ShellLayout;
  /** False when storage said nothing about the rails, so the caller may apply
   *  its own default (narrow viewports start snapped). */
  hadRailState: boolean;
};

/** Accepts the current shape and both shapes it replaced. The old formats had a
 *  separate "panels hidden" flag; that restores as centre-expanded, which is
 *  the same amount of room for the centre with the handles still reachable. */
export function restoreLayout(saved: unknown): RestoredLayout {
  const source = (saved ?? {}) as { layout?: PersistedLayout } & PersistedLayout;
  const raw: PersistedLayout = source.layout ?? source;

  const hadNew = raw.left !== undefined || raw.right !== undefined;
  const hadOld =
    typeof raw.leftSnapped === "boolean" || typeof raw.rightSnapped === "boolean";
  const wasHidden = raw.focusMode === true || raw.centerExpanded === true;

  if (!hadNew && !hadOld && !wasHidden) {
    return { layout: DEFAULT_LAYOUT, hadRailState: false };
  }
  if (wasHidden) {
    return { layout: EXPANDED_SHELL, hadRailState: true };
  }

  const state = (next: RailState | undefined, legacy: boolean | undefined): RailState =>
    hadNew ? (next === "snapped" ? "snapped" : "open") : legacy ? "snapped" : "open";

  return {
    layout: {
      left: state(raw.left, raw.leftSnapped),
      right: state(raw.right, raw.rightSnapped),
    },
    hadRailState: true,
  };
}
