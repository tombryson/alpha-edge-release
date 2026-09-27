"use client"

import { useEffect, useMemo, useState, type CSSProperties } from "react"
import { ArrowUpRight, Bell, ChevronDown, ChevronRight, History, Minus, Pin, Plus, TriangleAlert, X } from "lucide-react"

import { alertTypeLabel } from "@/lib/alert-format"
import { api, type AssetClassConfig, type PortfolioOverlaySummaryResponse, type SecurityPosition } from "@/lib/api"
import { useStore, type Alert as StoreAlert, type Stock } from "@/lib/store"
import styles from "./alerts-panel.module.css"
import headerStyles from "./shell/sidebar-header.module.css"
import { useSecurityActions } from "@/lib/use-security-actions"
import { ACTIONS_CHANGED, actionStatusLabel, actionCompactLabel, mergeActionAlerts, openAlertAction, openDecisionHistory } from "@/lib/action-presentation"
import actionStyles from "./alerts/action-detail.module.css"
import { assetClassColor, assetClassColourKey } from "@/lib/asset-class-identity"
import { isWatchlistStock, openWatchlistEntry } from "@/lib/watchlist-opportunities"
import { findByTicker } from "@/lib/context-panel-model"
import { getAccessMode } from "@/lib/access-mode"

function stockTicker(stock: Stock) {
  return stock.symbol?.includes(':') ? stock.symbol : `${stock.prefix || ''}${stock.symbol || ''}`
}

function findAlertStock(stocks: Stock[], ticker: string) {
  return findByTicker(stocks, ticker, stockTicker)
}

function alertSizePct(alert: StoreAlert) {
  if (alert.signal !== "TRIM") return 0
  return alert.strength === "Strong" ? 0.2 : 0.05
}

