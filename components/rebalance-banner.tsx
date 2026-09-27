"use client"
import { subscribePoll } from '@/lib/polling'

import { useState, useEffect } from "react"
import { api, type ETFRebalanceTarget } from "@/lib/api"

export function RebalanceBanner() {
  const [rebalance, setRebalance] = useState<ETFRebalanceTarget[]>([])
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    setIsClient(true)
    return subscribePoll(loadRebalance, 60000)
  }, [])

  const loadRebalance = async () => {
    try {
      const targets = await api.getActiveRebalance()
      setRebalance(targets || [])
    } catch (error) {
      console.error("[ALPHA EDGE] Failed to load rebalance:", error)
      setRebalance([])
    }
  }

  const handleDismiss = async () => {
    if (!rebalance || rebalance.length === 0) return

    const sequenceNumber = rebalance[0].sequence_number
    const rebalanceDate = rebalance[0].rebalance_date

    try {
      // Record the dismissal as a decision
      await api.createDecision({
        decision: 'REBALANCE_DISMISS',
        notes: `Dismissed rebalance sequence #${sequenceNumber} (date: ${new Date(rebalanceDate).toLocaleDateString()})`,
      })

      // Dismiss the rebalance in the backend
      await api.dismissRebalance(sequenceNumber)

      // Reload to reflect the dismissal
      await loadRebalance()
    } catch (error) {
      console.error("[ALPHA EDGE] Failed to dismiss rebalance:", error)
    }
  }

  if (!isClient || !rebalance || rebalance.length === 0) {
    return null
  }

  const firstTarget = rebalance[0]
  const expiresAt = firstTarget.expires_at ? new Date(firstTarget.expires_at) : null
  const hoursRemaining = expiresAt ? Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60))) : null

  // Sort by target allocation descending
  const sorted = [...rebalance].sort((a, b) => b.target_allocation - a.target_allocation)

  return (
    <div className="border-b border-border bg-card p-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-bold text-white tracking-wide">[ REBALANCE ALERT ]</span>
            <span className="text-xs text-yellow-500">
              {hoursRemaining !== null && `Expires in ${hoursRemaining}h`}
            </span>
            <span className="text-xs text-muted-foreground">
              Seq #{firstTarget.sequence_number} | 60-Bar Return: {firstTarget.weighted_portfolio_return?.toFixed(2)}%
            </span>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-border/30">
                <th className="text-left pb-1 font-medium w-8">#</th>
                <th className="text-left pb-1 font-medium">TICKER</th>
                <th className="text-right pb-1 font-medium">TARGET</th>
                <th className="text-right pb-1 font-medium">DELTA</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((target) => (
                <tr key={target.ticker} className="border-b border-border/10">
                  <td className="py-0.5 text-muted-foreground">{target.rank}</td>
                  <td className="py-0.5 text-white font-mono font-bold">{target.ticker}</td>
                  <td className="py-0.5 text-right text-white">{target.target_allocation.toFixed(1)}%</td>
                  <td className={`py-0.5 text-right font-semibold ${
                    (target.pending_delta || 0) > 0 ? "text-[#27cb2d]" :
                    (target.pending_delta || 0) < 0 ? "text-[#ef4444]" : "text-muted-foreground"
                  }`}>
                    {(target.pending_delta || 0) > 0 ? "+" : ""}{target.pending_delta?.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          onClick={handleDismiss}
          className="terminal-button text-xs px-2 py-1"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
