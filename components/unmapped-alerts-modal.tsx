"use client"
import { subscribePoll } from '@/lib/polling'

import { useEffect, useRef, useState } from "react"
import { alertTypeLabel, canonicalAlertType } from "@/lib/alert-format"
import { api, getCouncilTemplateForAssetClass, type AssetClass, type UnmappedAlert } from "@/lib/api"
import { normalizeAssetClassCode } from "@/lib/asset-class"
import {
  formatAssetClassName,
  getAnalysisAssetClasses,
  getAssignableAssetClasses,
} from "@/lib/asset-classes"

const EXCHANGES = [
  { value: 'ASX:', label: 'ASX (Australia)' },
  { value: 'NASDAQ:', label: 'NASDAQ (US)' },
  { value: 'NYSE:', label: 'NYSE (US)' },
  { value: 'NYSEARCA:', label: 'NYSE Arca (US ETFs)' },
  { value: 'AMEX:', label: 'AMEX (US)' },
  { value: 'LSE:', label: 'LSE (UK)' },
  { value: 'TSX:', label: 'TSX (Canada)' },
  { value: 'TSXV:', label: 'TSXV (Canada Venture)' },
  { value: 'NZX:', label: 'NZX (New Zealand)' },
  { value: 'HKEX:', label: 'HKEX (Hong Kong)' },
  { value: 'SGX:', label: 'SGX (Singapore)' },
  { value: 'XETRA:', label: 'XETRA (Germany)' },
  { value: 'TSE:', label: 'TSE (Tokyo)' },
]

export function UnmappedAlertsModal() {
  const [alerts, setAlerts] = useState<UnmappedAlert[]>([])
  const [assetClassOptions, setAssetClassOptions] = useState<AssetClass[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Form state
  const [companyName, setCompanyName] = useState("")
  const [ticker, setTicker] = useState("")
  const [exchangePrefix, setExchangePrefix] = useState("")
  const [assetClass, setAssetClass] = useState("")
  const [addToWatchlist, setAddToWatchlist] = useState(true)

  // Always show alerts[0] — no currentIndex needed
  const currentAlert = alerts[0]
  const shownAlertIdRef = useRef<number | null>(null)

  // Reset form only when the alert at the front of the queue changes
  useEffect(() => {
    if (currentAlert && currentAlert.id !== shownAlertIdRef.current) {
      shownAlertIdRef.current = currentAlert.id
      setTicker(currentAlert.ticker)
      setExchangePrefix(currentAlert.exchange_prefix || "")
      setCompanyName("")
      setAssetClass((current) => current || assetClassOptions[0]?.code || "")
      setAddToWatchlist(true)
    }
  }, [assetClassOptions, currentAlert?.id])

  useEffect(() => {
    const load = async () => {
      try {
        const [unmapped, sleeves] = await Promise.all([
          api.getUnmappedAlerts(),
          api.getAssetClasses(),
        ])
        const assignableSleeves = getAnalysisAssetClasses(sleeves)
        setAssetClassOptions(assignableSleeves)
        setAssetClass((current) => current || assignableSleeves[0]?.code || "")
        setAlerts(prev => {
          if (prev.length === 0) return unmapped
          // Only append genuinely new alerts — never replace, to avoid resetting the form
          const existingIds = new Set(prev.map(a => a.id))
          const brandNew = unmapped.filter(a => !existingIds.has(a.id))
          return brandNew.length > 0 ? [...prev, ...brandNew] : prev
        })
      } catch {
        // The endpoint is optional; show no unmapped alerts.
      } finally {
        setIsLoading(false)
      }
    }

    return subscribePoll(load, 30000)
  }, [])

  // Remove the first alert and advance the queue — pure functional update, no side effects
  const removeFirst = () => setAlerts(prev => prev.slice(1))

  const handleResolve = async () => {
    if (!currentAlert || !companyName.trim() || !ticker.trim() || !exchangePrefix.trim()) return
    setIsSubmitting(true)
    try {
      await api.resolveAlertMapping(currentAlert.id, {
        company_name: companyName.trim(),
        ticker: ticker.trim().toUpperCase(),
        exchange_prefix: exchangePrefix,
        add_to_watchlist: addToWatchlist,
        asset_class: addToWatchlist && assetClass ? assetClass : undefined,
        template_id:
          addToWatchlist && assetClass
            ? getCouncilTemplateForAssetClass(assetClass)
            : undefined,
      })
      removeFirst()
    } catch (error) {
      console.error("[ALPHA EDGE] Failed to resolve alert:", error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDismiss = async () => {
    if (!currentAlert) return
    try {
      await api.dismissAlert(currentAlert.id)
      removeFirst()
    } catch (error) {
      console.error("[ALPHA EDGE] Failed to dismiss alert:", error)
    }
  }

  // Visibility is fully derived — no showModal state
  if (isLoading || alerts.length === 0) return null

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-card border border-yellow-500/30 rounded-lg p-6 max-w-lg w-full">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">
            New Unknown Ticker
          </h2>
          {alerts.length > 1 && (
            <span className="text-xs text-muted-foreground">
              {alerts.length} remaining
            </span>
          )}
        </div>

        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded p-3 mb-4">
          <div className="text-sm text-yellow-400 mb-1">Alert Received</div>
          <div className="font-mono text-lg text-white">
            {currentAlert.exchange_prefix}{currentAlert.ticker}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Signal: <span className={`font-bold ${['BUY', 'ADD', 'BREAKOUT'].includes(canonicalAlertType(currentAlert.alert_type)) ? 'text-primary' : 'text-red-500'}`}>
              {alertTypeLabel(currentAlert.alert_type)}
            </span>
            {currentAlert.strength && ` (${currentAlert.strength})`}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              Company Name *
            </label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g., BHP Group Limited"
              className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                Ticker *
              </label>
              <input
                type="text"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                placeholder="e.g., BHP"
                className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-white font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                Exchange
              </label>
                <select
                  value={exchangePrefix}
                  onChange={(e) => setExchangePrefix(e.target.value)}
                  className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                >
                  <option value="">Select exchange...</option>
                  {EXCHANGES.map((ex) => (
                    <option key={ex.value} value={ex.value}>{ex.label}</option>
                  ))}
                </select>
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={addToWatchlist}
                onChange={(e) => setAddToWatchlist(e.target.checked)}
                className="w-4 h-4 accent-primary"
              />
              <span className="text-sm text-white">Add to Watchlist</span>
            </label>

            {addToWatchlist && (
              <div className="mt-3">
                <label className="block text-xs text-muted-foreground mb-1">
                  Asset Class
                </label>
                <select
                  value={assetClass}
                  onChange={(e) => setAssetClass(e.target.value)}
                  className="w-full bg-background border border-border rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                >
                  {assetClassOptions.map((sleeve) => (
                    <option key={sleeve.code} value={normalizeAssetClassCode(sleeve.code)}>
                      {formatAssetClassName(sleeve)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-between gap-3 mt-6">
          <button
            onClick={handleDismiss}
            className="px-3 py-2 text-xs text-red-400 hover:text-red-300 transition-colors"
          >
            Dismiss Alert
          </button>
          <button
            onClick={handleResolve}
            disabled={
              isSubmitting ||
              !companyName.trim() ||
              !ticker.trim() ||
              !exchangePrefix.trim() ||
              (addToWatchlist && !assetClass)
            }
            className="px-4 py-2 bg-primary text-black font-bold rounded hover:bg-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Saving..." : addToWatchlist ? "Save & Add to Watchlist" : "Save Mapping"}
          </button>
        </div>
      </div>
    </div>
  )
}
