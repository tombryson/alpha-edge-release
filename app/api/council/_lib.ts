import { COUNCIL_SUBMISSION_UNCERTAIN, COUNCIL_SUBMISSION_UNCERTAIN_MESSAGE } from "../../../lib/council-submission"
import { serverAccessMode, tradingServerURL, ownerRequestHeaders, checkOwnerOrigin } from '../../../lib/server-access'
import { demoResponse } from '../../../lib/demo-data'

const DEFAULT_COUNCIL_BASE_URL = "https://llm-council-analysis.fly.dev"
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

export function getTradingBackendApiUrl(): string {
  if (serverAccessMode() === 'owner') return tradingServerURL()
  const raw = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080/api"
  return String(raw || "http://localhost:8080/api").replace(/\/+$/, "")
}

export async function authorizeCouncilRequest(request: Request): Promise<Response | null> {
  try {
    const mode = serverAccessMode()
    if (mode === 'demo') return demoResponse(new URL(request.url).pathname.replace(/^\/api/, ''), request)
    if (mode === 'owner') {
      const denied = checkOwnerOrigin(request)
      if (denied) return denied
      const response = await fetch(`${tradingServerURL()}/auth/check`, {
        method: ['GET', 'HEAD'].includes(request.method) ? 'GET' : 'POST',
        headers: ownerRequestHeaders(request), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000),
      })
      await response.body?.cancel()
      if (response.status === 204) return null
      return Response.json({ detail: 'Owner session required. No job was submitted.', submission_status: 'not_submitted' }, { status: [401, 403].includes(response.status) ? response.status : 503 })
    }
  } catch {
    return Response.json({ detail: 'Access configuration unavailable. No job was submitted.', submission_status: 'not_submitted' }, { status: 503 })
  }
  const authorization = request.headers.get("authorization") || ""
  if (!/^Bearer \S+$/i.test(authorization)) {
    return Response.json({ detail: "API token required", code: "CALLER_UNAUTHORIZED", submission_status: "not_submitted" }, { status: 401 })
  }
  try {
    const response = await fetch(`${getTradingBackendApiUrl()}/auth/check`, {
      headers: { Authorization: authorization },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    })
    await response.body?.cancel()
    if (response.status === 204) return null
    if (response.status === 401 || response.status === 403) {
      return Response.json({ detail: "Invalid API token", code: "CALLER_UNAUTHORIZED", submission_status: "not_submitted" }, { status: 401 })
    }
  } catch {
    // Fail closed without mistaking an unavailable backend for an invalid key.
  }
  return Response.json({ detail: "Caller validation is unavailable. No Council job was submitted.", code: "CALLER_VALIDATION_UNAVAILABLE", submission_status: "not_submitted" }, { status: 503 })
}

export function getCouncilBaseUrl(): string {
  const raw =
    process.env.LLM_COUNCIL_API_URL ||
    process.env.NEXT_PUBLIC_LLM_COUNCIL_API_URL ||
    DEFAULT_COUNCIL_BASE_URL
  return String(raw || DEFAULT_COUNCIL_BASE_URL).replace(/\/+$/, "")
}

export function buildCouncilUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  return `${getCouncilBaseUrl()}${normalizedPath}`
}

export async function parseJsonSafe(response: Response): Promise<any> {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { detail: text }
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function getCouncilApiToken(): string {
  return (process.env.COUNCIL_API_TOKEN || "").trim()
}

export async function fetchCouncilJson(
  path: string,
  init: RequestInit = {},
  options: { retries?: number; timeoutMs?: number } = {},
): Promise<{ status: number; body: any }> {
  if (serverAccessMode() === 'demo') return { status: 403, body: { detail: 'Research jobs are disabled in the public demo' } }
  const readOnly = ["GET", "HEAD"].includes((init.method || "GET").toUpperCase())
  const retries = readOnly ? Math.max(0, options.retries ?? 2) : 0
  const timeoutMs = Math.max(1000, options.timeoutMs ?? 30000)
  let lastError: unknown = null

  const token = getCouncilApiToken()
  if (!token) {
    return { status: 503, body: { detail: "Council service is not configured. No job was submitted.", code: "COUNCIL_NOT_CONFIGURED", submission_status: "not_submitted" } }
  }
  const headers = new Headers(init.headers)
  headers.set("Authorization", `Bearer ${token}`)

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const upstream = await fetch(buildCouncilUrl(path), {
        ...init,
        headers,
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      })
      const body = await parseJsonSafe(upstream)
      if (!readOnly && [402, 503].includes(upstream.status) &&
          body?.detail?.code === "COUNCIL_PREFLIGHT_REJECTED" &&
          body.detail.submission_status === "not_submitted") {
        return { status: upstream.status, body: { ...body, submission_status: "not_submitted" } }
      }
      if (!readOnly && (upstream.status >= 500 || upstream.status === 408 ||
          (upstream.ok && (typeof body?.job_id !== "string" || !body.job_id.trim())))) {
        return uncertainSubmission()
      }
      if (upstream.status === 401 || upstream.status === 403) {
        return { status: 502, body: { detail: "Council service credentials were rejected; check the service configuration.", code: "COUNCIL_AUTH_REJECTED", submission_status: "not_submitted" } }
      }
      if (upstream.ok || !RETRYABLE_STATUSES.has(upstream.status) || attempt >= retries) {
        return { status: upstream.status, body }
      }
      await sleep(500 * (attempt + 1))
    } catch (error) {
      if (!readOnly) return uncertainSubmission()
      lastError = error
      if (attempt >= retries) break
      await sleep(500 * (attempt + 1))
    } finally {
      clearTimeout(timeout)
    }
  }

  const detail =
    lastError instanceof Error
      ? (
          lastError.name === "AbortError"
            ? "Council read timed out"
            : lastError.message
        )
      : "Council upstream unavailable"
  return {
    status: 502,
    body: { detail: `Council upstream unavailable: ${detail}` },
  }
}

function uncertainSubmission() {
  return { status: 502, body: { code: COUNCIL_SUBMISSION_UNCERTAIN, submission_status: "uncertain", detail: COUNCIL_SUBMISSION_UNCERTAIN_MESSAGE } }
}
