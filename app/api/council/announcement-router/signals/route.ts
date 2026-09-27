import { NextRequest, NextResponse } from "next/server"

import { authorizeCouncilRequest, fetchCouncilJson } from "../../_lib"

const normalizeTicker = (value: string | null) => String(value || "").trim().toUpperCase()

export async function GET(request: NextRequest) {
  const denied = await authorizeCouncilRequest(request)
  if (denied) return denied
  const ticker = normalizeTicker(request.nextUrl.searchParams.get("ticker"))
  const path = ticker
    ? `/api/announcement-router/signals?ticker=${encodeURIComponent(ticker)}`
    : "/api/announcement-router/signals"

  const { status, body } = await fetchCouncilJson(
    path,
    { method: "GET" },
    { retries: 2, timeoutMs: 20000 },
  )

  if (status === 401 || status === 403) {
    return NextResponse.json({})
  }

  if (status < 200 || status >= 300) {
    return NextResponse.json(body, { status })
  }

  const rawSignals =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {}
  const signals: Record<string, number> = {}

  for (const [rawTicker, rawScore] of Object.entries(rawSignals)) {
    const key = normalizeTicker(rawTicker)
    const score = Number(rawScore)
    if (!key || !Number.isFinite(score)) continue
    signals[key] = score
  }

  return NextResponse.json(signals)
}
