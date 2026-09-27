"use client";

import { useEffect, useId, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import styles from "./portfolio-header-stats.module.css";

type PortfolioHeaderStatsProps = {
  totalValue: number;
  cashOnHand: number;
  allocatedCash: number;
  unallocatedCash: number;
  profitLoss: number;
  profitLossPercent: number;
};

const wholeNumberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const safeNumber = (value: number | null | undefined): number => {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
};

const formatWholeNumber = (value: number | null | undefined): string =>
  wholeNumberFormatter.format(Math.round(safeNumber(value)));

const formatCurrency = (value: number | null | undefined): string =>
  `$${formatWholeNumber(value)}`;

const formatSignedCurrency = (value: number | null | undefined): string => {
  const numericValue = safeNumber(value);
  const sign = Math.round(Math.abs(numericValue)) === 0 ? "" : numericValue > 0 ? "+" : "-";
  return `${sign}${formatCurrency(Math.abs(numericValue))}`;
};

const formatPercent = (
  value: number | null | undefined,
  decimals = 2,
): string => safeNumber(value).toFixed(decimals);

export function PortfolioHeaderStats({
  totalValue,
  cashOnHand,
  allocatedCash,
  unallocatedCash,
  profitLoss,
  profitLossPercent,
}: PortfolioHeaderStatsProps) {
  const cashPct = totalValue > 0 ? ((cashOnHand || 0) / totalValue) * 100 : 0;
  const freeCash = safeNumber(unallocatedCash);
  const hasCashShortfall = freeCash < 0;
  const profitTone = profitLoss > 0 ? "gain" : profitLoss < 0 ? "loss" : "neutral";
  const roundedProfitPct = Number(formatPercent(profitLossPercent, 1));
  const profitPercent = `${roundedProfitPct > 0 ? '+' : ''}${roundedProfitPct.toFixed(1)}%`;
  const profitAmount = formatSignedCurrency(profitLoss);
  const [showProfitPercent, setShowProfitPercent] = useState(false);
  const [cashOpen, setCashOpen] = useState(false);
  const pinned = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const cashId = useId();
  const cancelClose = () => { if (closeTimer.current) clearTimeout(closeTimer.current); };
  const close = () => { cancelClose(); pinned.current = false; setCashOpen(false); };
  const preview = () => { cancelClose(); setCashOpen(true); };
  const scheduleClose = () => {
    cancelClose();
    if (pinned.current) return;
    // Allow the pointer to cross the gap into the cash breakdown.
    closeTimer.current = setTimeout(() => {
      if (!content.current?.contains(document.activeElement)) setCashOpen(false);
    }, 180);
  };
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  return (
    <div className="terminal-portfolio-stats" aria-label="Portfolio summary">
      <div className="terminal-header-stat">
        <span className="terminal-header-stat-label">Value</span>
        <span className="terminal-header-stat-value" key={totalValue}>
          {formatCurrency(totalValue)}
        </span>
      </div>
      <div className="terminal-header-stat">
        <span className="terminal-header-stat-label">Cash</span>
        <Popover.Root open={cashOpen} onOpenChange={next => next ? preview() : close()}>
        <Popover.Anchor asChild>
        <button
          ref={trigger}
          type="button"
          className={`terminal-header-stat-value ${styles.cashTrigger}`}
          aria-label={`Cash ${formatCurrency(cashOnHand)}. View breakdown`}
          aria-haspopup="dialog"
          aria-expanded={cashOpen}
          aria-controls={cashOpen ? cashId : undefined}
          onPointerEnter={event => { if (event.pointerType !== 'touch') preview(); }}
          onPointerLeave={scheduleClose}
          onFocus={preview}
          onBlur={scheduleClose}
          onClick={() => { if (pinned.current) close(); else { pinned.current = true; preview(); } }}
          onKeyDown={event => { if (event.key === 'Escape') close(); }}
        >
          {formatCurrency(cashOnHand)}
        </button>
        </Popover.Anchor>
        <Popover.Portal>
          <Popover.Content ref={content} id={cashId} className={styles.breakdown} aria-label="Cash breakdown" sideOffset={8} collisionPadding={12}
            onOpenAutoFocus={event => event.preventDefault()}
            onCloseAutoFocus={event => event.preventDefault()}
            onPointerEnter={cancelClose} onPointerLeave={scheduleClose}
            onFocusCapture={cancelClose} onBlurCapture={scheduleClose}
            onInteractOutside={event => { if (event.target instanceof Node && trigger.current?.contains(event.target)) event.preventDefault(); }}>
            <dl>
              <div><dt>Cash</dt><dd>{formatCurrency(cashOnHand)}</dd></div>
              <div><dt>Of portfolio</dt><dd>{formatPercent(cashPct)}%</dd></div>
              <div><dt>Assigned to sleeves</dt><dd>{formatCurrency(allocatedCash)}</dd></div>
              <div><dt>Unallocated</dt><dd>{formatCurrency(Math.max(0, freeCash))}</dd></div>
              {hasCashShortfall && <div className={styles.shortfall}><dt>Reserve shortfall</dt><dd>{formatCurrency(-freeCash)}</dd></div>}
            </dl>
          </Popover.Content>
        </Popover.Portal>
        </Popover.Root>
      </div>
      <div className="terminal-header-stat">
        <span className="terminal-header-stat-label">P/L</span>
        <button type="button" className={`terminal-header-stat-value ${styles.cashTrigger} ${styles.profitValue}`} data-tone={profitTone}
          aria-label="Show P/L as percentage" aria-pressed={showProfitPercent}
          onClick={() => setShowProfitPercent(value => !value)}
          style={{ minWidth: `${Math.max(profitAmount.length, profitPercent.length)}ch` }}
          title={`P/L: ${profitAmount} (${profitPercent})`}>
          {showProfitPercent ? profitPercent : profitAmount}
        </button>
      </div>
    </div>
  );
}
