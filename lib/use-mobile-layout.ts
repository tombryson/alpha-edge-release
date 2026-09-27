"use client";

import { useCallback, useSyncExternalStore } from "react";

export const MOBILE_LAYOUT_QUERY = "(max-width: 767px)";
export const COMPACT_SHELL_QUERY = "(max-width: 1023px)";

export function useMobileLayout(query = MOBILE_LAYOUT_QUERY) {
  const subscribe = useCallback((callback: () => void) => {
    const media = window.matchMedia(query);
    media.addEventListener("change", callback);
    return () => media.removeEventListener("change", callback);
  }, [query]);
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
