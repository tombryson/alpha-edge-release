"use client"
import { DataFreshnessIndicator } from './data-freshness-indicator';

import { ChevronDown, MoreHorizontal, Play, X } from "lucide-react"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import "@/styles/news-workspace.css"
import toolStyles from './news-tools-menu.module.css'

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  api,
  type AssetClass,
  type NewsBriefResponse,
  type NewsDailyJob,
  type NewsFoundationJob,
  type NewsItem,
  type NewsMarketContext,
  type NewsThesis,
  type NewsThesisConvictionPoint,
  type NewsThesisDetail,
  type NewsThesisUpdate,
  type PortfolioMemoRun,
} from "@/lib/api"
import { normalizeAssetClassCode } from "@/lib/asset-class"
import { formatAssetClassName } from "@/lib/asset-classes"
import {
  buildPortfolioMemoPersistPayloadFromState,
  loadPortfolioMemoState,
} from "@/lib/portfolio-memo"

const TIMEFRAMES = ["1D", "1W", "1M", "6M", "1Y"] as const
type TimeframeFilter = typeof TIMEFRAMES[number] | "ALL"
type SentimentFilter = "ALL" | "BULLISH" | "BEARISH" | "NEUTRAL"

// ── Formatters ────────────────────────────────────────────────────────────────

function formatDate(value?: string | null) {
  if (!value) return "No run"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
}

function formatDateShort(value?: string | null) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString([], { day: "2-digit", month: "short" })
}

function safeList(values?: string[]) {
  return Array.isArray(values) ? values.filter(Boolean) : []
}

function timeframeTone(timeframe: string) {
  switch (timeframe.toUpperCase()) {
    case "1D": return "border-sky-400/45 bg-sky-400/10 text-info"
    case "1W": return "border-teal-400/45 bg-teal-400/10 text-[var(--news-teal)]"
    case "1M": return "border-violet-400/45 bg-violet-400/10 text-[var(--news-violet)]"
    case "6M": return "border-amber-400/45 bg-amber-400/10 text-warning"
    case "1Y": return "border-emerald-400/45 bg-emerald-400/10 text-success"
    default:   return "border-border/70 bg-card/60 text-muted-foreground"
  }
}

function timeframeLabel(timeframe: string) {
  return TIMEFRAMES.includes(timeframe as typeof TIMEFRAMES[number]) ? timeframe : "1D"
}

function sentimentTone(sentiment?: string) {
  switch ((sentiment || "").toUpperCase()) {
    case "BULLISH": return "border-emerald-500/40 bg-emerald-500/12 text-success"
    case "BEARISH": return "border-red-500/40 bg-red-500/12 text-destructive"
    default:        return "border-border/55 bg-background/35 text-muted-foreground"
  }
}

function sentimentLabel(sentiment?: string) {
  switch ((sentiment || "").toUpperCase()) {
    case "BULLISH": return "Bullish"
    case "BEARISH": return "Bearish"
    default:        return "Neutral"
  }
}

function statusTone(status: string) {
  switch (status.toUpperCase()) {
    case "ACTIVE":   return "border-primary/40 bg-primary/10 text-primary"
    case "WATCH":    return "border-amber-400/45 bg-amber-400/10 text-warning"
    case "RESOLVED": return "border-emerald-400/45 bg-emerald-400/10 text-success"
    case "REJECTED": return "border-border/55 text-muted-foreground"
    default:         return "border-border/55 text-muted-foreground"
  }
}

function relationshipTone(relationship: string) {
  switch (relationship.toUpperCase()) {
    case "SUPPORTS":
    case "CONFIRMS":  return "text-primary"
    case "CHALLENGES":
    case "RESOLVES":  return "text-destructive"
    case "NEW":       return "text-info"
    default:          return "text-muted-foreground"
  }
}

function relationshipLabel(relationship: string) {
  switch (relationship.toUpperCase()) {
    case "SUPPORTS":   return "Supports"
    case "CONFIRMS":   return "Confirms"
    case "CHALLENGES": return "Challenges"
    case "RESOLVES":   return "Resolves"
    case "NEW":        return "New"
    default:           return "Modifies"
  }
}

function relationshipBadgeTone(relationship: string) {
  switch (relationship.toUpperCase()) {
    case "SUPPORTS":
    case "CONFIRMS":   return "border-primary/35 bg-primary/10 text-primary"
    case "CHALLENGES": return "border-destructive/45 bg-destructive/10 text-destructive"
    case "RESOLVES":   return "border-sky-400/45 bg-sky-400/10 text-info"
    case "NEW":        return "border-info/45 bg-info/10 text-info"
    default:           return "border-border/70 bg-card/60 text-muted-foreground"
  }
}

function relationshipPriority(relationship: string) {
  switch (relationship.toUpperCase()) {
    case "CHALLENGES":
    case "RESOLVES": return 0
    case "NEW":      return 1
    case "CONFIRMS":
    case "SUPPORTS": return 2
    default:         return 3
  }
}

function formatConvictionMovement(thesis: NewsThesis, update?: NewsThesisUpdate) {
  const current = Math.round(Math.max(0, Math.min(1, thesis.conviction)) * 100)
  if (!update || !Number.isFinite(update.conviction_delta) || Math.abs(update.conviction_delta) < 0.005) {
    return `${current}%`
  }
  const previous = Math.round(Math.max(0, Math.min(1, thesis.conviction - update.conviction_delta)) * 100)
  return `${previous}% → ${current}%`
}

function formatConvictionDelta(update?: NewsThesisUpdate) {
  if (!update || !Number.isFinite(update.conviction_delta) || Math.abs(update.conviction_delta) < 0.005) {
    return "no change"
  }
  const pct = Math.round(update.conviction_delta * 100)
  return `${pct > 0 ? "+" : ""}${pct} pts`
}

function timeframeRank(timeframe: string) {
  const index = TIMEFRAMES.indexOf(timeframe as typeof TIMEFRAMES[number])
  return index === -1 ? TIMEFRAMES.length : index
}

