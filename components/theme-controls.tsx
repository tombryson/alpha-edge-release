"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Contrast, Palette } from "lucide-react";
import styles from "./theme-controls.module.css";
import { applyInstantThemeChange } from "@/lib/theme-transition";
import { AssetClassColourDialog } from './asset-class-colour-dialog';

type ThemeId =
  | "terminal-dark"
  | "terminal-light-soft"
  | "theme1-dark"
  | "theme1-light"
  | "amber-dark"
  | "amber-light"
  | "catppuccin-dark"
  | "catppuccin-light"
  | "vintage-dark"
  | "vintage-light";

type ThemeFamily = "alpha" | "theme1" | "amber" | "catppuccin" | "vintage";

const THEME_OPTIONS: Array<{ family: ThemeFamily; label: string }> = [
  { family: "alpha", label: "alpha" },
  { family: "theme1", label: "theme1" },
  { family: "amber", label: "amber minimal" },
  { family: "catppuccin", label: "catppuccin" },
  { family: "vintage", label: "vintage paper" },
];

const THEME_MENU_WIDTH = 184;
const THEME_MENU_FALLBACK_HEIGHT = 210;
const THEME_MENU_MARGIN = 8;

const isThemeId = (value: string | null): value is ThemeId =>
  value === "terminal-dark" ||
  value === "terminal-light-soft" ||
  value === "theme1-dark" ||
  value === "theme1-light" ||
  value === "amber-dark" ||
  value === "amber-light" ||
  value === "catppuccin-dark" ||
  value === "catppuccin-light" ||
  value === "vintage-dark" ||
  value === "vintage-light";

const normalizeThemeValue = (value: string | null): ThemeId | null => {
  if (isThemeId(value)) return value;
  if (value === "light") return "terminal-light-soft";
  if (value === "dark") return "terminal-dark";
  return null;
};

const isLightTheme = (theme: ThemeId): boolean =>
  theme === "terminal-light-soft" ||
  theme === "theme1-light" ||
  theme === "amber-light" ||
  theme === "catppuccin-light" ||
  theme === "vintage-light";

const getThemeFamily = (theme: ThemeId): ThemeFamily =>
  theme === "theme1-dark" || theme === "theme1-light"
    ? "theme1"
    : theme === "amber-dark" || theme === "amber-light"
      ? "amber"
      : theme === "catppuccin-dark" || theme === "catppuccin-light"
        ? "catppuccin"
        : theme === "vintage-dark" || theme === "vintage-light"
          ? "vintage"
          : "alpha";

const resolveThemeId = (family: ThemeFamily, lightMode: boolean): ThemeId => {
  if (family === "vintage") return lightMode ? "vintage-light" : "vintage-dark";
  if (family === "catppuccin") return lightMode ? "catppuccin-light" : "catppuccin-dark";
  if (family === "amber") return lightMode ? "amber-light" : "amber-dark";
  if (family === "theme1") return lightMode ? "theme1-light" : "theme1-dark";
  return lightMode ? "terminal-light-soft" : "terminal-dark";
};

