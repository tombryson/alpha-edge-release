"use client"
import { subscribePoll } from '@/lib/polling'

import { useEffect, useState } from "react"
import { ChevronRight } from "lucide-react"
import {
  api,
  type PortfolioOverlayReconciliationResponse,
  type SyncChange,
} from "@/lib/api"

const money = (value?: number | null) =>
  `$${Math.round(Number(value || 0)).toLocaleString()}`

const signedMoney = (value?: number | null) => {
  const rounded = Math.round(Number(value || 0))
  if (rounded === 0) return "$0"
  return `${rounded > 0 ? "+" : "-"}$${Math.abs(rounded).toLocaleString()}`
}

const statusClass = (status?: string | null) => {
  const normalized = String(status || "").toUpperCase()
  if (normalized === "CONFIRMED" || normalized === "MATCHED") {
    return "border-emerald-500/35 bg-emerald-500/[0.08] text-emerald-200"
  }
  if (normalized === "VARIANCE") {
    return "border-destructive/40 bg-destructive/[0.06] text-destructive"
  }
  return "border-border/45 bg-background/35 text-muted-foreground"
}

const statusLabel = (status?: string | null) => {
  const normalized = String(status || "").toUpperCase()
  if (normalized === "CONFIRMED") return "Confirmed"
  if (normalized === "MATCHED") return "Matched"
  if (normalized === "VARIANCE") return "Needs review"
  if (normalized === "AWAITING_IMPORT") return "Waiting"
  return "Review"
}

const reconciliationKey = (
  reconciliation: PortfolioOverlayReconciliationResponse | null,
) =>
  reconciliation
    ? [
        reconciliation.event_id,
        reconciliation.cash?.latest_import_at || "no-import",
        reconciliation.overall_status || "",
      ].join(":")
    : null

const hasImportReview = (
  reconciliation: PortfolioOverlayReconciliationResponse | null,
) =>
  Boolean(
    reconciliation?.import_received &&
      ((reconciliation.source_checks?.length || 0) > 0 ||
        (reconciliation.asset_class_checks?.length || 0) > 0),
  )

const varianceFirst = <T extends { status?: string | null }>(
  rows: T[],
  limit: number,
): T[] => {
  const varianceRows = rows.filter(
    (item) => String(item.status || "").toUpperCase() === "VARIANCE",
  )
  const matchedRows = rows.filter(
    (item) => String(item.status || "").toUpperCase() !== "VARIANCE",
  )
  return [...varianceRows, ...matchedRows].slice(0, limit)
}