function ledgerTimeframeRank(timeframe: string) {
  switch (timeframe.toUpperCase()) {
    case "1Y": return 0
    case "6M": return 1
    case "1M": return 2
    case "1W": return 3
    case "1D": return 4
    default:   return 5
  }
}

function timestampMs(value?: string | null) {
  if (!value) return 0
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

function impactBarColor(score: number) {
  if (score >= 0.75) return "bg-primary"
  if (score >= 0.5) return "bg-amber-400"
  return "bg-muted-foreground/50"
}

// ── Asset-class helpers ───────────────────────────────────────────────────────

function assetClassLookupKey(value?: string | null) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
}

function buildAssetClassLabelMap(assetClasses: AssetClass[]) {
  const labels = new Map<string, string>()
  for (const assetClass of assetClasses) {
    const label = formatAssetClassName(assetClass)
    labels.set(assetClassLookupKey(assetClass.code), label)
    labels.set(assetClassLookupKey(assetClass.asset_class_code), label)
    labels.set(assetClassLookupKey(assetClass.display_name), label)
  }
  return labels
}

function formatNewsAssetClass(value: string, labels?: Map<string, string>) {
  const raw = String(value || "").trim()
  const rawCode = raw.toUpperCase().replace(/[\s-]+/g, "_")
  const compactCode = raw.toUpperCase().replace(/[^A-Z0-9]/g, "")
  if (!compactCode) return "Unassigned"
  const configuredLabel = labels?.get(compactCode)
  if (configuredLabel) return configuredLabel
  const code = normalizeAssetClassCode(raw)
  if (!code || code === "UNASSIGNED") return "Unassigned"
  const normalisedLabel = labels?.get(assetClassLookupKey(code))
  if (normalisedLabel) return normalisedLabel
  return (rawCode.includes("_") ? rawCode : code)
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

function formatMarketContextValue(value: string, labels: Map<string, string>) {
  const raw = String(value || "").trim()
  if (!raw) return "Unassigned"
  const configuredLabel = labels.get(assetClassLookupKey(raw))
  if (configuredLabel) return configuredLabel
  const looksLikeCode = /^[A-Z0-9_&/ -]+$/.test(raw) && /[A-Z]{2,}|_/.test(raw)
  return looksLikeCode ? formatNewsAssetClass(raw, labels) : raw
}

// ── Primitive components ──────────────────────────────────────────────────────

function SummaryPill({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`news-count flex items-baseline gap-1.5 px-2 py-1 ${value > 0 ? tone : "text-muted-foreground"}`}>
      <div className="text-[13px] font-medium tabular-nums text-foreground">{value}</div>
      <div className="text-[11px]">{label}</div>
    </div>
  )
}

function SentimentBadge({ sentiment }: { sentiment?: string }) {
  return (
    <span className={`shrink-0 border px-1.5 py-0.5 text-[11px] font-medium ${sentimentTone(sentiment)}`}>
      {sentimentLabel(sentiment)}
    </span>
  )
}

function AssetClassChip({ value, labels }: { value: string; labels: Map<string, string> }) {
  return (
    <span className="border border-border/70 bg-background/45 px-1.5 py-0.5 text-[11px] text-muted-foreground">
      {formatNewsAssetClass(value, labels)}
    </span>
  )
}

// ── Conviction sparkline (pure SVG, no library) ───────────────────────────────

function ConvictionSparkline({
  history,
  width = 72,
  height = 22,
}: {
  history: NewsThesisConvictionPoint[]
  width?: number
  height?: number
}) {
  if (history.length < 2) {
    return <span className="tabular-nums text-[11px] text-muted-foreground">—</span>
  }
  const values = history.map((p) => Math.max(0, Math.min(1, p.conviction)))
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 0.01
  const pad = 2
  const w = width - pad * 2
  const h = height - pad * 2
  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * w
    const y = pad + h - ((v - min) / range) * h
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const isUp = values[values.length - 1] >= values[0]
  const colour = isUp ? "stroke-emerald-400" : "stroke-red-400"
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0 overflow-visible"
    >
      <polyline
        points={points.join(" ")}
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={colour}
      />
    </svg>
  )
}

// ── News item card ────────────────────────────────────────────────────────────

function NewsItemCard({
  item,
  assetClassLabels,
}: {
  item: NewsItem
  assetClassLabels: Map<string, string>
}) {
  const [expanded, setExpanded] = useState(false)
  const impactPct = Math.round(Math.max(0, Math.min(1, item.impact_score)) * 100)
  return (
    <button
      type="button"
      onClick={() => setExpanded((e) => !e)}
      aria-expanded={expanded}
      className="w-full border-b border-border/55 px-3 py-2.5 text-left news-row last:border-b-0"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="news-subject text-[13px] font-medium leading-snug text-foreground">{item.headline}</div>
          <div className="news-item-meta">
            <SentimentBadge sentiment={item.sentiment} />
            <span className={`mt-px shrink-0 border px-1 py-px text-[11px] font-medium ${timeframeTone(item.timeframe)}`}>
              {item.timeframe}
            </span>
            <span className="text-[11px] text-muted-foreground">Impact {impactPct}%</span>
          </div>
          {expanded && (
            <>
              {item.summary && (
                <div className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{item.summary}</div>
              )}
              <div className="mt-1.5 flex flex-wrap gap-1">
                {safeList(item.asset_classes).slice(0, 5).map((ac) => (
                  <AssetClassChip key={ac} value={ac} labels={assetClassLabels} />
                ))}
              </div>
              {safeList(item.sources).length > 0 && (
                <div className="mt-1 text-[11px] text-[var(--workspace-muted)]">
                  {safeList(item.sources).slice(0, 3).join(" · ")}
                </div>
              )}
            </>
          )}
        </div>
        <ChevronDown size={16} aria-hidden="true" className={`shrink-0 text-muted-foreground ${expanded ? 'rotate-180' : ''}`} />
      </div>
    </button>
  )
}

