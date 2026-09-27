const THEME_SWAP_CLASS = "theme-swap-instant";

let releaseFrame: number | null = null;

/** Apply a theme mutation without inheriting component interaction timings. */
export function applyInstantThemeChange(apply: () => void): void {
  if (typeof document === "undefined" || typeof window === "undefined") {
    apply();
    return;
  }

  const root = document.documentElement;

  if (releaseFrame !== null) {
    window.cancelAnimationFrame(releaseFrame);
    releaseFrame = null;
  }

  root.classList.add(THEME_SWAP_CLASS);
  apply();

  // Keep suppression active through one paint, then restore interaction motion.
  releaseFrame = window.requestAnimationFrame(() => {
    releaseFrame = window.requestAnimationFrame(() => {
      root.classList.remove(THEME_SWAP_CLASS);
      releaseFrame = null;
    });
  });
}
