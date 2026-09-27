import { NextRequest, NextResponse } from "next/server"

import { authorizeCouncilRequest, fetchCouncilJson } from "../_lib"

function normalizeTicker(value: string): string {
  return String(value || "").trim().toUpperCase()
}

export async function GET(req: NextRequest) {
  const denied = await authorizeCouncilRequest(req)
  if (denied) return denied
  const ticker = normalizeTicker(req.nextUrl.searchParams.get("ticker") || "")
  const limit = Number(req.nextUrl.searchParams.get("limit") || "20")
  if (!ticker) {
    return NextResponse.json({ detail: "Missing ticker query parameter" }, { status: 400 })
  }

  const listPath =
    `/api/gantt-runs?limit=${encodeURIComponent(String(Math.max(1, limit)))}`
    + `&ticker=${encodeURIComponent(ticker)}`
  const { status, body } = await fetchCouncilJson(
    listPath,
    { method: "GET" },
    { retries: 2, timeoutMs: 30000 }
  )

  if (status < 200 || status >= 300) {
    return NextResponse.json(body, { status })
  }

  const runs = Array.isArray(body?.runs) ? body.runs : []
  return NextResponse.json({ runs }, { status: 200 })
}