// ── Narrative change row ──────────────────────────────────────────────────────

function NarrativeChangeRow({
  thesis,
  update,
  assetClassLabels,
  selected,
  onSelect,
}: {
  thesis: NewsThesis
  update: NewsThesisUpdate
  assetClassLabels: Map<string, string>
  selected: boolean
  onSelect: () => void
}) {
  const timeframe = timeframeLabel(thesis.timeframe)
  const deltaLabel = formatConvictionDelta(update)
  const hasDelta = deltaLabel !== "no change"
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`grid w-full grid-cols-[minmax(0,1fr)_4.75rem] gap-3 border-b border-border/60 px-3 py-3 text-left news-row last:border-b-0 ${
        selected ? "news-selected" : ""
      }`}
    >
      <div className="min-w-0">
        <div className="news-subject text-[13px] font-medium leading-snug text-foreground">{thesis.title}</div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className={`shrink-0 border px-1.5 py-0.5 text-[11px] font-medium ${timeframeTone(timeframe)}`}>
            {timeframe}
          </span>
          <span className={`shrink-0 border px-1.5 py-0.5 text-[11px] font-medium ${relationshipBadgeTone(update.relationship)}`}>
            {relationshipLabel(update.relationship)}
          </span>
          <SentimentBadge sentiment={update.sentiment} />
        </div>
        <div className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          {update.evidence || thesis.summary || "No evidence text recorded."}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {safeList(thesis.asset_classes).slice(0, 4).map((ac) => (
            <AssetClassChip key={ac} value={ac} labels={assetClassLabels} />
          ))}
        </div>
      </div>
      <div className="text-right">
        <div className={`text-[12px] font-medium ${hasDelta ? relationshipTone(update.relationship) : "text-muted-foreground"}`}>
          {deltaLabel}
        </div>
        <div className="mt-1 tabular-nums text-[11px] text-muted-foreground">
          {formatConvictionMovement(thesis, update)}
        </div>
      </div>
    </button>
  )
}

// ── Ledger row (clickable, with staleness indicator) ──────────────────────────

