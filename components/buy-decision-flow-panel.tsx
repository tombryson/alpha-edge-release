"use client";

import type { PortfolioOverlaySummaryResponse } from "@/lib/api";
import { X } from "lucide-react";

export type BuyFlowDraft = {
  ticker?: string;
  name?: string;
  assetClass?: string;
  suggestedPct?: number | null;
  qualityScore?: number | null;
  valueScore?: number | null;
  totalScore?: number | null;
  priceTarget?: number | null;
  currentPrice?: number | null;
  cdfState?: string | null;
};

type BuyDecisionFlowPanelProps = {
  draft: BuyFlowDraft;
  cashOnHand: number;
  allocatedCash: number;
  unallocatedCash: number;
  overlaySummary: PortfolioOverlaySummaryResponse | null;
  onClose: () => void;
  onOpenETFMonitor: () => void;
};

type FlowStep = {
  id: number;
  title: string;
  cta: string;
  requirements: Array<{
    label: string;
    met: boolean;
  }>;
};

function hasNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasPositiveNumber(value: unknown): value is number {
  return hasNumber(value) && value > 0;
}

function buildFlowSteps(
  draft: BuyFlowDraft,
  riskTargetsKnown: boolean,
): FlowStep[] {
  return [{
    id: 1,
    title: "Analysis",
    cta: "Complete the analysis record before sizing a buy.",
    requirements: [
      { label: "Candidate selected", met: Boolean(draft.ticker || draft.name) },
      { label: "Asset class assigned", met: Boolean(draft.assetClass) },
      { label: "Price target exists", met: hasPositiveNumber(draft.priceTarget) },
      { label: "Quality score exists", met: hasPositiveNumber(draft.qualityScore) },
      { label: "Value score exists", met: hasPositiveNumber(draft.valueScore) },
      { label: "Total rating exists", met: hasPositiveNumber(draft.totalScore) },
      { label: "Target Weight exists", met: hasPositiveNumber(draft.suggestedPct) },
    ],
  }, {
    id: 2,
    title: "Portfolio fit",
    cta: "Check the sleeve before committing funding.",
    requirements: [
      { label: "Target mix compared with current sleeve weight", met: false },
      { label: "Class room confirmed", met: false },
      { label: "10-stock sleeve limit checked", met: false },
      { label: "Q3/Q4 risk envelope visible", met: riskTargetsKnown },
    ],
  }, {
    id: 3,
    title: "Funding",
    cta: "Name the cash source and leave the second tranche in class cash.",
    requirements: [
      { label: "Class cash checked first", met: false },
      { label: "Funding source selected", met: false },
      { label: "First tranche amount calculated", met: false },
      { label: "Second tranche retained as class cash", met: false },
    ],
  }, {
    id: 4,
    title: "CDF state",
    cta: "Apply the CDF gate before deciding the entry size.",
    requirements: [
      { label: "CDF state available", met: Boolean(draft.cdfState) },
      {
        label: "Deployment cap known",
        met: Boolean(draft.cdfState) && hasPositiveNumber(draft.suggestedPct),
      },
      {
        label: "CDF gate applied to deployable size",
        met: Boolean(draft.cdfState),
      },
    ],
  }, {
    id: 5,
    title: "Entry plan",
    cta: "Stage the entry only after size and funding are clear.",
    requirements: [
      { label: "VWMA(6 high) limit checked", met: false },
      { label: "First tranche staged", met: false },
      { label: "Second tranche reserved for DCA/buy signal", met: false },
    ],
  }, {
    id: 6,
    title: "Record",
    cta: "Record the decision trail once the order is planned.",
    requirements: [
      { label: "Decision history entry prepared", met: false },
      { label: "DCA age recorded", met: false },
      { label: "External watchlist follow-up visible", met: false },
    ],
  }];
}

function isStepComplete(step: FlowStep) {
  return step.requirements.every((requirement) => requirement.met);
}

const currencyFormatter = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

const percentFormatter = new Intl.NumberFormat("en-AU", {
  maximumFractionDigits: 1,
});

function formatCurrency(value: number) {
  if (!Number.isFinite(value)) return "$0";
  return currencyFormatter.format(Math.round(value));
}

function formatPrice(value: number | null | undefined) {
  if (!hasNumber(value)) return "-";
  return `$${value.toFixed(value < 1 ? 3 : 2)}`;
}

