"use client"
import { subscribePoll } from '@/lib/polling'

import { useCallback, useEffect, useRef, useState } from "react"
import { apiFetch } from "@/lib/api"

const API_BASE_URL =
    process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api"

const POLL_INTERVAL_MS = 60_000

interface DeadLetter {
    id: number
    webhook_name: string
    payload: string
    error: string
    http_status: number
    retry_count: number
    created_at: string
}

interface DeadLetterResponse {
    dead_letters: DeadLetter[]
    unresolved_count: number
}

/**
 * Header badge for failed webhook signals. Webhooks are ACKed before
 * processing, so a processing failure is otherwise invisible — TradingView
 * never retries. Renders nothing while the dead-letter queue is empty.
 */
export function WebhookDeadLetterBadge() {
    const [data, setData] = useState<DeadLetterResponse | null>(null)
    const [open, setOpen] = useState(false)
    const [busyId, setBusyId] = useState<number | null>(null)
    const containerRef = useRef<HTMLDivElement | null>(null)

    const refresh = useCallback(async () => {
        try {
            const res = await apiFetch(`${API_BASE_URL}/webhook-dead-letters`)
            if (!res.ok) return
            setData(await res.json())
        } catch {
            // Polling failure is non-fatal; next interval retries.
        }
    }, [])

    useEffect(() => {
        return subscribePoll(refresh, POLL_INTERVAL_MS)
    }, [refresh])

    useEffect(() => {
        if (!open) return
        const onClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        document.addEventListener("mousedown", onClickOutside)
        return () => document.removeEventListener("mousedown", onClickOutside)
    }, [open])

    const act = async (id: number, action: "retry" | "dismiss") => {
        setBusyId(id)
        try {
            await apiFetch(`${API_BASE_URL}/webhook-dead-letters/${id}/${action}`, {
                method: "POST",
            })
        } catch {
            // Row stays visible on failure; user can retry again.
        } finally {
            setBusyId(null)
            refresh()
        }
    }

    const count = data?.unresolved_count ?? 0
    if (count === 0) return null

    return (
        <div ref={containerRef} className="relative">
            <button
                onClick={() => setOpen((v) => !v)}
                className="flex items-center gap-1 rounded border border-red-500/60 bg-red-500/10 px-2 py-0.5 font-mono text-[10px] tracking-wider text-red-500 hover:bg-red-500/20"
                title="Webhook signals that failed processing after acknowledgement"
            >
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                {count} FAILED SIGNAL{count === 1 ? "" : "S"}
            </button>

            {open && (
                <div className="absolute right-0 z-50 mt-1 w-[420px] max-h-[60vh] overflow-auto rounded border border-border bg-background p-2 shadow-lg">
                    <div className="mb-1 font-mono text-[10px] tracking-wider text-muted-foreground">
                        FAILED WEBHOOK SIGNALS — acknowledged but not processed
                    </div>
                    {(data?.dead_letters ?? []).map((dl) => (
                        <div
                            key={dl.id}
                            className="mb-2 rounded border border-border p-2 font-mono text-[11px]"
                        >
                            <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold uppercase">{dl.webhook_name}</span>
                                <span className="text-muted-foreground">{dl.created_at}</span>
                            </div>
                            <div className="mt-1 break-all text-muted-foreground">{dl.payload}</div>
                            <div className="mt-1 break-all text-red-500">
                                {dl.error || `HTTP ${dl.http_status}`}
                                {dl.retry_count > 0 && ` (retried ×${dl.retry_count})`}
                            </div>
                            <div className="mt-2 flex gap-2">
                                <button
                                    disabled={busyId === dl.id}
                                    onClick={() => act(dl.id, "retry")}
                                    className="rounded border border-border px-2 py-0.5 text-[10px] tracking-wider hover:bg-accent disabled:opacity-50"
                                >
                                    RETRY
                                </button>
                                <button
                                    disabled={busyId === dl.id}
                                    onClick={() => act(dl.id, "dismiss")}
                                    className="rounded border border-border px-2 py-0.5 text-[10px] tracking-wider text-muted-foreground hover:bg-accent disabled:opacity-50"
                                >
                                    DISMISS
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
