import { NextRequest, NextResponse } from "next/server"

import { authorizeCouncilRequest, fetchCouncilJson } from "../_lib"

export async function GET(req: NextRequest) {
  const denied = await authorizeCouncilRequest(req)
  if (denied) return denied
  const search = req.nextUrl.search || ""
  const submission = req.nextUrl.searchParams.get("submission_id")
  if (submission && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(submission)) {
    return NextResponse.json({ detail: "Invalid submission ID" }, { status: 400 })
  }
  const { status, body } = await fetchCouncilJson(
    submission ? `/api/analysis-submissions/${submission}` : `/api/analysis-jobs${search}`,
    { method: "GET" },
    { retries: 2, timeoutMs: 35000 }
  )
  return NextResponse.json(body, { status })
}

export async function POST(req: NextRequest) {
  const denied = await authorizeCouncilRequest(req)
  if (denied) return denied
  const contentType = String(req.headers.get("content-type") || "").toLowerCase()
  const submissionId = req.headers.get("Idempotency-Key") || crypto.randomUUID()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(submissionId)) {
    return NextResponse.json({ detail: "Invalid submission ID", submission_status: "not_submitted" }, { status: 400 })
  }

  const { status, body } = await (async () => {
    if (contentType.includes("multipart/form-data")) {
      let form: FormData
      try {
        form = await req.formData()
      } catch {
        return { status: 400, body: { detail: "Invalid multipart submission", submission_status: "not_submitted" } }
      }
      return fetchCouncilJson(
        "/api/analysis-jobs",
        {
          method: "POST",
          headers: { "Idempotency-Key": submissionId },
          body: form,
        },
        { retries: 0, timeoutMs: 35000 }
      )
    }

    let payload: Record<string, unknown> = {}
    try {
      payload = (await req.json()) || {}
    } catch {
      return { status: 400, body: { detail: "Invalid JSON submission", submission_status: "not_submitted" } }
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length === 0) {
      return { status: 400, body: { detail: "A job request is required", submission_status: "not_submitted" } }
    }

    return fetchCouncilJson(
      "/api/analysis-jobs",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": submissionId },
        body: JSON.stringify(payload),
      },
      { retries: 0, timeoutMs: 35000 }
    )
  })()

  return NextResponse.json({ ...body, submission_id: submissionId }, { status })
}