function LedgerRow({
  thesis,
  latestUpdate,
  selected,
  onSelect,
}: {
  thesis: NewsThesis
  latestUpdate?: NewsThesisUpdate
  selected: boolean
  onSelect: () => void
}) {
  const timeframe = timeframeLabel(thesis.timeframe)
  const convictionPct = Math.round(Math.max(0, Math.min(1, thesis.conviction)) * 100)
  const detail = thesis.summary || latestUpdate?.evidence || "No thesis summary recorded."
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full border-b border-border/55 px-2.5 py-2 text-left news-row last:border-b-0 ${
        selected ? "news-selected" : ""
      }`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={`shrink-0 border px-1.5 py-0.5 text-[11px] font-medium ${timeframeTone(timeframe)}`}>
            {timeframe}
          </span>
          {thesis.stale_invalidation && (
            <span
              title="Invalidation check overdue"
              className="shrink-0 border border-amber-500/45 bg-amber-500/12 px-1 py-px text-[11px] font-medium text-warning"
            >
              ⚠ Stale
            </span>
          )}
          {latestUpdate && (
            <span className={`truncate text-[11px] font-medium ${relationshipTone(latestUpdate.relationship)}`}>
              {relationshipLabel(latestUpdate.relationship)}
            </span>
          )}
        </div>
        <span className="shrink-0 tabular-nums text-[11px] text-foreground/80">{convictionPct}%</span>
      </div>
      <div className="line-clamp-2 text-[13px] font-medium leading-snug text-foreground">{thesis.title}</div>
      <div className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-[var(--workspace-secondary)]">{detail}</div>
      <div className="mt-2 h-1 overflow-hidden bg-secondary/70">
        <div className="h-full bg-muted-foreground/55" style={{ width: `${convictionPct}%` }} />
      </div>
    </button>
  )
}

// ── Thesis detail drawer ──────────────────────────────────────────────────────

function ThesisDrawer({
  thesisId,
  assetClassLabels,
  onClose,
  onUpdated,
}: {
  thesisId: number
  assetClassLabels: Map<string, string>
  onClose: () => void
  onUpdated: () => void
}) {
  const [detail, setDetail] = useState<NewsThesisDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draftConviction, setDraftConviction] = useState(0)
  const [draftStatus, setDraftStatus] = useState("")
  const [draftTitle, setDraftTitle] = useState("")
  const [saving, setSaving] = useState(false)
  const [markingChecked, setMarkingChecked] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const [historyExpanded, setHistoryExpanded] = useState(false)

  const loadDetail = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api.getNewsThesisDetail(thesisId)
      setDetail(d)
      setDraftConviction(Math.round(d.thesis.conviction * 100))
      setDraftStatus(d.thesis.status)
      setDraftTitle(d.thesis.title)
    } catch {
      // noop — will show empty
    } finally {
      setLoading(false)
    }
  }, [thesisId])

  useEffect(() => { void loadDetail() }, [loadDetail])

  const handleSave = useCallback(async () => {
    if (!detail) return
    setSaving(true)
    try {
      await api.patchNewsThesis(thesisId, {
        conviction: draftConviction / 100,
        status: draftStatus,
        title: draftTitle,
      })
      await loadDetail()
      onUpdated()
      setEditing(false)
    } catch {
      // noop
    } finally {
      setSaving(false)
    }
  }, [detail, thesisId, draftConviction, draftStatus, draftTitle, loadDetail, onUpdated])

  const handleDismiss = useCallback(async () => {
    if (!confirm("Dismiss this thesis? It will be marked as superseded.")) return
    setDismissing(true)
    try {
      await api.deleteNewsThesis(thesisId)
      onUpdated()
      onClose()
    } catch {
      setDismissing(false)
    }
  }, [thesisId, onUpdated, onClose])

  const handleMarkChecked = useCallback(async () => {
    setMarkingChecked(true)
    try {
      await api.markInvalidationChecked(thesisId)
      await loadDetail()
    } catch {
      // noop
    } finally {
      setMarkingChecked(false)
    }
  }, [thesisId, loadDetail])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-[12px] text-muted-foreground">Loading thesis…</div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-[12px] text-muted-foreground">Thesis not found.</div>
      </div>
    )
  }

  const { thesis, updates, conviction_history } = detail
  const convictionPct = Math.round(Math.max(0, Math.min(1, thesis.conviction)) * 100)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={`shrink-0 border px-1.5 py-0.5 text-[11px] font-medium ${timeframeTone(timeframeLabel(thesis.timeframe))}`}>
              {timeframeLabel(thesis.timeframe)}
            </span>
            <span className={`shrink-0 border px-1.5 py-0.5 text-[11px] font-medium ${statusTone(thesis.status)}`}>
              {thesis.status}
            </span>
            {thesis.stale_invalidation && (
              <span className="shrink-0 border border-amber-500/45 bg-amber-500/12 px-1 py-px text-[11px] font-medium text-warning">
                ⚠ Stale
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            className="border border-border/70 bg-card px-2 py-1 text-[11px] font-medium text-foreground hover:border-primary/45"
          >
            {editing ? "Cancel" : "Edit"}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close thesis"
            title="Close thesis"
            className="border border-border/70 bg-card px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="news-body min-h-0 flex-1 overflow-auto">
        {/* Title + sparkline */}
        <div className="border-b border-border/60 px-3 py-3">
          {editing ? (
            <input
              className="w-full bg-background/35 px-2 py-1 text-[13px] font-medium text-foreground outline-none ring-1 ring-border/70 focus:ring-primary/50"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
            />
          ) : (
            <div className="text-[13px] font-medium leading-snug text-foreground">{thesis.title}</div>
          )}
          <div className="mt-2 flex items-center gap-3">
            <div className="flex-1">
              {editing ? (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>Conviction</span>
                    <span className="tabular-nums text-foreground">{draftConviction}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={draftConviction}
                    onChange={(e) => setDraftConviction(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                </div>
              ) : (
                <>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">Conviction</span>
                    <span className="tabular-nums text-[11px] text-foreground">{convictionPct}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden bg-secondary/70">
                    <div className="h-full bg-primary/70" style={{ width: `${convictionPct}%` }} />
                  </div>
                </>
              )}
            </div>
            {conviction_history.length >= 2 && (
              <ConvictionSparkline history={conviction_history} />
            )}
          </div>
          {editing && (
            <div className="mt-2 flex items-center gap-2">
              <select
                value={draftStatus}
                onChange={(e) => setDraftStatus(e.target.value)}
                className="border border-border/70 bg-background/35 px-2 py-1 text-[11px] text-foreground outline-none focus:border-primary/50"
              >
                {["ACTIVE", "WATCH", "RESOLVED", "REJECTED"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="border border-primary/45 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          )}
        </div>

        {/* Relevance */}
        {thesis.relevance_score > 0 && (
          <div className="border-b border-border/55 px-3 py-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">Portfolio relevance</span>
              <span className="tabular-nums text-foreground">{Math.round(thesis.relevance_score * 100)}%</span>
            </div>
          </div>
        )}

        {/* Asset classes */}
        {safeList(thesis.asset_classes).length > 0 && (
          <div className="border-b border-border/55 px-3 py-2">
            <div className="mb-1.5 text-[11px] text-muted-foreground">Asset classes</div>
            <div className="flex flex-wrap gap-1">
              {safeList(thesis.asset_classes).map((ac) => (
                <AssetClassChip key={ac} value={ac} labels={assetClassLabels} />
              ))}
            </div>
          </div>
        )}

        {/* Summary */}
        {thesis.summary && (
          <div className="border-b border-border/55 px-3 py-2.5">
            <div className="mb-1 text-[11px] text-muted-foreground">Summary</div>
            <div className="text-[13px] leading-relaxed text-foreground/90">{thesis.summary}</div>
          </div>
        )}

        {/* Supporting / opposing evidence */}
        {thesis.supporting_evidence && (
          <div className="border-b border-border/55 bg-success/5 px-3 py-2.5">
            <div className="mb-1 text-[11px] font-medium text-success">Supporting evidence</div>
            <div className="text-[13px] leading-relaxed text-foreground/85">{thesis.supporting_evidence}</div>
          </div>
        )}
        {thesis.opposing_evidence && (
          <div className="border-b border-border/55 bg-destructive/5 px-3 py-2.5">
            <div className="mb-1 text-[11px] font-medium text-destructive">Opposing evidence</div>
            <div className="text-[13px] leading-relaxed text-foreground/85">{thesis.opposing_evidence}</div>
          </div>
        )}

        {/* Invalidation trigger */}
        {thesis.invalidation_trigger && (
          <div className={`border-b px-3 py-2.5 ${thesis.stale_invalidation ? "border-amber-500/35 bg-amber-500/8" : "border-border/55"}`}>
            <div className="mb-1 flex items-center justify-between">
              <div className="text-[11px] font-medium text-warning">
                Invalidation trigger
              </div>
              {thesis.invalidation_check_due_at && (
                <span className="text-[11px] text-muted-foreground">
                  Due {formatDateShort(thesis.invalidation_check_due_at)}
                </span>
              )}
            </div>
            <div className="text-[13px] leading-relaxed text-foreground/85">{thesis.invalidation_trigger}</div>
            {thesis.stale_invalidation && (
              <button
                type="button"
                onClick={() => void handleMarkChecked()}
                disabled={markingChecked}
                className="mt-2 border border-amber-500/40 px-2 py-1 text-[11px] font-medium text-warning hover:bg-amber-500/10 disabled:opacity-50"
              >
                {markingChecked ? "Marking…" : "Mark checked (reset 7-day window)"}
              </button>
            )}
          </div>
        )}

        {/* Update history timeline */}
        {updates.length > 0 && (
          <div className="border-b border-border/55 px-3 py-2.5">
            <button
              type="button"
              className="flex w-full items-center justify-between text-[11px] text-muted-foreground"
              onClick={() => setHistoryExpanded((e) => !e)}
            >
              <span>Update history ({updates.length})</span>
              <span>{historyExpanded ? "▲" : "▼"}</span>
            </button>
            {historyExpanded && (
              <div className="mt-2 space-y-2">
                {updates.map((u) => (
                  <div key={u.id} className="border border-border/55 bg-background/25 px-2 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`border px-1 py-px text-[11px] font-medium ${relationshipBadgeTone(u.relationship)}`}>
                          {relationshipLabel(u.relationship)}
                        </span>
                        <SentimentBadge sentiment={u.sentiment} />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[11px] font-medium ${u.conviction_delta > 0.005 ? "text-success" : u.conviction_delta < -0.005 ? "text-destructive" : "text-muted-foreground"}`}>
                          {formatConvictionDelta(u)}
                        </span>
                        <span className="text-[11px] text-muted-foreground">{formatDateShort(u.created_at)}</span>
                      </div>
                    </div>
                    {u.evidence && (
                      <div className="mt-1 text-[12px] leading-relaxed text-[var(--workspace-secondary)]">{u.evidence}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Dismiss */}
        <div className="px-3 py-3">
          <button
            type="button"
            onClick={() => void handleDismiss()}
            disabled={dismissing}
            className="border border-destructive/40 px-3 py-1.5 text-[11px] font-medium text-destructive/80 hover:bg-destructive/10 disabled:opacity-50"
          >
            {dismissing ? "Dismissing…" : "Dismiss thesis"}
          </button>
          {thesis.slug && (
            <div className="mt-2 tabular-nums text-[11px] text-[var(--workspace-muted)]">
              slug: {thesis.slug}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Market context grid ───────────────────────────────────────────────────────

function ContextColumn({
  title,
  values,
  assetClassLabels,
}: {
  title: string
  values: string[]
  assetClassLabels: Map<string, string>
}) {
  return (
    <div className="news-context-column min-w-0 px-2 py-1">
      <div className="mb-1 flex items-center gap-1.5">
        {title.startsWith("12M") || title.startsWith("1M") ? (
          <span className={`border px-1.5 py-0.5 text-[11px] font-medium ${timeframeTone(title.startsWith("12M") ? "1Y" : "1M")}`}>
            {title.startsWith("12M") ? "1Y" : "1M"}
          </span>
        ) : null}
        <span className="terminal-workspace-group-title">
          {title.replace(/^12M\s+/i, "").replace(/^1M\s+/i, "")}
        </span>
      </div>
      {values.length ? (
        <div className="space-y-1">
          {values.slice(0, 6).map((value) => {
            const label = formatMarketContextValue(value, assetClassLabels)
            return (
              <div key={value} title={label} className="truncate text-[12px] text-foreground">{label}</div>
            )
          })}
        </div>
      ) : (
        <div className="text-[12px] text-muted-foreground">No data</div>
      )}
    </div>
  )
}

function MarketContextGrid({
  context,
  assetClassLabels,
}: {
  context?: NewsMarketContext
  assetClassLabels: Map<string, string>
}) {
  const empty: NewsMarketContext = {
    top_themes_12m: [], top_performers_12m: [], worst_performers_12m: [],
    news_themes_1m: [], top_performers_1m: [], worst_performers_1m: [],
  }
  const data = context || empty
  return (
    <div className="grid grid-cols-2 gap-2 2xl:grid-cols-3">
      <ContextColumn title="12M themes"   values={safeList(data.top_themes_12m)}      assetClassLabels={assetClassLabels} />
      <ContextColumn title="12M leaders"  values={safeList(data.top_performers_12m)}   assetClassLabels={assetClassLabels} />
      <ContextColumn title="12M laggards" values={safeList(data.worst_performers_12m)} assetClassLabels={assetClassLabels} />
      <ContextColumn title="1M themes"    values={safeList(data.news_themes_1m)}       assetClassLabels={assetClassLabels} />
      <ContextColumn title="1M leaders"   values={safeList(data.top_performers_1m)}    assetClassLabels={assetClassLabels} />
      <ContextColumn title="1M laggards"  values={safeList(data.worst_performers_1m)}  assetClassLabels={assetClassLabels} />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function NewsTab() {
  const [data, setData] = useState<NewsBriefResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timeframe, setTimeframe] = useState<TimeframeFilter>("ALL")
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>("ALL")
  const [assetClassLabels, setAssetClassLabels] = useState<Map<string, string>>(() => new Map())
  const [selectedChangeID, setSelectedChangeID] = useState<number | null>(null)
  const [selectedThesisId, setSelectedThesisId] = useState<number | null>(null)
  const [latestMemo, setLatestMemo] = useState<PortfolioMemoRun | null>(null)
  const [foundationJob, setFoundationJob] = useState<NewsFoundationJob | null>(null)
  const [dailyJob, setDailyJob] = useState<NewsDailyJob | null>(null)
  const [deduping, setDeduping] = useState(false)
  const [dedupResult, setDedupResult] = useState<string | null>(null)
  const [showItems, setShowItems] = useState(true)

  const loadNews = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.getNewsBrief()
      setData(response)
      setFoundationJob(response.foundation_job || null)
      setDailyJob(response.daily_job || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load news")
    } finally {
      setLoading(false)
    }
  }, [])

  const loadAssetClassLabels = useCallback(async () => {
    try {
      setAssetClassLabels(buildAssetClassLabelMap(await api.getAssetClasses()))
    } catch {
      setAssetClassLabels(new Map())
    }
  }, [])

  const loadLatestMemo = useCallback(async () => {
    try {
      const response = await api.getLatestPortfolioMemo()
      if (response.memo) { setLatestMemo(response.memo); return }
      const localMemo = loadPortfolioMemoState()
      const payload = localMemo ? buildPortfolioMemoPersistPayloadFromState(localMemo) : null
      if (!payload) { setLatestMemo(null); return }
      const saved = await api.savePortfolioMemo(payload)
      setLatestMemo(saved.memo)
    } catch {
      setLatestMemo(null)
    }
  }, [])

  useEffect(() => {
    void loadNews()
    void loadAssetClassLabels()
    void loadLatestMemo()
  }, [loadAssetClassLabels, loadLatestMemo, loadNews])

  // Foundation job async polling
  const startFoundationJob = useCallback(async () => {
    setError(null)
    try {
      const job = await api.createNewsFoundationJob({ sourceMemoJobId: latestMemo?.memo_job_id })
      setFoundationJob(job)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start foundation job")
    }
  }, [latestMemo?.memo_job_id])

  useEffect(() => {
    if (!foundationJob?.id || !["QUEUED", "RUNNING"].includes(foundationJob.status)) return
    let cancelled = false
    const poll = async () => {
      try {
        const next = await api.getNewsFoundationJob(foundationJob.id)
        if (cancelled) return
        setFoundationJob(next)
        if (next.status === "SUCCEEDED") { await loadNews() }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to poll foundation job")
      }
    }
    const interval = window.setInterval(() => { void poll() }, 2000)
    void poll()
    return () => { cancelled = true; window.clearInterval(interval) }
  }, [foundationJob?.id, foundationJob?.status, loadNews])

  // Daily job async polling
  const startDailyJob = useCallback(async () => {
    setError(null)
    try {
      const job = await api.createNewsDailyJob()
      setDailyJob(job)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start daily job")
    }
  }, [])

  useEffect(() => {
    if (!dailyJob?.id || !["QUEUED", "RUNNING"].includes(dailyJob.status)) return
    let cancelled = false
    const poll = async () => {
      try {
        const next = await api.getNewsDailyJob(dailyJob.id)
        if (cancelled) return
        setDailyJob(next)
        if (next.status === "SUCCEEDED") { await loadNews() }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to poll daily job")
      }
    }
    const interval = window.setInterval(() => { void poll() }, 2000)
    void poll()
    return () => { cancelled = true; window.clearInterval(interval) }
  }, [dailyJob?.id, dailyJob?.status, loadNews])

  // Deduplication
  const handleDedup = useCallback(async () => {
    setDeduping(true)
    setDedupResult(null)
    try {
      const result = await api.deduplicateNewsTheses()
      setDedupResult(result.merged === 0 ? "No duplicates found." : `Merged ${result.merged} duplicate${result.merged === 1 ? "" : "s"}.`)
      if (result.merged > 0) await loadNews()
    } catch (err) {
      setDedupResult(err instanceof Error ? err.message : "Dedup failed")
    } finally {
      setDeduping(false)
    }
  }, [loadNews])

  // Derived data
  const thesisByID = useMemo(
    () => new Map((data?.theses || []).map((thesis) => [thesis.id, thesis])),
    [data?.theses],
  )

  const latestUpdateByThesisID = useMemo(() => {
    const latest = new Map<number, NewsThesisUpdate>()
    for (const update of data?.updates || []) {
      const current = latest.get(update.thesis_id)
      if (!current || timestampMs(update.created_at) > timestampMs(current.created_at)) {
        latest.set(update.thesis_id, update)
      }
    }
    return latest
  }, [data?.updates])

  const filteredTheses = useMemo(() => {
    let theses = data?.theses || []
    if (timeframe !== "ALL") theses = theses.filter((t) => t.timeframe === timeframe)
    if (sentimentFilter !== "ALL") {
      const sentimentThesisIds = new Set(
        (data?.updates || [])
          .filter((u) => (u.sentiment || "NEUTRAL").toUpperCase() === sentimentFilter)
          .map((u) => u.thesis_id),
      )
      theses = theses.filter((t) => sentimentThesisIds.has(t.id))
    }
    return [...theses].sort((a, b) => {
      if (timeframe === "ALL") {
        const timeframeDelta = ledgerTimeframeRank(a.timeframe) - ledgerTimeframeRank(b.timeframe)
        if (timeframeDelta !== 0) return timeframeDelta
        const relDelta = (b.relevance_score || 0) - (a.relevance_score || 0)
        if (Math.abs(relDelta) > 0.001) return relDelta
      }
      const bDate = timestampMs(latestUpdateByThesisID.get(b.id)?.created_at) ||
        timestampMs(b.last_updated_at) || timestampMs(b.updated_at) || timestampMs(b.created_at)
      const aDate = timestampMs(latestUpdateByThesisID.get(a.id)?.created_at) ||
        timestampMs(a.last_updated_at) || timestampMs(a.updated_at) || timestampMs(a.created_at)
      return bDate - aDate
    })
  }, [data?.theses, data?.updates, latestUpdateByThesisID, sentimentFilter, timeframe])

  const narrativeChanges = useMemo(() => {
    return (data?.updates || [])
      .map((update) => {
        const thesis = thesisByID.get(update.thesis_id)
        return thesis ? { update, thesis } : null
      })
      .filter((e): e is { update: NewsThesisUpdate; thesis: NewsThesis } => e !== null)
      .sort((a, b) => {
        const p = relationshipPriority(a.update.relationship) - relationshipPriority(b.update.relationship)
        if (p !== 0) return p
        const i = Math.abs(b.update.conviction_delta) - Math.abs(a.update.conviction_delta)
        if (i !== 0) return i
        return timeframeRank(a.thesis.timeframe) - timeframeRank(b.thesis.timeframe)
      })
  }, [data?.updates, thesisByID])

  const changeCounts = useMemo(() => {
    const counts = { confirms: 0, challenges: 0, newItems: 0, resolves: 0 }
    for (const { update } of narrativeChanges) {
      switch (update.relationship.toUpperCase()) {
        case "SUPPORTS": case "CONFIRMS": counts.confirms++; break
        case "CHALLENGES": counts.challenges++; break
        case "NEW": counts.newItems++; break
        case "RESOLVES": counts.resolves++; break
      }
    }
    return counts
  }, [narrativeChanges])

  useEffect(() => {
    if (!narrativeChanges.length) { setSelectedChangeID(null); return }
    if (!selectedChangeID || !narrativeChanges.some(({ update }) => update.id === selectedChangeID)) {
      setSelectedChangeID(narrativeChanges[0].update.id)
    }
  }, [narrativeChanges, selectedChangeID])

  const selectedChange = useMemo(
    () => narrativeChanges.find(({ update }) => update.id === selectedChangeID),
    [narrativeChanges, selectedChangeID],
  )

  const activeFoundationJob = foundationJob || data?.foundation_job || null
  const foundationBusy = !!activeFoundationJob && ["QUEUED", "RUNNING"].includes(activeFoundationJob.status)
  const foundationProgress = Math.max(0, Math.min(100, activeFoundationJob?.progress_pct || 0))

  const dailyBusy = !!dailyJob && ["QUEUED", "RUNNING"].includes(dailyJob.status)
  const dailyProgress = Math.max(0, Math.min(100, dailyJob?.progress_pct || 0))

  const anyBusy = foundationBusy || dailyBusy

  const newsItems = data?.items || []
  const staleCount = filteredTheses.filter((t) => t.stale_invalidation).length

  return (
    <div data-news-root className="terminal-workspace terminal-workspace-controls news-workspace flex h-full min-h-0 flex-col overflow-hidden p-3">
      <div className="news-shell flex h-full min-h-0 w-full flex-col overflow-hidden">

        {/* ── Header ── */}
        <div className="terminal-workspace-header mb-3 items-start">
          <div className="min-w-0">
            <div className="terminal-workspace-title">Macro Narrative</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {data?.run
                ? `Updated ${formatDate(data.run.created_at)}`
                : "No persisted brief yet"}
            </div>
            <details className="news-provenance">
              <summary>Run details</summary>
            <div>
              {data?.run?.model && <span>{data.run.model} · </span>}
              {data?.foundation_run
                ? `Foundation ${formatDate(data.foundation_run.created_at)}`
                : "Foundation not built"}
            </div>
            {data?.foundation_cohort && (
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                Cohort {data.foundation_cohort.id} · {data.foundation_cohort.thesis_count} theses · quality {Math.round((data.foundation_cohort.quality_score || 0) * 100)}%
              </div>
            )}
            </details>
            {staleCount > 0 && (
              <div className="mt-0.5 text-[11px] font-medium text-warning">
                ⚠ {staleCount} overdue invalidation check{staleCount > 1 ? "s" : ""}
              </div>
            )}
            {dedupResult && (
              <div className="mt-0.5 text-[11px] text-muted-foreground">{dedupResult}</div>
            )}
          </div>
          <div className="news-commands flex flex-wrap items-center gap-2">
            <DataFreshnessIndicator datasets={['NEWS_DAILY']} actions={{ NEWS_DAILY: { label: 'Run daily narrative', run: startDailyJob, disabled: anyBusy } }} />
            <button
              type="button"
              onClick={() => void startDailyJob()}
              disabled={anyBusy}
              className="border border-border bg-card px-3 py-1.5 text-[11px] font-medium text-foreground hover:border-primary/45 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play size={14} aria-hidden="true" />
              {dailyBusy ? "Running…" : "Run Daily"}
            </button>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button type="button" className="news-more" title="News tools" aria-label="News tools"><MoreHorizontal size={18} /></button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className={toolStyles.menu} align="end" sideOffset={6} collisionPadding={8}>
                  <DropdownMenu.Item disabled={anyBusy} onSelect={() => void startFoundationJob()}>{foundationBusy ? "Building foundation…" : "Run Foundation"}</DropdownMenu.Item>
                  <DropdownMenu.Item disabled={anyBusy || deduping} onSelect={() => void handleDedup()}>{deduping ? "Deduplicating…" : "Deduplicate"}</DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>

        {/* ── Error banner ── */}
        {error && (
          <div className="mb-3 border border-destructive/45 bg-destructive/10 p-2 text-[12px] text-destructive">
            {error}
          </div>
        )}

        {/* ── Job progress bars ── */}
        {activeFoundationJob && activeFoundationJob.status !== "SUCCEEDED" && (
          <div className="mb-3 news-section news-job">
            <div className="news-job-heading">
              <span>Foundation {activeFoundationJob.status.toLowerCase()}</span>
              {foundationBusy && <span className="text-muted-foreground">{activeFoundationJob.stage_message || activeFoundationJob.stage}</span>}
            </div>
            {!foundationBusy && activeFoundationJob.error_message && <details className="news-job-error"><summary>Error details</summary><p>{activeFoundationJob.error_message}</p></details>}
            {foundationBusy && <div className="mt-2 h-1.5 overflow-hidden bg-muted/50">
              <div
                className={`h-full ${activeFoundationJob.status === "FAILED" ? "bg-destructive" : "bg-primary"}`}
                style={{ width: `${foundationProgress}%` }}
              />
            </div>}
          </div>
        )}
        {dailyJob && dailyJob.status !== "SUCCEEDED" && (
          <div className="mb-3 news-section news-job">
            <div className="news-job-heading">
              <span>Daily run {dailyJob.status.toLowerCase()}</span>
              {dailyBusy && <span className="text-muted-foreground">{dailyJob.stage_message || dailyJob.stage}</span>}
            </div>
            {!dailyBusy && dailyJob.error_message && <details className="news-job-error"><summary>Error details</summary><p>{dailyJob.error_message}</p></details>}
            {dailyBusy && <div className="mt-2 h-1.5 overflow-hidden bg-muted/50">
              <div
                className={`h-full ${dailyJob.status === "FAILED" ? "bg-destructive" : "bg-primary"}`}
                style={{ width: `${dailyProgress}%` }}
              />
            </div>}
          </div>
        )}

        {/* ── Main layout ── */}
        <div className="news-layout">

          {/* Left column */}
          <div className="news-primary flex min-h-0 flex-col gap-3 overflow-hidden">

            {/* Daily brief summary */}
            <section className="news-brief shrink-0 news-section px-3 py-2.5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="terminal-workspace-group-title">Daily brief</div>
                {data?.run?.run_date && (
                  <time dateTime={data.run.run_date} className="shrink-0 text-[11px] text-muted-foreground">{formatDateShort(data.run.run_date)}</time>
                )}
              </div>
              {loading ? (
                <div className="text-[13px] text-muted-foreground">Loading news state…</div>
              ) : data?.run?.daily_summary ? (
                <p className="max-w-[88ch] text-[13px] leading-relaxed text-foreground">
                  {data.run.daily_summary}
                </p>
              ) : (
                <div className="text-[13px] text-muted-foreground">
                  Run the foundation pass to create the narrative ledger.
                </div>
              )}
            </section>

            {/* News items */}
            {newsItems.length > 0 && (
              <section className="news-items flex max-h-[16rem] shrink-0 flex-col overflow-hidden news-section">
                <button
                  type="button"
                  onClick={() => setShowItems((s) => !s)}
                  aria-expanded={showItems}
                  className="news-section-header flex items-center justify-between gap-3 px-3 py-2 text-left"
                >
                  <div className="terminal-workspace-group-title">
                    News items ({newsItems.length})
                  </div>
                  <ChevronDown aria-hidden="true" size={18} className={`shrink-0 text-muted-foreground ${showItems ? "rotate-180" : ""}`} />
                </button>
                {showItems && (
                  <div className="news-body min-h-0 flex-1 overflow-auto">
                    {newsItems.map((item) => (
                      <NewsItemCard key={item.id} item={item} assetClassLabels={assetClassLabels} />
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Narrative changes */}
            <section className="news-changes flex min-h-0 flex-1 flex-col overflow-hidden news-section">
              <div className="news-section-header flex shrink-0 flex-wrap items-center justify-between gap-3 px-3 py-2">
                <div>
                  <div className="terminal-workspace-group-title">
                    Narrative changes
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">Latest evidence by affected thesis.</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <SummaryPill label="confirmed"  value={changeCounts.confirms}   tone="border-primary/30 bg-primary/10 text-primary" />
                  <SummaryPill label="challenged" value={changeCounts.challenges} tone="border-destructive/35 bg-destructive/10 text-destructive" />
                  <SummaryPill label="new"        value={changeCounts.newItems}   tone="border-info/35 bg-info/10 text-info" />
                  <SummaryPill label="resolved"   value={changeCounts.resolves}   tone="border-sky-400/35 bg-sky-400/10 text-info" />
                </div>
              </div>
              <div className="news-body min-h-0 flex-1 overflow-auto">
                {loading ? (
                  <div className="p-4 text-[13px] text-muted-foreground">Loading narrative changes…</div>
                ) : narrativeChanges.length ? (
                  narrativeChanges.map(({ update, thesis }) => (
                    <NarrativeChangeRow
                      key={update.id}
                      thesis={thesis}
                      update={update}
                      assetClassLabels={assetClassLabels}
                      selected={update.id === selectedChangeID}
                      onSelect={() => {
                        setSelectedChangeID(update.id)
                        setSelectedThesisId(thesis.id)
                      }}
                    />
                  ))
                ) : (
                  <div className="p-6 text-center text-[12px] text-muted-foreground">
                    No thesis changes recorded for the latest run.
                  </div>
                )}
              </div>
            </section>

            {/* Market context */}
            <section className="news-context shrink-0 overflow-auto news-section p-3">
              <div className="mb-2 terminal-workspace-group-title">
                Market context
              </div>
              <MarketContextGrid context={data?.run?.market_context} assetClassLabels={assetClassLabels} />
            </section>
          </div>

          {/* Right aside: ledger or thesis drawer */}
          <aside className="news-ledger flex min-h-0 flex-col overflow-hidden news-section">
            {selectedThesisId ? (
              <ThesisDrawer
                thesisId={selectedThesisId}
                assetClassLabels={assetClassLabels}
                onClose={() => setSelectedThesisId(null)}
                onUpdated={() => void loadNews()}
              />
            ) : (
              <>
                {/* Ledger header + filters */}
                <div className="news-section-header shrink-0 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="terminal-workspace-group-title">
                      Narrative ledger
                    </div>
                    <div className="text-[11px] text-muted-foreground">{filteredTheses.length}</div>
                  </div>
                  {/* Timeframe filter */}
                  <div className="news-filters mb-2 flex flex-wrap gap-1" role="group" aria-label="News timeframe">
                    {(["ALL", ...TIMEFRAMES] as TimeframeFilter[]).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setTimeframe(value)}
                        aria-pressed={timeframe === value}
                        className="px-2 py-1 font-medium"
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                  {/* Sentiment filter */}
                  <div className="news-filters flex flex-wrap gap-1" role="group" aria-label="News sentiment">
                    {(["ALL", "BULLISH", "BEARISH", "NEUTRAL"] as SentimentFilter[]).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setSentimentFilter(value)}
                        aria-pressed={sentimentFilter === value}
                        className={`px-2 py-0.5 font-medium ${value === 'BULLISH' ? 'news-filter-bull' : value === 'BEARISH' ? 'news-filter-bear' : ''}`}
                      >
                        {value === "ALL" ? "All" : sentimentLabel(value)}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Ledger rows */}
                <div className="news-body min-h-0 flex-1 overflow-auto">
                  {filteredTheses.length ? (
                    filteredTheses.map((thesis) => (
                      <LedgerRow
                        key={thesis.id}
                        thesis={thesis}
                        latestUpdate={latestUpdateByThesisID.get(thesis.id)}
                        selected={thesis.id === selectedThesisId}
                        onSelect={() => setSelectedThesisId(thesis.id)}
                      />
                    ))
                  ) : (
                    <div className="py-8 text-center text-[12px] text-muted-foreground">
                      No theses match the current filters.
                    </div>
                  )}
                </div>
              </>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