function formatPct(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${percentFormatter.format(value)}%`;
}

export function BuyDecisionFlowPanel({
  draft,
  cashOnHand,
  allocatedCash,
  unallocatedCash,
  overlaySummary,
  onClose,
  onOpenETFMonitor,
}: BuyDecisionFlowPanelProps) {
  const q3Target =
    overlaySummary?.portfolio_risk?.inputs?.q3?.effective_target_pct ??
    overlaySummary?.spx_target_pct ??
    overlaySummary?.spy_target_pct ??
    null;
  const q4Target =
    overlaySummary?.portfolio_risk?.inputs?.q4?.target_pct ??
    overlaySummary?.q4_crisis?.target_equity_pct ??
    null;
  const riskTargetsKnown = hasNumber(q3Target) || hasNumber(q4Target);
  const flowSteps = buildFlowSteps(draft, riskTargetsKnown);
  const nextStep =
    flowSteps.find((step) => !isStepComplete(step)) ||
    flowSteps[flowSteps.length - 1];
  const nextMissingRequirement = nextStep.requirements.find(
    (requirement) => !requirement.met,
  );

  return (
    <aside
      data-testid="buy-decision-flow-panel"
      className="flex h-full min-h-0 w-full min-w-0 flex-col bg-[var(--panel-bg)] text-foreground"
    >
      <div className="shrink-0 border-b border-border/70 p-[10px]">
        <div className="flex flex-wrap items-center justify-between gap-[6px]">
            <h2 className="whitespace-nowrap text-[12px] font-bold uppercase tracking-normal">
              Buy Ledger
            </h2>
          <div className="flex shrink-0 items-center gap-[4px]">
            <button
              type="button"
              data-testid="buy-flow-open-etf"
              onClick={onOpenETFMonitor}
              className="h-[24px] rounded-[3px] border border-border/80 bg-background/60 px-[6px] text-[10px] font-semibold uppercase tracking-normal text-muted-foreground transition-colors hover:text-foreground"
            >
              ETF
            </button>
            <button
              type="button"
              data-testid="buy-flow-close"
              onClick={onClose}
              aria-label="Close buy ledger"
              title="Close buy ledger"
              className="flex h-[24px] w-[24px] items-center justify-center rounded-[3px] border border-border/80 bg-background/60 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X size={13} aria-hidden="true" />
            </button>
          </div>
        </div>
        <p className="mt-[4px] text-[11px] leading-[1.4] text-muted-foreground">
          New stock entry | System A
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-[10px] [scrollbar-width:thin]">
        <section className="rounded-[4px] border border-border/80 bg-background/45 p-[8px]">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Candidate
          </div>
          <div className="mt-2 text-[16px] font-semibold leading-tight text-foreground">
            {draft.name || draft.ticker || "No candidate selected"}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            {draft.ticker && <span>{draft.ticker}</span>}
            {draft.assetClass && <span>{draft.assetClass}</span>}
            {hasPositiveNumber(draft.suggestedPct) && (
              <span>SUGG {formatPct(draft.suggestedPct)}</span>
            )}
          </div>
          <div className="mt-[8px] grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)] gap-[4px]">
            <div className="rounded-[3px] border border-border/60 bg-background/35 p-[4px]">
              <div className="text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
                Total
              </div>
              <div className="mt-0.5 font-mono text-[12px] text-foreground">
                {hasPositiveNumber(draft.totalScore)
                  ? percentFormatter.format(draft.totalScore)
                  : "-"}
              </div>
            </div>
            <div className="rounded-[3px] border border-border/60 bg-background/35 p-[4px]">
              <div className="text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
                PT
              </div>
              <div className="mt-0.5 truncate font-mono text-[12px] text-foreground" title={formatPrice(draft.priceTarget)}>
                {formatPrice(draft.priceTarget)}
              </div>
            </div>
            <div className="rounded-[3px] border border-border/60 bg-background/35 p-[4px]">
              <div className="text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
                CDF
              </div>
              <div className="mt-0.5 truncate text-[12px] font-semibold text-foreground">
                {draft.cdfState || "-"}
              </div>
            </div>
          </div>
        </section>

        <section className="mt-[8px] rounded-[4px] border border-info/55 bg-info/[0.08] p-[8px]">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-info">
              Next action
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-info">
              Gate {nextStep.id}
            </div>
          </div>
          <div className="mt-1 text-[13px] font-semibold text-foreground">
            {nextStep.title}
          </div>
          <p className="mt-1 text-[11px] leading-[1.15rem] text-muted-foreground">
            {nextStep.cta}
          </p>
          {nextMissingRequirement && (
            <div className="mt-[6px] rounded-[3px] border border-border/70 bg-background/40 p-[6px] text-[11px] leading-[1.15rem] text-foreground">
              Blocking: {nextMissingRequirement.label}
            </div>
          )}
        </section>

        <section className="mt-4">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Gates
            </div>
            <div className="text-[10px] text-muted-foreground">
              Next: {nextStep.title}
            </div>
          </div>
          <div className="mt-[6px] space-y-[6px]">
            {flowSteps.map((step) => {
              const checked = isStepComplete(step);
              const isNext = step.id === nextStep.id && !checked;
              return (
                <div
                  key={step.id}
                  className={`rounded-[4px] border p-[8px] ${
                    isNext
                      ? "border-info/55 bg-info/10"
                      : checked
                        ? "border-primary/25 bg-primary/[0.035]"
                        : "border-border/70 bg-background/35"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground">
                      {step.id}. {step.title}
                    </span>
                    <span
                      className={`text-[9px] font-semibold uppercase tracking-[0.08em] ${
                        isNext
                          ? "text-info"
                          : checked
                            ? "text-primary"
                            : "text-muted-foreground"
                      }`}
                    >
                      {checked ? "Checked" : isNext ? "Next" : "Waiting"}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {step.requirements.map((requirement) => (
                      <li
                        key={requirement.label}
                        className="flex items-start gap-[6px] text-[11px] leading-[1.1rem]"
                      >
                        <span
                          className={`mt-[1px] w-[12px] shrink-0 text-[11px] font-semibold leading-[1.1rem] ${
                            requirement.met
                              ? "text-primary"
                              : isNext
                                ? "text-destructive"
                                : "text-muted-foreground"
                          }`}
                        >
                          {requirement.met ? "✓" : "x"}
                        </span>
                        <span
                          className={
                            requirement.met
                              ? "text-foreground"
                              : "text-muted-foreground"
                          }
                        >
                          {requirement.label}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-[10px] rounded-[4px] border border-border/75 bg-background/35 p-[8px]">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Cash Check
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 text-[11px]">
            <div>
              <div className="leading-none text-muted-foreground">
                Portfolio cash
              </div>
              <div className="mt-1 font-mono leading-none text-foreground">
                {formatCurrency(cashOnHand)}
              </div>
            </div>
            <div>
              <div className="leading-none text-muted-foreground">
                Allocated class cash
              </div>
              <div className="mt-1 font-mono leading-none text-foreground">
                {formatCurrency(allocatedCash)}
              </div>
            </div>
            <div className="col-span-2 border-t border-border/60 pt-2.5">
              <div className="leading-none text-muted-foreground">
                Unassigned reserve
              </div>
              <div className="mt-1 font-mono leading-none text-foreground">
                {formatCurrency(unallocatedCash)}
              </div>
            </div>
          </div>
          <ul className="mt-3 space-y-1.5 border-t border-border/60 pt-2.5 text-[11px] leading-[1.15rem] text-muted-foreground">
            <li>
              Source required before funding: stock sale, portfolio cash
              transfer, or external capital.
            </li>
            <li>Class cash is the first funding pool for a new buy.</li>
          </ul>
        </section>

        <section className="mt-[8px] rounded-[4px] border border-border/75 bg-background/35 p-[8px]">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Risk Envelope
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
            <div>
              <div className="leading-none text-muted-foreground">
                Q3 position
              </div>
              <div className="mt-1 font-mono leading-none text-foreground">
                {formatPct(q3Target)}
              </div>
            </div>
            <div>
              <div className="leading-none text-muted-foreground">
                Q4 position
              </div>
              <div className="mt-1 font-mono leading-none text-foreground">
                {formatPct(q4Target)}
              </div>
            </div>
          </div>
          <div className="mt-3 border-t border-border/60 pt-2.5 text-[11px] leading-[1.15rem] text-muted-foreground">
            State changes stay in Portfolio Risk actions. This ledger only reads
            the current envelope for sizing.
          </div>
        </section>
      </div>
    </aside>
  );
}
