import { NextRequest, NextResponse } from "next/server"

import { authorizeCouncilRequest, fetchCouncilJson } from "../../_lib"

function normalizeTicker(value: string): string {
  return String(value || "").trim().toUpperCase()
}

export async function GET(req: NextRequest) {
  const denied = await authorizeCouncilRequest(req)
  if (denied) return denied
  const ticker = normalizeTicker(req.nextUrl.searchParams.get("ticker") || "")
  const limit = Number(req.nextUrl.searchParams.get("limit") || "60")
  if (!ticker) {
    return NextResponse.json({ detail: "Missing ticker query parameter" }, { status: 400 })
  }

  const listPath =
    `/api/gantt-runs?limit=${encodeURIComponent(String(Math.max(1, limit)))}`
    + `&ticker=${encodeURIComponent(ticker)}`
  const { status: listStatus, body: listPayload } = await fetchCouncilJson(
    listPath,
    { method: "GET" },
    { retries: 2, timeoutMs: 30000 }
  )
  if (listStatus < 200 || listStatus >= 300) {
    return NextResponse.json(listPayload, { status: listStatus })
  }

  const runs: any[] = Array.isArray(listPayload?.runs) ? listPayload.runs : []
  const match = runs.find((run) => normalizeTicker(run?.ticker || "") === ticker)
  if (!match?.id) {
    return NextResponse.json(
      { detail: `No run found for ticker ${ticker}` },
      { status: 404 }
    )
  }

  const reportPath = `/api/gantt-runs/${encodeURIComponent(String(match.id))}/report-packet`
  const { status: reportStatus, body: reportPayload } = await fetchCouncilJson(
    reportPath,
    { method: "GET" },
    { retries: 2, timeoutMs: 35000 }
  )
  if (reportStatus < 200 || reportStatus >= 300) {
    return NextResponse.json(reportPayload, { status: reportStatus })
  }

  return NextResponse.json(
    {
      run_id: match.id,
      run_label: match.label || "",
      ticker: match.ticker || ticker,
      company_name: match.company_name || "",
      report_packet: reportPayload,
    },
    { status: 200 }
  )
}
