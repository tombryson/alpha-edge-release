import { NextRequest, NextResponse } from "next/server"

import { authorizeCouncilRequest, fetchCouncilJson } from "../../_lib"

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ runId: string }> }
) {
  const denied = await authorizeCouncilRequest(_req)
  if (denied) return denied
  const { runId } = await context.params
  const normalizedRunId = String(runId || "").trim()
  if (!normalizedRunId) {
    return NextResponse.json({ detail: "Missing run id" }, { status: 400 })
  }

  const reportPath = `/api/gantt-runs/${encodeURIComponent(normalizedRunId)}/report-packet`
  const { status: reportStatus, body: reportPayload } = await fetchCouncilJson(
    reportPath,
    { method: "GET" },
    { retries: 2, timeoutMs: 35000 }
  )
  if (reportStatus < 200 || reportStatus >= 300) {
    return NextResponse.json(reportPayload, { status: reportStatus })
  }

  const runPath = `/api/gantt-runs/${encodeURIComponent(normalizedRunId)}`
  const { status: runStatus, body: runPayload } = await fetchCouncilJson(
    runPath,
    { method: "GET" },
    { retries: 1, timeoutMs: 30000 }
  )

  return NextResponse.json(
    {
      run_id: normalizedRunId,
      run_label:
        (runStatus >= 200 && runStatus < 300 ? runPayload?.label : "")
        || reportPayload?.summary_fields?.label
        || normalizedRunId,
      ticker:
        (runStatus >= 200 && runStatus < 300 ? runPayload?.ticker : "")
        || reportPayload?.summary_fields?.ticker
        || "",
      company_name:
        (runStatus >= 200 && runStatus < 300 ? runPayload?.company_name : "")
        || reportPayload?.summary_fields?.company_name
        || "",
      report_packet: reportPayload,
    },
    { status: 200 }
  )
}