export function ThemeControls() {
  const [currentTheme, setCurrentTheme] = useState<ThemeId>("terminal-dark");
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const [showClassColours, setShowClassColours] = useState(false);
  const [themeMenuPosition, setThemeMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const themeMenuRef = useRef<HTMLDivElement | null>(null);
  const themeMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const themeMenuPanelRef = useRef<HTMLDivElement | null>(null);

  const updateThemeMenuPosition = useCallback(() => {
    if (typeof window === "undefined") return;

    const button = themeMenuButtonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const panel = themeMenuPanelRef.current;
    const menuWidth = THEME_MENU_WIDTH;
    const menuHeight = panel?.offsetHeight || THEME_MENU_FALLBACK_HEIGHT;
    const maxLeft = Math.max(THEME_MENU_MARGIN, window.innerWidth - menuWidth - THEME_MENU_MARGIN);
    const maxTop = Math.max(THEME_MENU_MARGIN, window.innerHeight - menuHeight - THEME_MENU_MARGIN);
    const preferredLeft = rect.right - menuWidth;
    const hasRoomBelow = window.innerHeight - rect.bottom >= menuHeight + THEME_MENU_MARGIN;
    const preferredTop = hasRoomBelow
      ? rect.bottom + THEME_MENU_MARGIN
      : rect.top - menuHeight - THEME_MENU_MARGIN;

    setThemeMenuPosition({
      left: Math.min(Math.max(THEME_MENU_MARGIN, preferredLeft), maxLeft),
      top: Math.min(Math.max(THEME_MENU_MARGIN, preferredTop), maxTop),
    });
  }, []);

  const getAppliedTheme = (): ThemeId => {
    if (typeof window === "undefined") return currentTheme;
    return (
      normalizeThemeValue(document.documentElement.getAttribute("data-theme")) ||
      normalizeThemeValue(window.localStorage.getItem("alpha-edge-theme")) ||
      normalizeThemeValue(window.localStorage.getItem("theme")) ||
      currentTheme ||
      "terminal-dark"
    );
  };

  const applyTheme = (nextTheme: ThemeId) => {
    applyInstantThemeChange(() => {
      const root = document.documentElement;
      root.setAttribute("data-theme", nextTheme);

      if (isLightTheme(nextTheme)) {
        root.classList.add("light");
        window.localStorage.setItem("theme", "light");
      } else {
        root.classList.remove("light");
        window.localStorage.setItem("theme", "dark");
      }

      window.localStorage.setItem("alpha-edge-theme", nextTheme);
      setCurrentTheme(nextTheme);
      setShowThemeMenu(false);
    });
  };

  useEffect(() => {
    const initialTheme =
      normalizeThemeValue(document.documentElement.getAttribute("data-theme")) ||
      normalizeThemeValue(window.localStorage.getItem("alpha-edge-theme")) ||
      normalizeThemeValue(window.localStorage.getItem("theme")) ||
      "terminal-dark";

    applyTheme(initialTheme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      if (!themeMenuRef.current) return;
      if (!themeMenuRef.current.contains(event.target as Node)) {
        setShowThemeMenu(false);
      }
    };
    document.addEventListener("mousedown", onDocumentClick);
    return () => document.removeEventListener("mousedown", onDocumentClick);
  }, []);

  useLayoutEffect(() => {
    if (!showThemeMenu) {
      setThemeMenuPosition(null);
      return;
    }

    updateThemeMenuPosition();
  }, [showThemeMenu, updateThemeMenuPosition]);

  useEffect(() => {
    if (!showThemeMenu) return;

    const onViewportChange = () => updateThemeMenuPosition();
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [showThemeMenu, updateThemeMenuPosition]);

  const appliedTheme = getAppliedTheme();
  const selectedThemeFamily = getThemeFamily(appliedTheme);
  const isLightMode = isLightTheme(appliedTheme);

  return (
    <div className="terminal-theme-controls" ref={themeMenuRef}>
      <button
        type="button"
        onClick={() => {
          const theme = getAppliedTheme();
          applyTheme(resolveThemeId(getThemeFamily(theme), !isLightTheme(theme)));
        }}
        title={isLightMode ? "Switch to dark mode" : "Switch to light mode"}
        aria-label={isLightMode ? "Switch to dark mode" : "Switch to light mode"}
        className="terminal-header-icon-button"
      >
        <Contrast aria-hidden="true" style={{ transform: isLightMode ? 'rotate(180deg)' : undefined }} />
      </button>
      <button
        ref={themeMenuButtonRef}
        type="button"
        onClick={() => {
          updateThemeMenuPosition();
          setShowThemeMenu((value) => !value);
        }}
        title="Select theme"
        aria-label="Select theme"
        aria-expanded={showThemeMenu}
        className="terminal-header-icon-button"
      >
        <Palette aria-hidden="true" className={styles.paletteIcon} style={{ strokeWidth: 2 }} />
      </button>

      {showThemeMenu && (
        <div
          ref={themeMenuPanelRef}
          className="fixed z-[1000] border border-border bg-card shadow-lg"
          style={{
            left: themeMenuPosition?.left ?? THEME_MENU_MARGIN,
            top: themeMenuPosition?.top ?? THEME_MENU_MARGIN,
            width: THEME_MENU_WIDTH,
          }}
        >
          <div className="border-b border-border px-2 py-1 text-[10px] font-mono tracking-wider text-muted-foreground">
            THEME
          </div>
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.family}
              type="button"
              onClick={() =>
                applyTheme(resolveThemeId(option.family, isLightTheme(getAppliedTheme())))
              }
              className={`w-full whitespace-nowrap px-2 py-1.5 text-left text-xs font-mono hover:bg-muted/20 ${
                selectedThemeFamily === option.family
                  ? "text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              {selectedThemeFamily === option.family ? "● " : "○ "}
              {option.label}
            </button>
          ))}
          <button type="button" className="w-full border-t border-border px-3 py-2.5 text-left text-sm text-foreground hover:bg-muted/20"
            onClick={() => { setShowThemeMenu(false); setShowClassColours(true); }}>
            Asset class colours
          </button>
        </div>
      )}
      <AssetClassColourDialog open={showClassColours} onOpenChange={setShowClassColours} returnFocusRef={themeMenuButtonRef} />
    </div>
  );
}
