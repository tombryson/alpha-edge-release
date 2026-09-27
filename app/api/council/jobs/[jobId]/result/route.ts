import { NextRequest, NextResponse } from "next/server"
import { serverAccessMode, ownerOrigin, ownerRequestHeaders } from '@/lib/server-access'

import type { CouncilAnalysisResultResponse } from "@/lib/api"
import {
  buildPortfolioMemoPersistPayload,
  buildPortfolioMemoSummary,
} from "@/lib/portfolio-memo"

import { authorizeCouncilRequest, fetchCouncilJson, getTradingBackendApiUrl } from "../../../_lib"

type RouteContext = {
  params: Promise<{
    jobId: string
  }>
}

function isPortfolioMemoResult(body: any): body is CouncilAnalysisResultResponse {
  const request = body?.job?.request || {}
  const run = body?.run || {}
  return (
    request.job_type === "portfolio_positioning" ||
    request.run_label === "portfolio_positioning" ||
    request.portfolio_positioning_mode ||
    run.run_label === "portfolio_positioning"
  )
}

async function persistPortfolioMemoResult(body: CouncilAnalysisResultResponse, request: Request) {
  const owner = serverAccessMode() === 'owner'
  if (owner && !request.headers.get('x-csrf-token')) return
  const summary = buildPortfolioMemoSummary(body)
  const payload = buildPortfolioMemoPersistPayload(
    body,
    summary,
    String(body.job?.request?.portfolio_positioning_mode || "DEEP").toUpperCase() === "FAST"
      ? "FAST"
      : "DEEP",
  )
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  const headers = owner ? ownerRequestHeaders(request) : new Headers({ Authorization: request.headers.get('authorization') || '' })
  headers.set('Content-Type', 'application/json')
  if (owner) headers.set('Origin', ownerOrigin())
  try {
    const response = await fetch(`${getTradingBackendApiUrl()}/portfolio-memos`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal,
    })
    if (!response.ok) {
      console.warn("[ALPHA EDGE] Portfolio memo persistence returned", response.status)
    }
  } catch (error) {
    console.warn("[ALPHA EDGE] Failed to persist portfolio memo result", error)
  } finally {
    clearTimeout(timeout)
  }
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const denied = await authorizeCouncilRequest(_req)
  if (denied) return denied
  const resolved = await params
  const jobId = encodeURIComponent(String(resolved?.jobId || "").trim())
  if (!jobId) {
    return NextResponse.json({ detail: "Missing jobId" }, { status: 400 })
  }

  const { status, body } = await fetchCouncilJson(
    `/api/analysis-jobs/${jobId}/result`,
    { method: "GET" },
    { retries: 2, timeoutMs: 35000 }
  )
  if (status >= 200 && status < 300 && isPortfolioMemoResult(body)) {
    await persistPortfolioMemoResult(body, _req)
  }
  return NextResponse.json(body, { status })
}
