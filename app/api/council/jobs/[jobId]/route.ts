import { NextRequest, NextResponse } from "next/server"

import { authorizeCouncilRequest, fetchCouncilJson } from "../../_lib"

type RouteContext = {
  params: Promise<{
    jobId: string
  }>
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
    `/api/analysis-jobs/${jobId}`,
    { method: "GET" },
    { retries: 3, timeoutMs: 25000 }
  )
  return NextResponse.json(body, { status })
}
