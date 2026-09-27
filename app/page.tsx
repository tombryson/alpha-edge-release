"use client";

import dynamic from "next/dynamic";

// ── Always rendered — static imports so no waterfall on first load ─────────
import { StockTable } from "@/components/stock-table";
import { ContextPanel } from "@/components/context-panel/context-panel";
import { WatchlistEntryPanel } from "@/components/watchlist-opportunities";
import { WATCHLIST_ENTRY_REQUESTED } from "@/lib/watchlist-opportunities";
import { SleeveSummary } from "@/components/context-panel/sleeve-summary";
import rightSidebarStyles from "@/components/shell/right-sidebar.module.css";
import { ALERT_ACTION_REQUESTED, DECISION_HISTORY_REQUESTED, type AlertActionSelection } from "@/lib/action-presentation";
import { AlertActionDetail } from "@/components/alerts/action-detail-dialog";
import { PanelDataProvider } from "@/components/context-panel/panel-data";
import { useContextPanelStore } from "@/lib/context-panel-store";
import { SECURITY_DETAILS_REQUESTED, type SecurityNavigationDetail } from "@/lib/security-navigation";
import { AlertsPanel } from "@/components/alerts-panel";
import {
  BuyDecisionFlowPanel,
  type BuyFlowDraft,
} from "@/components/buy-decision-flow-panel";
import { DataInitializer } from "@/components/data-initializer";
import { SyncChangesNotifier } from "@/components/sync-changes-notifier";
import { ThemeControls } from "@/components/theme-controls";
import { AssetClassPalette } from "@/components/asset-class-palette";
import { TerminalUnifiedHeader } from "@/components/shell/terminal-unified-header";
import { WelcomeGuide } from "@/components/welcome-guide";
import { COMPACT_SHELL_QUERY, useMobileLayout } from "@/lib/use-mobile-layout";
import { MobileShellDialog } from "@/components/shell/mobile-shell-dialog";
import { RailHandle } from "@/components/shell/rail-handle";
import {
  DEFAULT_LAYOUT,
  cycleShellExpansion as cycleShellExpansionState,
  railWidth,
  restoreLayout,
  revealRightRail as revealRightRailState,
  toggleRail as toggleRailState,
  type RailSide,
  type ShellLayout,
} from "@/lib/shell-layout";

// ── Conditionally rendered — dynamic so their JS only loads when needed ────
// These components render null (or nothing) until real data arrives, so
// splitting them avoids paying parse cost up front.
const UnmappedAlertsModal = dynamic(
  () => import("@/components/unmapped-alerts-modal").then((m) => ({ default: m.UnmappedAlertsModal })),
  { ssr: false },
);
const RebalanceBanner = dynamic(
  () => import("@/components/rebalance-banner").then((m) => ({ default: m.RebalanceBanner })),
  { ssr: false },
);
const WebhookDeadLetterBadge = dynamic(
  () => import("@/components/webhook-dead-letter-badge").then((m) => ({ default: m.WebhookDeadLetterBadge })),
  { ssr: false },
);
const RegimeProposedActionsBanner = dynamic(
  () => import("@/components/regime-proposed-actions-banner").then((m) => ({ default: m.RegimeProposedActionsBanner })),
  { ssr: false },
);
import {
  api,
  type AssetClassConfig,
  type PortfolioOverlaySummaryResponse,
} from "@/lib/api";
import { useStore } from "@/lib/store";
import { getAccessMode } from "@/lib/access-mode";
import {
  normalizeTerminalRouteTab,
  requestTerminalTab,
  readTerminalRoute,
  type TerminalRouteTab,
} from "@/lib/terminal-route";
import { useState, useEffect, useCallback } from "react";

type AppTab = TerminalRouteTab;

type RightRailMode = "BUY_FLOW" | "TOOLS" | "WATCHLIST";

// Shell layout — see lib/shell-layout.ts. Both shell controls (each rail's
// handle, and the nav bar's toggle when you click the tab you are already on)
// expand the centre along one axis, by stowing rails behind their handles. The
// transitions live in that module so they are covered by
// tests/shell-layout.test.cjs rather than only asserted here.