export function SyncChangesNotifier() {
  const [changes, setChanges] = useState<SyncChange[]>([])
  const [reserveReconciliation, setReserveReconciliation] =
    useState<PortfolioOverlayReconciliationResponse | null>(null)
  const [acknowledgedReconciliationKey, setAcknowledgedReconciliationKey] =
    useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [showUpdatedChanges, setShowUpdatedChanges] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const checkChanges = async () => {
      try {
        const [syncChanges, reconciliation] = await Promise.all([
          api.getSyncChanges(),
          api.getPortfolioOverlayReconciliation().catch(() => null),
        ])
        const relevant = syncChanges.filter((c) =>
          c.change_type === "ADDED" ||
          c.change_type === "UPDATED" ||
          c.change_type === "REMOVED"
        )
        const key = reconciliationKey(reconciliation)
        const shouldShowReserveReview =
          hasImportReview(reconciliation) && key !== acknowledgedReconciliationKey

        if (!cancelled && (relevant.length > 0 || shouldShowReserveReview)) {
          setChanges(relevant)
          setReserveReconciliation(
            shouldShowReserveReview ? reconciliation : null,
          )
          setShowModal(true)
        }
      } catch (error) {
        // The endpoint is optional; show no sync changes.
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    const stopPolling = subscribePoll(checkChanges, 5000)

    return () => {
      cancelled = true
      stopPolling()
    }
  }, [acknowledgedReconciliationKey])

  const handleAcknowledge = async () => {
    try {
      const key = reconciliationKey(reserveReconciliation)
      await api.acknowledgeSyncChanges()
      if (key) setAcknowledgedReconciliationKey(key)
      setShowModal(false)
      setShowUpdatedChanges(false)
      setChanges([])
      setReserveReconciliation(null)
    } catch (error) {
      console.error("[ALPHA EDGE] Failed to acknowledge changes:", error)
    }
  }

  const showReserveReview = Boolean(reserveReconciliation)
  if (isLoading || !showModal || (changes.length === 0 && !showReserveReview)) {
    return null
  }

  const addedChanges = changes.filter((c) => c.change_type === "ADDED")
  const updatedChanges = changes.filter((c) => c.change_type === "UPDATED")
  const removedChanges = changes.filter((c) => c.change_type === "REMOVED")
  const totalChanges = addedChanges.length + updatedChanges.length + removedChanges.length
  const sourceChecks = reserveReconciliation?.source_checks || []
  const classChecks = reserveReconciliation?.asset_class_checks || []
  const sourceVarianceCount = sourceChecks.filter(
    (item) => String(item.status || "").toUpperCase() === "VARIANCE"
  ).length
  const classVarianceCount = classChecks.filter(
    (item) => String(item.status || "").toUpperCase() === "VARIANCE"
  ).length
  const sourceRows = varianceFirst(sourceChecks, 12)
  const classRows = varianceFirst(classChecks, 8)

  if (showReserveReview && reserveReconciliation) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4">
        <div className="max-h-[86vh] w-full max-w-5xl overflow-auto rounded-lg border border-sky-500/30 bg-card p-5 shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-border/40 pb-4">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-sky-200">
                Reserve import review
              </div>
              <h2 className="mt-1 text-xl font-bold text-white">
                Broker import checked against the locked reserve move
              </h2>
              <p className="mt-1 max-w-3xl text-xs text-muted-foreground">
                This compares the day-before holding values, the expected values after the recorded reductions, and the latest imported holdings.
              </p>
            </div>
            <span
              className={`shrink-0 rounded border px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.08em] ${statusClass(
                reserveReconciliation.overall_status
              )}`}
            >
              {statusLabel(reserveReconciliation.overall_status)}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2">
            <div className="rounded border border-border/35 bg-background/25 px-3 py-2">
              <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-muted-foreground">
                Previous reserve
              </div>
              <div className="mt-1 font-mono text-sm text-foreground">
                {money(reserveReconciliation.cash.baseline_reserve_value)}
              </div>
            </div>
            <div className="rounded border border-border/35 bg-background/25 px-3 py-2">
              <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-muted-foreground">
                Expected reserve
              </div>
              <div className="mt-1 font-mono text-sm text-foreground">
                {money(reserveReconciliation.cash.expected_reserve_value)}
              </div>
            </div>
            <div className="rounded border border-border/35 bg-background/25 px-3 py-2">
              <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-muted-foreground">
                Imported reserve
              </div>
              <div className="mt-1 font-mono text-sm text-foreground">
                {money(reserveReconciliation.cash.imported_reserve_value)}
              </div>
            </div>
            <div className="rounded border border-border/35 bg-background/25 px-3 py-2">
              <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-muted-foreground">
                Variance
              </div>
              <div
                className={`mt-1 font-mono text-sm ${
                  Math.abs(reserveReconciliation.cash.reserve_variance || 0) > 1
                    ? "text-destructive"
                    : "text-emerald-200"
                }`}
              >
                {signedMoney(reserveReconciliation.cash.reserve_variance)}
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] gap-3">
            <div className="rounded border border-border/35 bg-background/20">
              <div className="flex items-center justify-between gap-3 border-b border-border/35 px-3 py-2">
                <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                  Holding reductions
                </div>
                <span
                  className={`rounded border px-2 py-0.5 text-[9px] font-mono uppercase ${statusClass(
                    reserveReconciliation.source_status
                  )}`}
                >
                  {sourceVarianceCount > 0
                    ? `${sourceVarianceCount} variance`
                    : statusLabel(reserveReconciliation.source_status)}
                </span>
              </div>
              <div className="max-h-[360px] overflow-auto">
                <table className="w-full text-left text-[10px]">
                  <thead className="sticky top-0 bg-card text-muted-foreground">
                    <tr className="border-b border-border/30">
                      <th className="px-3 py-2 font-mono font-normal">Holding</th>
                      <th className="px-2 py-2 text-right font-mono font-normal">Before</th>
                      <th className="px-2 py-2 text-right font-mono font-normal">Expected</th>
                      <th className="px-2 py-2 text-right font-mono font-normal">Imported</th>
                      <th className="px-3 py-2 text-right font-mono font-normal">Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourceRows.map((item) => (
                      <tr key={item.id} className="border-b border-border/20">
                        <td className="max-w-[210px] truncate px-3 py-1.5 text-foreground">
                          {item.stock_name}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">
                          {money(item.before_value)}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">
                          {money(item.expected_after_value)}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">
                          {money(item.imported_value)}
                        </td>
                        <td
                          className={`px-3 py-1.5 text-right font-mono ${
                            String(item.status || "").toUpperCase() === "VARIANCE"
                              ? "text-destructive"
                              : "text-emerald-200"
                          }`}
                        >
                          {signedMoney(item.variance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded border border-border/35 bg-background/20">
              <div className="flex items-center justify-between gap-3 border-b border-border/35 px-3 py-2">
                <div className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                  Asset classes
                </div>
                <span
                  className={`rounded border px-2 py-0.5 text-[9px] font-mono uppercase ${statusClass(
                    reserveReconciliation.asset_class_status
                  )}`}
                >
                  {classVarianceCount > 0
                    ? `${classVarianceCount} variance`
                    : statusLabel(reserveReconciliation.asset_class_status)}
                </span>
              </div>
              <div className="max-h-[360px] overflow-auto">
                {classRows.map((item) => (
                  <div
                    key={item.asset_class}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-border/20 px-3 py-2 text-[10px]"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-foreground">
                        {item.display_name || item.asset_class}
                      </div>
                      <div className="mt-0.5 font-mono text-muted-foreground">
                        {money(item.before_value)} to {money(item.expected_after_value)}
                      </div>
                    </div>
                    <div
                      className={`text-right font-mono ${
                        String(item.status || "").toUpperCase() === "VARIANCE"
                          ? "text-destructive"
                          : "text-emerald-200"
                      }`}
                    >
                      {money(item.imported_value)}
                      <div className="mt-0.5 text-muted-foreground">
                        {signedMoney(item.variance)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-5 flex justify-end">
            <button
              onClick={handleAcknowledge}
              className="rounded bg-primary px-4 py-2 text-sm font-bold text-black transition-colors hover:bg-primary/80"
            >
              Acknowledge Reserve Import
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-card border border-primary/30 rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">
            Portfolio Sync Changes
          </h2>
          <span className="text-xs text-muted-foreground">
            {totalChanges} change{totalChanges !== 1 ? "s" : ""} detected
          </span>
        </div>

        <div className="space-y-4 mb-6">
          {addedChanges.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-primary mb-2">
                ADDED ({addedChanges.length})
              </h3>
              <div className="space-y-1">
                {addedChanges.map((change) => (
                  <div
                    key={change.id}
                    className="text-xs bg-primary/10 border border-primary/20 rounded p-2"
                  >
                    <div className="font-mono text-white">
                      {change.company_name || change.ticker}
                    </div>
                    <div className="text-muted-foreground">
                      Quantity: {change.new_quantity?.toFixed(0)} | Value: $
                      {change.new_value?.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {updatedChanges.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowUpdatedChanges((expanded) => !expanded)}
                className="mb-2 inline-flex items-center gap-1 text-sm font-bold text-warning transition-colors hover:text-warning/80"
                aria-expanded={showUpdatedChanges}
              >
                <ChevronRight
                  size={14}
                  aria-hidden="true"
                  className={showUpdatedChanges ? "rotate-90 transition-transform" : "transition-transform"}
                />
                UPDATED ({updatedChanges.length})
              </button>
              {showUpdatedChanges && (
                <div className="space-y-1">
                  {updatedChanges.map((change) => (
                    <div
                      key={change.id}
                      className="text-xs bg-warning/10 border border-warning/20 rounded p-2"
                    >
                      <div className="font-mono text-white">
                        {change.company_name || change.ticker}
                      </div>
                      <div className="text-muted-foreground">
                        Quantity: {change.old_quantity?.toFixed(0)} → {change.new_quantity?.toFixed(0)} | Value: $
                        {change.old_value?.toFixed(2)} → ${change.new_value?.toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {removedChanges.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-red-500 mb-2">
                REMOVED ({removedChanges.length})
              </h3>
              <div className="space-y-1">
                {removedChanges.map((change) => (
                  <div
                    key={change.id}
                    className="text-xs bg-red-500/10 border border-red-500/20 rounded p-2"
                  >
                    <div className="font-mono text-white">
                      {change.company_name || change.ticker}
                    </div>
                    <div className="text-muted-foreground">
                      Quantity: {change.old_quantity?.toFixed(0)} | Value: $
                      {change.old_value?.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={handleAcknowledge}
            className="px-4 py-2 bg-primary text-black font-bold rounded hover:bg-primary/80 transition-colors"
          >
            Acknowledge Changes
          </button>
        </div>
      </div>
    </div>
  )
}
