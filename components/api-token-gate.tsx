"use client"

import { useEffect, useState } from "react"
import { API_UNAUTHORIZED_EVENT, getApiToken, setApiToken } from "@/lib/api"

/**
 * Prompts for the backend API token when none is stored or when the backend
 * rejects our credentials (401). The token lives in localStorage only — it is
 * never baked into the JS bundle.
 */
export function ApiTokenGate() {
    const [open, setOpen] = useState(false)
    const [value, setValue] = useState("")
    const [rejected, setRejected] = useState(false)

    useEffect(() => {
        if (!getApiToken()) {
            setOpen(true)
        }
        const onUnauthorized = () => {
            setRejected(true)
            setOpen(true)
        }
        window.addEventListener(API_UNAUTHORIZED_EVENT, onUnauthorized)
        return () => window.removeEventListener(API_UNAUTHORIZED_EVENT, onUnauthorized)
    }, [])

    if (!open) return null

    const save = () => {
        const token = value.trim()
        if (!token) return
        setApiToken(token)
        // Full reload so every data fetch (and the SSE stream) restarts with
        // the new credentials.
        window.location.reload()
    }

    return (
        <div
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 9999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(0, 0, 0, 0.75)",
            }}
        >
            <div
                style={{
                    background: "var(--background, #111)",
                    color: "var(--foreground, #eee)",
                    border: "1px solid var(--border, #333)",
                    borderRadius: 8,
                    padding: 24,
                    width: 380,
                    maxWidth: "90vw",
                    fontFamily: "inherit",
                }}
            >
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
                    API token required
                </h2>
                <p style={{ fontSize: 13, opacity: 0.8, margin: "8px 0 16px" }}>
                    {rejected
                        ? "The backend rejected the stored token. Enter a valid API token to continue."
                        : "Enter the Alpha Edge API token to connect to the backend. It is stored only in this browser."}
                </p>
                <input
                    type="password"
                    autoFocus
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && save()}
                    placeholder="API token"
                    style={{
                        width: "100%",
                        boxSizing: "border-box",
                        padding: "8px 10px",
                        fontSize: 13,
                        background: "transparent",
                        color: "inherit",
                        border: "1px solid var(--border, #444)",
                        borderRadius: 6,
                    }}
                />
                <button
                    onClick={save}
                    disabled={!value.trim()}
                    style={{
                        marginTop: 12,
                        width: "100%",
                        padding: "8px 10px",
                        fontSize: 13,
                        fontWeight: 600,
                        borderRadius: 6,
                        border: "1px solid var(--border, #444)",
                        background: value.trim() ? "var(--primary, #2563eb)" : "transparent",
                        color: value.trim() ? "var(--primary-foreground, #fff)" : "inherit",
                        cursor: value.trim() ? "pointer" : "not-allowed",
                    }}
                >
                    Connect
                </button>
            </div>
        </div>
    )
}