export default function Page() {
  return <PanelDataProvider><TerminalPage /></PanelDataProvider>;
}

function TerminalPage() {
  const [activeTab, setActiveTab] = useState<AppTab>("POSITIONS");
  const mobile = useMobileLayout(COMPACT_SHELL_QUERY);
  const [mobilePanel, setMobilePanel] = useState<RailSide | null>(null);
  useEffect(() => { setMobilePanel(null); }, [mobile, activeTab]);
  const [layout, setLayout] = useState<ShellLayout>(DEFAULT_LAYOUT);
  const [isClient, setIsClient] = useState(false);
  const [overlaySummary, setOverlaySummary] =
    useState<PortfolioOverlaySummaryResponse | null>(null);
  const [assetClassConfig, setAssetClassConfig] = useState<AssetClassConfig[]>(
    [],
  );
  const q4CrisisActive =
    String(overlaySummary?.portfolio_risk?.mode || "").toUpperCase() ===
      "Q4_CRISIS" || Boolean(overlaySummary?.q4_crisis?.active);
  const [rightRailMode, setRightRailMode] = useState<RightRailMode>("TOOLS");
  const [buyFlowDraft, setBuyFlowDraft] = useState<BuyFlowDraft | null>(null);
  const [watchlistTicker, setWatchlistTicker] = useState("");
  const [requestedAlertAction, setRequestedAlertAction] = useState<AlertActionSelection | null>(null);
  const [positionShapeWidgetVisible, setPositionShapeWidgetVisible] =
    useState(false);
  const [positionShapeWidgetReady, setPositionShapeWidgetReady] =
    useState(false);

  // Access store state directly - let Zustand handle it
  // Use specific selectors to ensure proper reactivity
  const totalValue = useStore((state) => state.portfolio.totalValue);
  const cashOnHand = useStore((state) => state.portfolio.cashOnHand);
  const exposure = useStore((state) => state.portfolio.exposure);
  const profitLoss = useStore((state) => state.portfolio.profitLoss);
  const profitLossPercent = useStore(
    (state) => state.portfolio.profitLossPercent,
  );
  const lastSyncTime = useStore((state) => state.lastSyncTime);

  // Reconstruct portfolio for logging and calculations
  const portfolio = {
    totalValue,
    cashOnHand,
    exposure,
    profitLoss,
    profitLossPercent,
  };

  const allocatedCash = Math.round(
    assetClassConfig.reduce(
      (sum, setting) => sum + (setting.cash_reserve || 0),
      0,
    ),
  );
  const unallocatedCash = Math.round(portfolio.cashOnHand - allocatedCash);

  useEffect(() => {
    const saved = window.localStorage.getItem("alpha-edge:positions-shape-widget");
    setPositionShapeWidgetVisible(
      saved === null ? getAccessMode() !== "demo" : saved !== "false",
    );
    setPositionShapeWidgetReady(true);
  }, []);

  useEffect(() => {
    if (!positionShapeWidgetReady) return;
    window.localStorage.setItem(
      "alpha-edge:positions-shape-widget",
      String(positionShapeWidgetVisible),
    );
  }, [positionShapeWidgetReady, positionShapeWidgetVisible]);

  const toggleRail = useCallback((side: RailSide) => {
    setLayout((current) => toggleRailState(current, side));
  }, []);

  const revealRightRail = useCallback(() => {
    if (mobile) setMobilePanel("right");
    else setLayout(revealRightRailState);
  }, [mobile]);

  const cycleShellExpansion = useCallback(() => {
    if (mobile) setMobilePanel(null);
    else setLayout(cycleShellExpansionState);
  }, [mobile]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("alpha-edge-shell-ui");
      const savedPositions = window.localStorage.getItem("alpha-edge-positions-ui");
      const savedActiveTab = window.localStorage.getItem("alpha-edge-active-tab");
      let nextActiveTab: AppTab | undefined;

      if (saved) {
        const parsed = JSON.parse(saved) as { activeTab?: string };
        nextActiveTab = normalizeTerminalRouteTab(parsed.activeTab) ?? undefined;
        // restoreLayout reads both the current shape and the four-boolean one
        // it replaced, so an old browser does not land on a blank default.
        const restored = restoreLayout(parsed);
        setLayout(restored.layout);
      }

      if (savedPositions) {
        try {
          const parsedPositions = JSON.parse(savedPositions) as Partial<{
            activeTab: string;
          }>;
          nextActiveTab =
            normalizeTerminalRouteTab(parsedPositions.activeTab) ?? nextActiveTab;
        } catch {}
      }
      nextActiveTab = normalizeTerminalRouteTab(savedActiveTab) ?? nextActiveTab;
      nextActiveTab = readTerminalRoute()?.tab ?? nextActiveTab;

      if (nextActiveTab) {
        setActiveTab(nextActiveTab);
      }
    } catch {}
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!isClient) return;
    try {
      // The whole layout, not a derived boolean. Flattening focus mode and the
      // rail states into one flag is what let a reload land in a state no click
      // could reach.
      window.localStorage.setItem(
        "alpha-edge-shell-ui",
        JSON.stringify({ activeTab, layout }),
      );
      window.localStorage.setItem("alpha-edge-active-tab", activeTab);
    } catch {}
  }, [activeTab, isClient, layout]);

  useEffect(() => {
    const loadOverlaySummary = async () => {
      try {
        const data = await api.getPortfolioOverlaySummary();
        setOverlaySummary(data);
      } catch {}
    };
    loadOverlaySummary();
    const interval = setInterval(loadOverlaySummary, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const loadAssetClassConfig = async () => {
      try {
        const data = await api.getAssetClassConfig();
        setAssetClassConfig(Array.isArray(data) ? data : []);
      } catch {}
    };

    loadAssetClassConfig();
    window.addEventListener("asset-class-cash-updated", loadAssetClassConfig);
    return () => {
      window.removeEventListener(
        "asset-class-cash-updated",
        loadAssetClassConfig,
      );
    };
  }, []);

  useEffect(() => {
    const handleTabChange = (e: CustomEvent<{ tab?: string; toggleCenter?: boolean }>) => {
      const nextTab = normalizeTerminalRouteTab(e.detail?.tab);
      if (!nextTab) return;

      setActiveTab(nextTab);

      if (e.detail?.toggleCenter) {
        cycleShellExpansion();
      }
    };
    window.addEventListener("tabChange", handleTabChange as EventListener);
    return () =>
      window.removeEventListener("tabChange", handleTabChange as EventListener);
  }, [cycleShellExpansion]);

  useEffect(() => {
    const openEntry = (event: Event) => {
      const ticker = (event as CustomEvent<{ ticker: string }>).detail?.ticker;
      if (!ticker) return;
      setWatchlistTicker(ticker);
      setRightRailMode("WATCHLIST");
      revealRightRail();
    };
    window.addEventListener(WATCHLIST_ENTRY_REQUESTED, openEntry);
    return () => window.removeEventListener(WATCHLIST_ENTRY_REQUESTED, openEntry);
  }, [revealRightRail]);

  useEffect(() => {
    const handleBuyFlowStart = (e: CustomEvent<BuyFlowDraft>) => {
      setBuyFlowDraft(e.detail || {});
      setRightRailMode("BUY_FLOW");
      revealRightRail();
    };
    window.addEventListener("buy-flow:start", handleBuyFlowStart as EventListener);
    return () =>
      window.removeEventListener("buy-flow:start", handleBuyFlowStart as EventListener);
  }, [revealRightRail]);

  useEffect(() => {
    const openDetails = (event: Event) => {
      const detail = (event as CustomEvent<SecurityNavigationDetail>).detail;
      if (!detail?.ticker) return;
      const panel = useContextPanelStore.getState();
      panel.selectSecurity(detail.ticker);
      panel.setView('security');
      setRightRailMode("TOOLS");
      revealRightRail();
    };
    window.addEventListener(SECURITY_DETAILS_REQUESTED, openDetails);
    return () => window.removeEventListener(SECURITY_DETAILS_REQUESTED, openDetails);
  }, [revealRightRail]);

  useEffect(() => {
    const openAction = (event: Event) => {
      const selection = (event as CustomEvent<AlertActionSelection>).detail;
      if (!selection?.id || !selection.ticker) return;
      setRequestedAlertAction(selection);
      if (mobile) setMobilePanel(null);
      else setLayout(current => ({ ...current, left: "open" }));
    };
    window.addEventListener(ALERT_ACTION_REQUESTED, openAction);
    const closeMobilePanel = () => setMobilePanel(null);
    window.addEventListener(DECISION_HISTORY_REQUESTED, closeMobilePanel);
    return () => {
      window.removeEventListener(ALERT_ACTION_REQUESTED, openAction);
      window.removeEventListener(DECISION_HISTORY_REQUESTED, closeMobilePanel);
    };
  }, [mobile]);

  // One place resolves the state into pixels.
  const leftWidth = mobile ? "0px" : railWidth(layout, "left", "var(--shell-left-width)", "var(--shell-handle-width)");
  const rightWidth = mobile ? "0px" : railWidth(layout, "right", "var(--shell-right-width)", "var(--shell-handle-width)");

  const rightWorkspace = rightRailMode === "WATCHLIST" ? (
    <WatchlistEntryPanel ticker={watchlistTicker} onClose={mobile ? undefined : () => setRightRailMode("TOOLS")} />
  ) : rightRailMode === "BUY_FLOW" && buyFlowDraft ? (
    <BuyDecisionFlowPanel
      draft={buyFlowDraft}
      cashOnHand={portfolio.cashOnHand}
      allocatedCash={allocatedCash}
      unallocatedCash={unallocatedCash}
      overlaySummary={overlaySummary}
      onClose={() => {
        setBuyFlowDraft(null);
        setRightRailMode("TOOLS");
      }}
      onOpenETFMonitor={() => {
        setBuyFlowDraft(null);
        setRightRailMode("TOOLS");
        useContextPanelStore.getState().setView('etf');
      }}
    />
  ) : (
    <ContextPanel />
  );

  const rightPanel = (
    <div className={rightSidebarStyles.sidebar} data-testid="portfolio-sidebar">
      <div className={rightSidebarStyles.workspace} data-testid="sidebar-workspace">
        {rightWorkspace}
      </div>
      <div className={rightSidebarStyles.summaryDock} data-testid="sleeve-summary-dock">
        <SleeveSummary
          positionShapeWidgetVisible={positionShapeWidgetVisible}
          onTogglePositionShapeWidget={() =>
            setPositionShapeWidgetVisible((visible) => !visible)
          }
        />
      </div>
    </div>
  );

  return (
    <>
      <DataInitializer />
      <AssetClassPalette />
      <SyncChangesNotifier />
      <UnmappedAlertsModal />

      {/* Main Content Area */}
      <div
        className={`terminal-shell flex-1 flex flex-row gap-0 overflow-hidden min-h-0 h-screen transition-[box-shadow,border-color] ${
          q4CrisisActive ? "border border-red-500/70 shadow-[0_0_0_1px_rgba(239,68,68,0.45),0_0_26px_rgba(239,68,68,0.18)]" : ""
        }`}
        style={{
          ["--review-dock-left-inset" as string]: leftWidth,
          ["--review-dock-right-inset" as string]: rightWidth,
        }}
      >
        {/* Desktop rails retain their own saved preferences. */}
        {!mobile && <div
          data-testid="shell-left-rail"
          className="terminal-desktop-rail flex-shrink-0 relative overflow-hidden border-r border-border transition-all duration-500 ease-in-out"
          style={{
            width: leftWidth,
            ["--spacing" as string]: "0.2rem",
          }}
        >
          {/* Full panel — shifts out so only the handle is visible when snapped */}
          <div
            className="terminal-rail-content terminal-rail-content-left absolute inset-y-0 left-0 flex transition-[width,transform] duration-500 ease-in-out"
            style={{
              width: "calc(var(--shell-left-width) - 1px)",
              transform:
                layout.left === "snapped"
                  ? "translateX(calc(var(--shell-handle-width) - var(--shell-left-width)))"
                  : "translateX(0)",
            }}
          >
            <AlertsPanel overlaySummary={overlaySummary} />
          </div>
          {/* Grab handle — always on the inside edge, always visible */}
          <RailHandle
            side="left"
            snapped={layout.left === "snapped"}
            onToggle={() => toggleRail("left")}
            label="alerts panel"
          />
        </div>}

        <div
          className="terminal-center-panel flex-1 min-w-0 flex flex-col transition-all duration-500 ease-in-out px-0"
        >
          {/* Rebalance Notification Banner */}
          <RebalanceBanner />

          <TerminalUnifiedHeader
            activeTab={activeTab}
            totalValue={isClient ? totalValue : 0}
            cashOnHand={isClient ? cashOnHand : 0}
            allocatedCash={isClient ? allocatedCash : 0}
            unallocatedCash={isClient ? unallocatedCash : 0}
            profitLoss={isClient ? profitLoss : 0}
            profitLossPercent={isClient ? profitLossPercent : 0}
            lastSyncTime={isClient ? lastSyncTime : null}
            onNavigate={requestTerminalTab}
            mobile={mobile}
            onOpenAlerts={() => setMobilePanel("left")}
            onOpenETFMonitor={() => setMobilePanel("right")}
            utilities={
              isClient ? (
                <>
                  <RegimeProposedActionsBanner />
                  <WebhookDeadLetterBadge />
                  <ThemeControls />
                </>
              ) : null
            }
          />

          <WelcomeGuide />
          <div className="terminal-page-content min-h-0 flex-1 overflow-hidden">
            <StockTable
              positionShapeWidgetVisible={positionShapeWidgetVisible}
              primaryNavigationInShell
            />
          </div>
        </div>

        {/* Right sidebar — Buy Ledger / ETF Monitor */}
        {!mobile && <div
          data-testid="shell-right-rail"
          className="terminal-desktop-rail flex-shrink-0 relative overflow-hidden border-l border-border transition-all duration-500 ease-in-out"
          style={{ width: rightWidth }}
        >
          {/* Full panel — shifts out so only the handle is visible when snapped */}
          <div
            className="terminal-rail-content terminal-rail-content-right absolute inset-y-0 right-0 flex transition-[width,transform] duration-500 ease-in-out"
            style={{
              width: "calc(var(--shell-right-width) - 1px)",
              transform:
                layout.right === "snapped"
                  ? "translateX(calc(var(--shell-right-width) - var(--shell-handle-width)))"
                  : "translateX(0)",
            }}
          >
            {rightPanel}
          </div>
          <RailHandle
            side="right"
            snapped={layout.right === "snapped"}
            onToggle={() => toggleRail("right")}
            label={rightRailMode === "BUY_FLOW" ? "buy ledger" : "portfolio tools"}
          />
        </div>}
      </div>
      {mobile && (
        <>
          <MobileShellDialog open={mobilePanel === "left"} onClose={() => setMobilePanel(null)} title="Alert Stack">
            <AlertsPanel overlaySummary={overlaySummary} />
          </MobileShellDialog>
          <MobileShellDialog open={mobilePanel === "right"} onClose={() => setMobilePanel(null)} title={rightRailMode === "WATCHLIST" ? "Entry review" : rightRailMode === "BUY_FLOW" ? "Buy ledger" : "Portfolio tools"} side="right">
            {rightPanel}
          </MobileShellDialog>
        </>
      )}
      {requestedAlertAction && <AlertActionDetail key={requestedAlertAction.id} selection={requestedAlertAction} onClose={() => {
        setRequestedAlertAction(null);
        if (mobile) setMobilePanel("left");
      }} />}
    </>
  );
}