function ActionModal({
  alert,
  onClose,
  onConfirm,
}: {
  alert: StoreAlert
  onClose: () => void
  onConfirm: (units?: number) => void
}) {
  const stock = findAlertStock(useStore((state) => state.stocks), alert.symbol)
  const [units, setUnits] = useState("")
  const parsedUnits = units.trim() === "" ? undefined : Number(units)
  const validUnits = parsedUnits === undefined || (Number.isFinite(parsedUnits) && parsedUnits > 0)

  if (!stock) return null

  const pct = alertSizePct(alert)
  const qtyChange = parsedUnits ?? Math.round(stock.position * pct)
  const amountChange = stock.position > 0 ? stock.positionValue * qtyChange / stock.position : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
      <div className="terminal-action-dialog w-96 border border-border bg-card p-4" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 font-bold tracking-wide text-white">
          {signalLabel(alert.signal)} {stock.name}
        </div>
        <div className="mb-4 space-y-2 text-xs">
          <div>
            <span className="text-muted-foreground">Ticker:</span> <span className="text-white">{alert.symbol}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Suggested size:</span>{" "}
            <span className="text-white">{(pct * 100).toFixed(0)}%</span>
          </div>
          <div>
            <span className="text-muted-foreground">Current Position:</span>{" "}
            <span className="text-white">{stock.position} units</span>
          </div>
          <div>
            <span className="text-muted-foreground">Current Value:</span>{" "}
            <span className="text-white">${stock.positionValue.toLocaleString()}</span>
          </div>
          <div className="mt-2 border-t border-border pt-2">
            <span className="text-muted-foreground">Trim:</span>{" "}
            <span className="font-bold text-white">
              {qtyChange} units @ ${stock.price.toFixed(2)} (${amountChange.toFixed(2)})
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">New Position:</span>{" "}
            <span className="text-white">
              {stock.position - qtyChange} units
            </span>
          </div>
        </div>
        <label className="mb-4 block text-xs text-foreground">
          Units traded <span className="text-muted-foreground">(optional)</span>
          <input type="number" min="0" step="any" value={units}
            onChange={(event) => setUnits(event.target.value)} aria-invalid={!validUnits}
            className="mt-2 h-9 w-full border border-border bg-background px-2 text-sm text-foreground" />
        </label>
        <div className="flex gap-2">
          <button disabled={!validUnits} onClick={() => onConfirm(parsedUnits)} className="terminal-button flex-1">
            Confirm
          </button>
          <button onClick={onClose} className="terminal-button flex-1">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function BuyConfirmModal({
  alert,
  onClose,
  onConfirm,
}: {
  alert: StoreAlert
  onClose: () => void
  onConfirm: (units?: number) => void
}) {
  const [units, setUnits] = useState("")
  const parsedUnits = units.trim() === "" ? undefined : Number(units)
  const validUnits = parsedUnits === undefined || (Number.isFinite(parsedUnits) && parsedUnits > 0)
  const isClassAction = Boolean(alert.themeAssetClass)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
      <div className="terminal-action-dialog w-96 border border-border bg-card p-4" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 font-bold tracking-wide text-white">
          {alert.signal === "BUY"
            ? "Confirm Buy"
            : alert.signal === "SELL"
              ? "Confirm Liquidate"
              : alert.signal === "SELL_50"
                ? "Confirm Sell 50%"
              : alert.signal === "SELL_DOWN"
                ? "Confirm Sell 20%"
              : `Confirm ${signalLabel(alert.signal)}`}
        </div>
        <div className="mb-4 space-y-2 text-xs">
          <div>
            <span className="text-muted-foreground">Symbol:</span> <span className="text-white">{alert.symbol}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Action:</span>{" "}
            <span className="text-white">
              {alert.signal === "BUY"
                ? "Buy position"
                : alert.signal === "SELL"
                  ? "Liquidate position"
                  : alert.signal === "SELL_50"
                    ? "Sell 50% of position"
                  : alert.signal === "SELL_DOWN"
                    ? "Sell 20% of position"
                  : signalLabel(alert.signal)}
            </span>
          </div>
        </div>
        {!isClassAction && <label className="mb-4 block text-xs text-foreground">
          Units traded <span className="text-muted-foreground">(optional)</span>
          <input type="number" min="0" step="any" value={units}
            onChange={(event) => setUnits(event.target.value)} aria-invalid={!validUnits}
            className="mt-2 h-9 w-full border border-border bg-background px-2 text-sm text-foreground" />
        </label>}
        <div className="flex gap-2">
          <button disabled={!validUnits} onClick={() => onConfirm(isClassAction ? undefined : parsedUnits)} className="terminal-button flex-1">
            Confirm
          </button>
          <button onClick={onClose} className="terminal-button flex-1">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function ManualOverrideModal({
  alert,
  currentOverride,
  currentPositionState,
  onClose,
  onConfirm,
}: {
  alert: StoreAlert
  currentOverride: boolean
  currentPositionState: string
  onClose: () => void
  onConfirm: () => void
}) {
  void currentPositionState

  const isEnabling = !currentOverride
  const currentPosition = alert.signal === "BUY" ? "SELL" : "BUY"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
      <div className="terminal-action-dialog w-96 border border-border bg-card p-4" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 font-bold tracking-wide text-white">
          {isEnabling ? "Enable Manual Override" : "Disable Manual Override"}
        </div>
        <div className="mb-4 space-y-2 text-xs">
          <div>
            <span className="text-muted-foreground">Symbol:</span> <span className="text-white">{alert.symbol}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Current Position:</span>{" "}
            <span className={currentPosition === "BUY" ? "text-[#27cb2d]" : "text-[#ef4444]"}>{signalLabel(currentPosition as StoreAlert["signal"])}</span>
          </div>
          <div>
            <span className="text-muted-foreground">New Signal:</span>{" "}
            <span className={alert.signal === "BUY" ? "text-[#27cb2d]" : "text-[#ef4444]"}>{signalLabel(alert.signal)}</span>
          </div>
          <div className="mt-2 border-t border-border pt-2">
            {isEnabling ? (
              <div className="text-muted-foreground">
                This will ignore the {signalLabel(alert.signal)} signal and revert the position to{" "}
                <span className={currentPosition === "BUY" ? "text-[#27cb2d]" : "text-[#ef4444]"}>
                  {signalLabel(currentPosition as StoreAlert["signal"])} (Manual)
                </span>
                . Future buy/sell signals won't change the position automatically. Use this at your own risk. To add a
                margin of safety, cut the position in half.
              </div>
            ) : (
              <div className="text-muted-foreground">
                This will return to automatic mode. Future buy/sell signals will automatically update the position state.
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onConfirm}
            className="terminal-button flex-1"
            style={{ color: isEnabling ? "#ffff00" : "#666666" }}
          >
            {isEnabling ? `Keep as ${signalLabel(currentPosition as StoreAlert["signal"])}` : "Return to Auto"}
          </button>
          <button onClick={onClose} className="terminal-button flex-1">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

const regimeTickerToName: Record<string, string> = {
  SPY: "EQUITY",
  SPX: "EQUITY",
  XAO: "EQUITY",
  GOLD: "GOLD",
  SILVER: "SILVER",
  COPPER: "COPPER",
  XLE: "ENERGY",
  URANIUM: "URANIUM",
  XLB: "MATERIALS",
  XLF: "FINANCIALS",
  XLV: "PHARMA",
  IRON: "IRON",
  ALUMINIUM: "ALUMINIUM",
  REMX: "REE",
}

function normalizeAssetClass(value?: string | null) {
  const normalized = String(value || "").trim().toUpperCase().replace(/[\s_-]+/g, "")

  switch (normalized) {
    case "":
    case "UNASSIGNED":
      return "UNASSIGNED"
    case "XLB":
    case "MATERIALS":
      return "MATERIALS"
    case "GOLD":
    case "GOLDMINERS":
    case "PHYSICALGOLD":
      return "GOLD"
    case "SILVER":
    case "SILVERMINERS":
    case "PHYSICALSILVER":
      return "SILVER"
    case "COPPER":
    case "COPPERMINERS":
      return "COPPER"
    case "BASEMETALS":
    case "BASEMETALSMINERS":
    case "STEELMETALSPROCESSING":
    case "MATERIALSCHEMICALS":
      return "BASEMETALS"
    case "MININGSERVICES":
    case "MININGSERVICE":
    case "MININGCONTRACTORS":
    case "MININGEQUIPMENT":
      return "MINING_SERVICES"
    case "LITHIUM":
    case "LITHIUMMINERS":
      return "LITHIUM"
    case "URANIUM":
    case "URANIUMMINERS":
      return "URANIUM"
    case "REE":
    case "RAREEARTHS":
    case "RAREEARTHSCRITICALMINERALS":
      return "REE"
    case "IRON":
    case "IRONOREMINERS":
      return "IRON"
    case "ALUMINIUM":
      return "ALUMINIUM"
    case "XLE":
    case "ENERGY":
    case "ENERGYPRODUCERS":
    case "ENERGYCOMMODITIES":
      return "ENERGY"
    case "PHARMA":
    case "PHARMACEUTICALS":
    case "PHARMABIOTECH":
    case "XLV":
      return "PHARMA"
    case "HEALTHCARE":
    case "HEALTHCARESERVICES":
    case "MEDTECH":
      return "HEALTHCARE"
    case "INSURANCE":
      return "INSURANCE"
    case "XLF":
    case "FINANCIALS":
      return "FINANCIALS"
    case "STAPLES":
    case "CONSUMERSTAPLES":
      return "STAPLES"
    case "GAMBLING":
    case "GAMINGGAMBLING":
      return "GAMBLING"
    case "GAMING":
      return "GAMING"
    case "TECH":
    case "TECHNOLOGY":
    case "TECHNOLOGYPLATFORMS":
    case "SOFTWARESAAS":
    case "DATACENTRES":
    case "CRYPTODIGITALASSETS":
      return "TECHNOLOGY"
    case "SEMIS":
    case "SEMICONDUCTOR":
    case "SEMICONDUCTORS":
      return "SEMICONDUCTORS"
    case "INDUSTRIAL":
    case "INDUSTRIALS":
      return "INDUSTRIALS"
    case "DEFENCE":
    case "DEFENSE":
      return "DEFENCE"
    case "BONDS":
    case "FIXEDINCOME":
      return "BONDS"
    case "ETF":
      return "ETF"
    case "SPY":
    case "SPX":
    case "XAO":
    case "EQUITY":
    case "BROADEQUITY":
      return "EQUITY"
    case "MISC":
    case "MISCELLANEOUS":
      return "MISC"
    default:
      return normalized || "UNASSIGNED"
  }
}

function normalizeAssetConfigCode(value?: string | null) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
}

function assetClassSortOrder(value?: string | null) {
  const order: Record<string, number> = {
    MATERIALS: 100,
    GOLD: 110,
    SILVER: 120,
    COPPER: 130,
    BASEMETALS: 140,
    LITHIUM: 150,
    URANIUM: 160,
    REE: 170,
    IRON: 180,
    ALUMINIUM: 190,
    MINING_SERVICES: 195,
    ENERGY: 200,
    PHARMA: 300,
    HEALTHCARE: 310,
    FINANCIALS: 400,
    INSURANCE: 410,
    STAPLES: 500,
    GAMBLING: 510,
    GAMING: 520,
    TECHNOLOGY: 600,
    SEMICONDUCTORS: 610,
    INDUSTRIALS: 700,
    DEFENCE: 800,
    BONDS: 900,
    ETF: 910,
    EQUITY: 920,
    MISC: 990,
    UNASSIGNED: 1000,
  }

  return order[normalizeAssetClass(value)] ?? 980
}

function assetClassLabel(value: string) {
  const code = normalizeAssetConfigCode(value)
  switch (code) {
    case "STEEL_METALS_PROCESSING":
      return "Steel"
    case "MINING_SERVICES":
      return "Mining Services"
    case "MATERIALS_CHEMICALS":
      return "Chemicals"
    case "FORESTRY_PAPER_PACKAGING":
      return "Forestry"
    case "ENERGY_COMMODITIES":
      return "Commodities"
    case "MEDTECH":
      return "Medtech"
    case "TECHNOLOGY_PLATFORMS":
      return "Platforms"
    case "SOFTWARE_SAAS":
      return "Software"
    case "DATACENTRES":
      return "Datacentres"
    case "CRYPTO_DIGITAL_ASSETS":
      return "Crypto"
    case "BANKS":
      return "Banks"
    case "CONSUMER_DISCRETIONARY":
      return "Consumer"
    case "GAMING":
      return "Gaming"
    case "CIVIL_AEROSPACE":
      return "Aerospace"
    case "CONSTRUCTION_ENGINEERING":
      return "Construction"
    case "TRANSPORT_LOGISTICS":
      return "Transport"
    case "TELECOMMUNICATIONS":
      return "Telecoms"
    case "AGRICULTURE_AGRIBUSINESS":
      return "Agriculture"
    case "MEDIA_PUBLISHING":
      return "Media"
    case "REAL_ESTATE_REIT":
      return "REITs"
    case "ETF":
      return "ETF"
    case "CASH":
      return "Cash"
  }

  const normalized = normalizeAssetClass(value)

  switch (normalized) {
    case "BASEMETALS":
      return "Base Metals"
    case "REE":
      return "Rare Earths"
    case "TECHNOLOGY":
      return "Technology"
    case "SEMICONDUCTORS":
      return "Semiconductors"
    case "FINANCIALS":
      return "Financials"
    case "MISC":
      return "Misc"
    case "UNASSIGNED":
      return "Unassigned"
    default:
      return normalized.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase())
  }
}

function themeEquityRegimeTitle(assetClass: string) {
  const titles: Record<string, string> = {
    GOLD_MINERS: "Gold equities",
    SILVER_MINERS: "Silver equities",
    COPPER_MINERS: "Copper equities",
    ENERGY_PRODUCERS: "Oil producer equities",
    OIL_SERVICES: "Oil services equities",
    NATURAL_GAS_PRODUCERS: "Natural gas equities",
    URANIUM_MINERS: "Uranium equities",
    PGM_MINERS: "Platinum equities",
    LITHIUM_MINERS: "Lithium equities",
    STEEL_METALS_PROCESSING: "Steel equities",
  }
  return titles[normalizeAssetConfigCode(assetClass)] || `${assetClassLabel(assetClass)} equities`
}


function parseAffectedPositions(payload?: string | null) {
  if (!payload) return [] as Array<{ ticker: string; asset_classes_sell?: string[]; action?: string; target_position_pct: number }>

  try {
    const parsed = JSON.parse(payload)
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    console.error("[ALPHA EDGE] Failed to parse regime alert payload:", error)
    return []
  }
}

function describeRegimeAlert(signal: string, affectedPositions: Array<{ target_position_pct: number }>) {
  if (affectedPositions.length === 0) {
    return signal === "BUY" ? "Regime favorable - resume exposure" : "Regime unfavorable - reduce exposure"
  }

  const exitCount = affectedPositions.filter((item) => item.target_position_pct === 0).length
  const reduceCount = affectedPositions.filter(
    (item) => item.target_position_pct > 0 && item.target_position_pct < 100,
  ).length
  const fullCount = affectedPositions.filter((item) => item.target_position_pct === 100).length

  if (signal === "SELL") {
    const parts: string[] = []
    if (exitCount > 0) parts.push(`${exitCount} exit`)
    if (reduceCount > 0) parts.push(`${reduceCount} reduce`)
    if (parts.length > 0) return parts.join(" • ")
  }

  if (signal === "BUY" && fullCount > 0) {
    return `${fullCount} position${fullCount === 1 ? "" : "s"} can resume full exposure`
  }

  return `${affectedPositions.length} affected position${affectedPositions.length === 1 ? "" : "s"}`
}

function describeAffectedPositionAction(
  signal: string,
  item: { target_position_pct: number },
) {
  if (item.target_position_pct === 0) return "Exit"
  if (item.target_position_pct > 0 && item.target_position_pct < 100) return `Reduce to ${item.target_position_pct}%`
  return signal === "BUY" ? "Resume to 100%" : "Hold"
}

function signalLabel(signal: StoreAlert["signal"]) {
  return alertTypeLabel(signal)
}

function signalColorClass(signal: StoreAlert["signal"]) {
  if (signal === "OUTPERFORM_CONFIRMED") return styles.positive
  if (["BUY", "ADD", "BREAKOUT", "REENTRY"].includes(signal)) return styles.positive
  if (["TRIM", "SELL_50", "SELL_DOWN"].includes(signal)) return styles.caution
  return styles.negative
}

function isSizingDecisionSignal(signal: StoreAlert["signal"]): signal is "TRIM" {
  return signal === "TRIM"
}

function isPositionDecisionSignal(signal: StoreAlert["signal"]): signal is "BUY" | "SELL" | "SELL_50" | "SELL_DOWN" {
  return signal === "BUY" || signal === "SELL" || signal === "SELL_50" || signal === "SELL_DOWN"
}

function formatRelativeTime(date: Date) {
  const hours = Math.floor(Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000)) / 3600)
  const days = Math.floor(hours / 24)

  if (hours < 1) return "<1h ago"
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

function getChartUrl(symbol: string, stocks: Stock[]) {
  const stock = findAlertStock(stocks, symbol)
  const fullTicker = stock ? stockTicker(stock) : symbol
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(fullTicker)}`
}

type AlertsPanelProps = {
  overlaySummary?: PortfolioOverlaySummaryResponse | null
}

export function AlertsPanel({ overlaySummary = null }: AlertsPanelProps) {
  const readOnly = getAccessMode() === 'demo'
  const alerts = useStore((state) => state.alerts)
  const dismissAlert = useStore((state) => state.dismissAlert)
  const stocks = useStore((state) => state.stocks)
  const { actions: executionActions, managedAlertIds, error: executionError, loading: executionsLoading, refresh: refreshExecutions } = useSecurityActions()
  const actionByAlert = useMemo(() => new Map(executionActions.map(action => [String(action.alert_id), action])), [executionActions])
  const [actionError, setActionError] = useState("")

  const [modalAlert, setModalAlert] = useState<StoreAlert | null>(null)
  const [buyConfirmAlert, setBuyConfirmAlert] = useState<StoreAlert | null>(null)
  const [manualOverrideAlert, setManualOverrideAlert] = useState<StoreAlert | null>(null)
  const [positions, setPositions] = useState<SecurityPosition[]>([])
  const [assetClassConfig, setAssetClassConfig] = useState<AssetClassConfig[]>([])
  const [isClient, setIsClient] = useState(false)
  const [pinnedAssetClasses, setPinnedAssetClasses] = useState<Record<string, boolean>>({})
  const [hoverRange, setHoverRange] = useState<{ anchor: number; current: number } | null>(null)
  const [allAssetClassesExpanded, setAllAssetClassesExpanded] = useState(false)
  const [alertScope, setAlertScope] = useState<'positions' | 'watchlist'>('positions')

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("alpha-edge-alert-stack-ui")
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed.pinnedAssetClasses && typeof parsed.pinnedAssetClasses === "object") {
          setPinnedAssetClasses(parsed.pinnedAssetClasses)
        }
        if (typeof parsed.allAssetClassesExpanded === "boolean") {
          setAllAssetClassesExpanded(parsed.allAssetClassesExpanded)
        }
        if (parsed.alertScope === 'watchlist') setAlertScope('watchlist')
      }
    } catch (error) {
      console.error("[ALPHA EDGE] Failed to hydrate alert stack UI state:", error)
    }

    setIsClient(true)
    void loadPositions()
    void loadAssetClassConfig()
  }, [])

  useEffect(() => {
    if (!isClient) return

    try {
      window.localStorage.setItem(
        "alpha-edge-alert-stack-ui",
        JSON.stringify({
          pinnedAssetClasses,
          allAssetClassesExpanded,
          alertScope,
        }),
      )
    } catch (error) {
      console.error("[ALPHA EDGE] Failed to persist alert stack UI state:", error)
    }
  }, [pinnedAssetClasses, allAssetClassesExpanded, alertScope, isClient])

  const loadPositions = async () => {
    try {
      const data = await api.getSecurityPositions()
      setPositions(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error("[ALPHA EDGE] Failed to load security positions:", error)
      setPositions([])
    }
  }

  const loadAssetClassConfig = async () => {
    try {
      const data = await api.getAssetClassConfig()
      setAssetClassConfig(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error("[ALPHA EDGE] Failed to load asset class alert presentation:", error)
      setAssetClassConfig([])
    }
  }

  const handleManualOverrideConfirm = async () => {
    if (!manualOverrideAlert) return

    const position = findByTicker(positions, manualOverrideAlert.symbol, item => item.ticker)
    const newOverride = !position?.manual_override
    const revertedPosition = newOverride
      ? manualOverrideAlert.signal === "BUY"
        ? "SELL"
        : "BUY"
      : undefined

    try {
      await api.updateSecurityPosition(manualOverrideAlert.symbol, newOverride, revertedPosition)
      await loadPositions()
      await dismissAlert(manualOverrideAlert.id)
      setManualOverrideAlert(null)
    } catch (error) {
      console.error("[ALPHA EDGE] Failed to toggle manual override:", error)
      setManualOverrideAlert(null)
    }
  }

  const getPositionInfo = (ticker: string) => findByTicker(positions, ticker, item => item.ticker)

  const visibleAlerts = useMemo(
    () =>
      mergeActionAlerts(alerts, executionActions, managedAlertIds)
        .filter((alert) => !alert.dismissed && alert.signal !== "DCA")
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()),
    [alerts, executionActions, managedAlertIds],
  )

  const assetClassPresentation = useMemo(() => {
    const map = new Map<string, { label: string; color: string; sortOrder: number }>()

    assetClassConfig.forEach((setting) => {
      const code = normalizeAssetConfigCode(setting.key)
      if (!code) return
      const alias = normalizeAssetClass(code)
      const label = setting.alert_label?.trim() || assetClassLabel(alias)
      const color = assetClassColor(setting.key)
      const sortOrder =
        typeof setting.display_order === "number" && Number.isFinite(setting.display_order)
          ? setting.display_order
          : assetClassSortOrder(alias)

      const presentation = { label, color, sortOrder }
      map.set(code, presentation)

      const existingAlias = map.get(alias)
      if (!existingAlias || presentation.sortOrder < existingAlias.sortOrder) {
        map.set(alias, presentation)
      }
    })

    return map
  }, [assetClassConfig])

  const getAssetClassPresentation = (assetClass?: string | null) => {
    const code = normalizeAssetConfigCode(assetClass)
    const alias = normalizeAssetClass(assetClass)
    const presentation = (
      assetClassPresentation.get(code) ||
      assetClassPresentation.get(alias) || {
        label: assetClassLabel(alias),
        color: assetClassColor(assetClass),
        sortOrder: assetClassSortOrder(alias),
      }
    )
    return { ...presentation, color: assetClassColor(assetClass) }
  }

  const scopedAlerts = useMemo(() => {
    const scopes = { positions: [] as StoreAlert[], watchlist: [] as StoreAlert[] }
    for (const alert of visibleAlerts) {
      if (alert.alert_type === 'REGIME') continue
      const stock = findAlertStock(stocks, alert.symbol)
      const scope = !alert.themeAssetClass && stock && isWatchlistStock(stock) ? 'watchlist' : 'positions'
      scopes[scope].push(alert)
    }
    return scopes
  }, [visibleAlerts, stocks])

  const groupedAlerts = useMemo(() => {
    const groups = new Map<
      string,
      {
        key: string
        assetClass: string
        label: string
        color: string
        sortOrder: number
        items: StoreAlert[]
      }
    >()

    scopedAlerts[alertScope]
      .forEach((alert) => {
        const stock = findAlertStock(stocks, alert.symbol)
        const themeAssetClass = alert.themeAssetClass
        const assetClass = normalizeAssetClass(themeAssetClass || stock?.primaryAssetClass)
        const presentation = getAssetClassPresentation(themeAssetClass || stock?.primaryAssetClass)
        const groupKey = assetClassColourKey(themeAssetClass || stock?.primaryAssetClass)
        const existing =
          groups.get(groupKey) ||
          ({
            assetClass,
            key: groupKey,
            label: presentation.label,
            color: presentation.color,
            sortOrder: presentation.sortOrder,
            items: [],
          } satisfies {
            key: string
            assetClass: string
            label: string
            color: string
            sortOrder: number
            items: StoreAlert[]
          })
        existing.items.push(alert)
        groups.set(groupKey, existing)
      })

    return Array.from(groups.values())
      .map((group) => ({
        assetClass: group.assetClass,
        key: group.key,
        label: group.label,
        color: group.color,
        sortOrder: group.sortOrder,
        items: [...group.items].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()),
        latestTimestamp: Math.max(...group.items.map((item) => item.timestamp.getTime())),
      }))
      .sort((left, right) => {
        const byClass = left.sortOrder - right.sortOrder
        if (byClass !== 0) return byClass
        return right.latestTimestamp - left.latestTimestamp
      })
  }, [scopedAlerts, alertScope, stocks, assetClassPresentation])

  const detectorAlert = useMemo(() => {
    const risk = overlaySummary?.portfolio_risk
    const mode = String(risk?.mode || "").toUpperCase()
    if (mode === "Q4_CRISIS") {
      return {
        type: "Q4 Detector",
        status: "Crisis",
        exposureLabel: "Portfolio Risk · market exposure",
        targetPct: Math.round(risk?.target_pct ?? 10),
        className: styles.riskCrisis,
      }
    }
    if (mode === "Q3_THROTTLE") {
      return {
        type: "Q3 Detector",
        status: "Throttle",
        exposureLabel: "Portfolio Risk · Q1 exposure",
        targetPct: Math.round(risk?.target_pct ?? 0),
        className: styles.riskThrottle,
      }
    }
    return null
  }, [overlaySummary])

  const handleConfirmAction = async (alert: StoreAlert, units?: number) => {
    if (!isSizingDecisionSignal(alert.signal)) {
      console.warn("[ALPHA EDGE] Refusing to record sizing decision for unsupported alert signal:", alert.signal)
      setModalAlert(null)
      return
    }

    try {
      await api.createDecision({
        alert_id: Number(alert.id),
        decision: alert.signal,
        units,
        notes: units === undefined ? "Execution reported; units estimated" : `Execution reported: ${units} units`,
      })
    } catch (error) {
      console.error("[ALPHA EDGE] Failed to record decision:", error)
      return
    }

    await dismissAlert(alert.id)
    setModalAlert(null)
  }

  const handleBuyConfirm = async (alert: StoreAlert, units?: number) => {
    if (!isPositionDecisionSignal(alert.signal)) {
      console.warn("[ALPHA EDGE] Refusing to record position decision for unsupported alert signal:", alert.signal)
      setBuyConfirmAlert(null)
      return
    }

    try {
      await api.createDecision({
        alert_id: Number(alert.id),
        decision: alert.signal,
        units,
      })
    } catch (error) {
      console.error("[ALPHA EDGE] Failed to record decision:", error)
      return
    }

    await dismissAlert(alert.id)
    setBuyConfirmAlert(null)
  }

  const handleIgnore = async (alert: StoreAlert) => {
    if (readOnly || executionsLoading || executionError) return
    setActionError("")
    const action = actionByAlert.get(alert.id)
    if (action) {
      if (action.intent === "EXIT" || action.status !== "OPEN" || !action.is_primary) return
      try {
        await api.ignoreSecurityAction(action.id)
        window.dispatchEvent(new Event(ACTIONS_CHANGED))
        await useStore.getState().fetchAlerts()
        await refreshExecutions()
        setActionError("")
      } catch (error) { setActionError(error instanceof Error ? error.message : "The alert could not be ignored.") }
      return
    }
    try {
      await api.createDecision({
        alert_id: Number(alert.id),
        decision: "IGNORE",
      })
    } catch (error) {
      console.error("[ALPHA EDGE] Failed to record ignore decision:", error)
      setActionError("The alert could not be ignored.")
      return
    }

    await dismissAlert(alert.id)
  }

  const openAlert = (alert: StoreAlert) => {
    const stock = findAlertStock(stocks, alert.symbol)
    if (!alert.themeAssetClass && stock && isWatchlistStock(stock)) {
      setActionError("")
      openWatchlistEntry(stockTicker(stock))
      return
    }
    if (executionsLoading || executionError) {
      setActionError("Execution status must load before this alert can be actioned.")
      return
    }
    const action = actionByAlert.get(alert.id)
    if (action) {
      setActionError("")
      openAlertAction(action)
      return
    }
    if (isSizingDecisionSignal(alert.signal)) {
      setModalAlert(alert)
      return
    }

    if (isPositionDecisionSignal(alert.signal)) {
      setBuyConfirmAlert(alert)
    }
  }

  return (
    <>
      {modalAlert && (
        <ActionModal
          alert={modalAlert}
          key={modalAlert.id}
          onClose={() => setModalAlert(null)}
          onConfirm={(units) => handleConfirmAction(modalAlert, units)}
        />
      )}

      {buyConfirmAlert && (
        <BuyConfirmModal
          alert={buyConfirmAlert}
          key={buyConfirmAlert.id}
          onClose={() => setBuyConfirmAlert(null)}
          onConfirm={(units) => handleBuyConfirm(buyConfirmAlert, units)}
        />
      )}

      {manualOverrideAlert && (
        <ManualOverrideModal
          alert={manualOverrideAlert}
          currentOverride={getPositionInfo(manualOverrideAlert.symbol)?.manual_override || false}
          currentPositionState={getPositionInfo(manualOverrideAlert.symbol)?.position_state || "BUY"}
          onClose={() => setManualOverrideAlert(null)}
          onConfirm={handleManualOverrideConfirm}
        />
      )}

      <div className={`${styles.panel} panel-border`}>
        <div className={`${headerStyles.header} ${styles.panelHeader}`}>
          <h2 className={headerStyles.title}>
            <Bell className={headerStyles.icon} strokeWidth={1.75} aria-hidden="true" />
            <span>ALERT STACK</span>
          </h2>
        </div>

        <div className={styles.scrollArea}>
          {executionError && <div role="alert" className={actionStyles.error}>
            {executionError}
            <button type="button" className={actionStyles.button} onClick={() => void refreshExecutions()}>Retry status</button>
          </div>}
          {!executionError && actionError && <div role="alert" className={actionStyles.error}>
            {actionError}
            <button type="button" className={actionStyles.button} aria-label="Dismiss error" onClick={() => setActionError("")}><X size={14} aria-hidden="true" /></button>
          </div>}
          {isClient && detectorAlert && (
            <div className={detectorAlert.className}>
              <h3 className={styles.riskHeading}>
                PORTFOLIO RISK
              </h3>
              <div className={styles.riskCard}>
                <div className={styles.riskCardHeader}>
                  <div className={styles.riskTitle}><TriangleAlert size={16} aria-hidden="true" />{detectorAlert.type}</div>
                  <div className={styles.riskStatus}>{detectorAlert.status}</div>
                </div>
                <div className={styles.riskDetail}>{detectorAlert.exposureLabel}</div>
                <div className={styles.riskTarget}>
                  <span>Target</span>
                  <span className={styles.riskValue}>{detectorAlert.targetPct}%</span>
                </div>
              </div>
            </div>
          )}

          {isClient && visibleAlerts.filter((alert) => alert.alert_type === "REGIME").length > 0 && (
            <div>
              <h3 className={`${styles.sectionTitle} ${styles.portfolioHeading}`}>
                <TriangleAlert size={14} aria-hidden="true" />PORTFOLIO ALERTS
              </h3>
              <div className={styles.regimeList}>
                {visibleAlerts
                  .filter((alert) => alert.alert_type === "REGIME")
                  .map((alert) => {
                    const rawTicker = alert.symbol.replace("REGIME:", "")
                    const displayName = regimeTickerToName[rawTicker] || rawTicker
                    const affectedPositions = parseAffectedPositions(alert.affected_positions)

                    return (
                      <div key={alert.id} className={styles.regimeAlert}>
                        <div className={styles.regimeHeader}>
                          <div className={styles.regimeIdentity}>
                            <div className={styles.regimeTitle}>
                              <span>{displayName}</span>
                              <span className={`${styles.signal} ${signalColorClass(alert.signal)}`}>
                                {signalLabel(alert.signal)}
                              </span>
                            </div>
                            <div className={styles.regimeDetail}>
                              {describeRegimeAlert(alert.signal, affectedPositions)}
                            </div>
                          </div>
                          <div className={styles.alertAge} suppressHydrationWarning>
                            {formatRelativeTime(alert.timestamp)}
                          </div>
                        </div>

                        {affectedPositions.length > 0 && (
                          <div className={styles.affectedList}>
                            {affectedPositions.slice(0, 4).map((item) => (
                              <div
                                key={`${alert.id}-${item.ticker}-${item.target_position_pct}`}
                                className={styles.affectedRow}
                              >
                                <div className="min-w-0">
                                  <div className={styles.affectedTicker}>{item.ticker}</div>
                                  <div className={styles.regimeDetail}>
                                    {item.asset_classes_sell && item.asset_classes_sell.length > 0
                                      ? `SELL classes: ${item.asset_classes_sell.join(", ")}`
                                      : item.action}
                                  </div>
                                </div>
                                <div
                                  className={`${styles.affectedAction} ${
                                    item.target_position_pct === 0
                                      ? styles.negative
                                      : item.target_position_pct < 100
                                        ? styles.caution
                                        : styles.positive
                                  }`}
                                >
                                  {describeAffectedPositionAction(alert.signal, item)}
                                </div>
                              </div>
                            ))}
                            {affectedPositions.length > 4 && (
                              <div className={styles.regimeDetail}>+{affectedPositions.length - 4} more affected positions</div>
                            )}
                          </div>
                        )}

                        <div className={styles.regimeActions}>
                          <button
                            onClick={async () => {
                              await dismissAlert(alert.id)
                            }}
                            className={styles.regimeAction}
                          >
                            Acknowledge
                          </button>
                          <a
                            href={`https://www.tradingview.com/chart/?symbol=${
                              {
                                SPY: "AMEX:SPY",
                                SPX: "SP:SPX",
                                XAO: "ASX:XJO",
                                GOLD: "TVC:GOLD",
                                SILVER: "TVC:SILVER",
                                XLV: "AMEX:XLV",
                                XLF: "AMEX:XLF",
                                XLB: "AMEX:XLB",
                                XLE: "AMEX:XLE",
                                REMX: "AMEX:REMX",
                              }[rawTicker] || rawTicker
                            }`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.regimeAction}
                          >
                            Chart
                          </a>
                        </div>
                      </div>
                    )
                  })}
              </div>
            </div>
          )}

          {isClient && (
            <div>
              <div className={styles.sectionHeader}>
                <nav className={styles.scopeTabs} aria-label="Alert scope">
                  {(['positions', 'watchlist'] as const).map(scope => (
                    <button key={scope} type="button" aria-pressed={alertScope === scope}
                      aria-label={`${scope === 'positions' ? 'Positions' : 'Watchlist'}, ${scopedAlerts[scope].length} alerts`}
                      onClick={() => { setAlertScope(scope); setHoverRange(null) }}>
                      <span>{scope === 'positions' ? 'Positions' : 'Watchlist'}</span>
                      <span className={styles.sectionCount} aria-hidden="true">{scopedAlerts[scope].length}</span>
                    </button>
                  ))}
                </nav>
                <button
                  type="button"
                  title={allAssetClassesExpanded ? "Collapse all asset classes" : "Expand all asset classes"}
                  aria-label={allAssetClassesExpanded ? "Collapse all asset classes" : "Expand all asset classes"}
                  aria-expanded={allAssetClassesExpanded}
                  onClick={() => setAllAssetClassesExpanded((current) => !current)}
                  className={styles.expandButton}
                >
                  {allAssetClassesExpanded ? <Minus size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
                </button>
              </div>
              <div key={alertScope} className={styles.groupList} onMouseLeave={() => setHoverRange(null)}>
                {groupedAlerts.map((group, index) => {
                  const pinned = pinnedAssetClasses[group.key] ?? Object.entries(pinnedAssetClasses).some(
                    ([key, value]) => value && key.startsWith(`${group.label.toUpperCase()}|`),
                  )
                  const inHoverRange =
                    !!hoverRange &&
                    index >= Math.min(hoverRange.anchor, hoverRange.current) &&
                    index <= Math.max(hoverRange.anchor, hoverRange.current)
                  const expanded = allAssetClassesExpanded || pinned || inHoverRange
                  // Open groups show each card's age; a hover preview keeps the header steady.
                  const showGroupAge = !(allAssetClassesExpanded || pinned)

                  return (
                    <div
                      key={group.key}
                      onMouseEnter={() =>
                        setHoverRange((current) => (current ? { ...current, current: index } : { anchor: index, current: index }))
                      }
                      className={styles.group}
                      style={{ "--alert-class-color": group.color } as CSSProperties}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setPinnedAssetClasses((current) => ({
                            ...current,
                            [group.key]: !pinned,
                          }))
                        }
                        aria-expanded={expanded}
                        aria-label={`${group.label}, ${group.items.length} alerts`}
                        title={pinned ? "Unpin group" : "Keep group expanded"}
                        className={styles.groupHeader}
                      >
                        <div className={styles.groupIdentity}>
                          <span className={styles.groupMarker} aria-hidden="true" />
                          <span className={styles.groupTitle}>{group.label}</span>
                          <span className={styles.groupCount}>{group.items.length}</span>
                        </div>
                        <div className={styles.groupMeta}>
                          {showGroupAge && (() => {
                            const groupAge = formatRelativeTime(new Date(group.latestTimestamp))
                            return (
                              <span title={groupAge} suppressHydrationWarning>
                                <span className={styles.alertAgeFull}>{groupAge}</span>
                                <span className={styles.alertAgeCompact} aria-hidden="true">{groupAge.replace(/ ago$/, "")}</span>
                              </span>
                            )
                          })()}
                          {pinned ? <Pin size={14} aria-hidden="true" /> : <ChevronDown size={14} className={styles.groupChevron} aria-hidden="true" />}
                        </div>
                      </button>

                      <div
                        data-expanded={expanded}
                        inert={!expanded}
                        className={styles.groupContents}
                      >
                        <div className={styles.positionAlertList}>
                          {group.items.map((alert) => {
                            const execution = actionByAlert.get(alert.id)
                            const needsReview = execution?.status === "VARIANCE" || execution?.status === "OVERRIDDEN"
                            const stock = findAlertStock(stocks, alert.symbol)
                            const isThemeEquityRegime =
                              Boolean(alert.themeAssetClass) &&
                              alert.alert_type === "EQUITY_REGIME_STRONG_TRIM"
                            const name = isThemeEquityRegime
                              ? themeEquityRegimeTitle(alert.themeAssetClass || "")
                              : stock?.name || alert.symbol
                            const sizeLabel = !needsReview && alert.signal === "TRIM" ? `${Math.round(100 * alertSizePct(alert))}%` : null
                            const isExpired = !execution && !!alert.expiry_date && new Date(alert.expiry_date) < new Date()
                            const label = needsReview ? actionStatusLabel(execution) : execution && actionCompactLabel(execution) || (isThemeEquityRegime ? "Reduce exposure 20%" : signalLabel(alert.signal))
                            const signalClass = execution && (execution.alert_type === 'WEIGHT_REDUCE' || (execution.intent === 'DEPLOY' && execution.deployment_state !== 'FUNDED')) ? styles.caution : signalColorClass(alert.signal)
                            const age = formatRelativeTime(alert.timestamp)
                            const movePct =
                              typeof alert.movePct === "number" && Number.isFinite(alert.movePct)
                                ? alert.movePct
                                : alert.alertPrice && alert.alertPrice > 0 && stock?.price && stock.price > 0
                                  ? ((stock.price - alert.alertPrice) / alert.alertPrice) * 100
                                  : null

                            return (
                              <div
                                key={alert.id}
                                data-testid={`stack-alert-${alert.id}`}
                                role="button"
                                tabIndex={0}
                                onClick={() => openAlert(alert)}
                                onKeyDown={(event) => {
                                  if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                                    event.preventDefault()
                                    openAlert(alert)
                                  }
                                }}
                                className={`${styles.positionAlert} ${needsReview ? styles.reviewAlert : ''} ${isExpired ? styles.expiredAlert : ''}`}
                              >
                                <div className={styles.alertContent}>
                                  <div className={styles.alertHeading}>
                                    <div className={styles.alertName} title={name}>
                                      {name}
                                    </div>
                                    <span className={styles.alertAge} title={age} aria-label={age} suppressHydrationWarning>
                                      <span className={styles.alertAgeFull}>{age}</span>
                                      <span className={styles.alertAgeCompact} aria-hidden="true">{age.replace(/ ago$/, '')}</span>
                                    </span>
                                  </div>

                                  <div className={styles.alertDetails}>
                                    <div className={styles.alertSignals}>
                                      <span className={styles.alertTicker} title={isThemeEquityRegime ? "Producer equities" : alert.symbol}>
                                        {isThemeEquityRegime ? "Producer equities" : alert.symbol.replace(/^ASX:/i, "")}
                                      </span>
                                      <span title={execution?.instruction} className={`${styles.signal} ${needsReview ? styles.caution : signalClass}`}>{label}{sizeLabel && ` ${sizeLabel}`}</span>
                                      {isExpired && <span className={styles.negative}>Expired</span>}
                                    </div>

                                    <div className={styles.alertMetrics}>
                                      {movePct !== null && (
                                        <span
                                          className={`${styles.alertMove} ${movePct > 0 ? styles.positive : movePct < 0 ? styles.negative : styles.neutral}`}
                                          title="Move since alert"
                                        >
                                          {movePct > 0 ? "+" : ""}
                                          {movePct.toFixed(2)}%
                                        </span>
                                      )}
                                      {!isThemeEquityRegime && (
                                        <a
                                          href={getChartUrl(alert.symbol, stocks)}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          onClick={(event) => event.stopPropagation()}
                                          aria-label={`Open ${alert.symbol} chart in TradingView`}
                                          title="Open chart in TradingView"
                                          className={styles.alertChart}
                                        >
                                          <ArrowUpRight aria-hidden="true" />
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {(!execution || (execution.status === "OPEN" && execution.is_primary && execution.intent !== "EXIT")) && <button
                                  type="button"
                                  disabled={readOnly || executionsLoading || !!executionError}
                                  title={readOnly ? "Demo alerts are read-only" : "Ignore alert"}
                                  aria-label={`Ignore ${name} alert`}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    void handleIgnore(alert)
                                  }}
                                  className={styles.alertDismiss}
                                >
                                  <X size={14} strokeWidth={1.8} aria-hidden="true" />
                                </button>}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              {groupedAlerts.length === 0 && <div className={styles.emptyState}>No {alertScope === 'positions' ? 'position' : 'watchlist'} alerts</div>}
            </div>
          )}
        </div>
        <div className={styles.footer}><button type="button" className={styles.historyButton} onClick={() => openDecisionHistory()}><History size={16} aria-hidden="true" /><span>Decision history</span><ChevronRight size={14} aria-hidden="true" /></button></div>
      </div>
    </>
  )
}
