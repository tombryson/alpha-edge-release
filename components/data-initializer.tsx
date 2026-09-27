"use client"

import { useEffect, useRef } from "react"
import { useStore } from "@/lib/store"
import { api, hasApiAccess } from "@/lib/api"
import { subscribePoll } from '@/lib/polling'

export function DataInitializer() {
  const isInitialized = useRef(false)

  const refreshAlerts = () => {
    if (!hasApiAccess()) return
    const { fetchAlerts, fetchActiveAlerts } = useStore.getState()
    void Promise.all([fetchAlerts(), fetchActiveAlerts()]).catch((error) => {
      console.error("[ALPHA EDGE] Failed to refresh alert state:", error)
    })
  }

  useEffect(() => {
    // Check for corrupted cache on mount and normalize stored rows.
    if (typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem('terminal-cached-data')
        if (cached) {
          const parsed = JSON.parse(cached)
          // If cache shows $0 but we know there should be data, clear it
          if (parsed.portfolio && parsed.portfolio.totalValue === 0) {
            localStorage.removeItem('terminal-cached-data')
          } else {
            localStorage.setItem('terminal-cached-data', JSON.stringify(parsed))
          }
        }
      } catch (e) {
        console.error('[INIT] Failed to check cache:', e)
      }
    }

    useStore.getState().hydrateFromCache()

    // Only fetch once on initial mount
    if (!isInitialized.current && hasApiAccess()) {
      const initialize = useStore.getState().initialize
      initialize()
      isInitialized.current = true
    }
  }, [])

  useEffect(() => {
    if (!hasApiAccess()) return

    // SSE gives immediate updates; the shared poller handles missed events.
    const cleanup = api.streamAlerts(
      (alert) => {
        refreshAlerts()
      },
      () => {
        refreshAlerts()
      },
    )

    return cleanup
  }, [])

  useEffect(() => {
    if (!hasApiAccess()) return

    const { fetchAlerts, fetchActiveAlerts, fetchHoldings } = useStore.getState()
    // initialize() already starts the initial load.
    const stopAlerts = subscribePoll(fetchAlerts, 30000, { immediate: false })
    const stopConnections = subscribePoll(fetchActiveAlerts, 30000, { immediate: false })
    const stopHoldings = subscribePoll(fetchHoldings, 120000, { immediate: false })
    return () => {
      stopAlerts()
      stopConnections()
      stopHoldings()
    }
  }, [])

  return null
}
