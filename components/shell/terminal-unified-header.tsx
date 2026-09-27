"use client";

import Image from "next/image";
import { AccountAccessControl } from '@/components/access-boundary';
import { Bell, ChartNoAxesCombined, CircleHelp, Menu } from "lucide-react";
import { useEffect, useState } from "react";
import { MobileShellDialog } from "@/components/shell/mobile-shell-dialog";
import { PortfolioHeaderStats } from "@/components/shell/portfolio-header-stats";
import type { TerminalRouteTab } from "@/lib/terminal-route";

type TerminalUnifiedHeaderProps = {
  activeTab: TerminalRouteTab;
  totalValue: number;
  cashOnHand: number;
  allocatedCash: number;
  unallocatedCash: number;
  profitLoss: number;
  profitLossPercent: number;
  lastSyncTime: Date | null;
  onNavigate: (tab: TerminalRouteTab) => void;
  utilities?: React.ReactNode;
  mobile?: boolean;
  onOpenAlerts?: () => void;
  onOpenETFMonitor?: () => void;
};

const primaryTabs: Array<{ tab: TerminalRouteTab; label: string }> = [
  { tab: "POSITIONS", label: "Positions" },
  { tab: "ANALYSIS", label: "Analysis" },
  { tab: "PORTFOLIO", label: "Portfolio" },
  { tab: "SYSTEM", label: "System" },
  { tab: "MARKETS", label: "Markets" },
  { tab: "ALERTS", label: "Alerts" },
  { tab: "NEWS", label: "News" },
  { tab: "HISTORY", label: "History" },
];

const formatLastImport = (value: Date | null): string =>
  value
    ? value.toLocaleString("en-AU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "No import";

export function TerminalUnifiedHeader({
  activeTab,
  totalValue,
  cashOnHand,
  allocatedCash,
  unallocatedCash,
  profitLoss,
  profitLossPercent,
  lastSyncTime,
  onNavigate,
  utilities,
  mobile = false,
  onOpenAlerts,
  onOpenETFMonitor,
}: TerminalUnifiedHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { setMenuOpen(false); }, [activeTab, mobile]);
  const mobileNavigate = (tab: TerminalRouteTab) => {
    setMenuOpen(false);
    onNavigate(tab);
  };
  return (
    <header className="terminal-unified-header">
      <div className="terminal-brand" aria-label="Alpha Edge">
        <Image
          src="/alpha-edge-header-icon.png"
          alt="Alpha Edge"
          width={38}
          height={38}
          priority
          className="terminal-brand-mark"
        />
        <span className="terminal-brand-wordmark">Alpha Edge</span>
      </div>

      <div className="terminal-mobile-navigation">
        <button className="terminal-mobile-menu-trigger" type="button" aria-label="Open navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
          <Menu size={21} aria-hidden="true" />
          <span>{primaryTabs.find((item) => item.tab === activeTab)?.label ?? (activeTab === "ETF" ? "ETF" : "Help")}</span>
        </button>
        <button className="terminal-mobile-icon" type="button" onClick={onOpenAlerts} aria-label="Open Alert Stack" title="Alert Stack"><Bell size={20} aria-hidden="true" /></button>
        <button className="terminal-mobile-icon" type="button" onClick={onOpenETFMonitor} aria-label="Open portfolio tools" title="Portfolio tools"><ChartNoAxesCombined size={20} aria-hidden="true" /></button>
      </div>

      {mobile && (
        <MobileShellDialog open={menuOpen} onClose={() => setMenuOpen(false)} title="Navigation">
          <nav className="terminal-mobile-menu" aria-label="Mobile navigation">
            {[...primaryTabs, { tab: "ETF" as const, label: "ETF allocations" }, { tab: "HELP" as const, label: "Help" }].map(({ tab, label }) => (
              <button type="button" key={tab} aria-current={activeTab === tab ? "page" : undefined} onClick={() => mobileNavigate(tab)}>{label}</button>
            ))}
          </nav>
          <div className="terminal-mobile-utilities">{utilities}</div>
          <div className="terminal-mobile-import">Last import: {formatLastImport(lastSyncTime)}</div>
        </MobileShellDialog>
      )}

      <nav className="terminal-shell-nav" aria-label="Primary navigation">
        {primaryTabs.map(({ tab, label }) => {
          const selected = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              data-testid={`main-tab-${tab.toLowerCase()}`}
              className={`terminal-shell-nav-item ${selected ? "is-active" : ""}`}
              aria-current={selected ? "page" : undefined}
              onClick={() => onNavigate(tab)}
            >
              {label}
            </button>
          );
        })}
      </nav>

      <PortfolioHeaderStats
        totalValue={totalValue}
        cashOnHand={cashOnHand}
        allocatedCash={allocatedCash}
        unallocatedCash={unallocatedCash}
        profitLoss={profitLoss}
        profitLossPercent={profitLossPercent}
      />

      <div className="terminal-header-utilities">
        <div className="terminal-header-utility-actions">
          <AccountAccessControl />
          {!mobile && utilities}
          <button
            type="button"
            data-testid="header-help"
            onClick={() => onNavigate("HELP")}
            className={`terminal-header-icon-button ${activeTab === "HELP" ? "is-active" : ""}`}
            aria-label="Open Help"
            title="Help"
          >
            <CircleHelp aria-hidden="true" />
          </button>
        </div>
        <div className="terminal-last-import">
          <span>Last import</span>
          <strong>{formatLastImport(lastSyncTime)}</strong>
        </div>
      </div>
    </header>
  );
}
