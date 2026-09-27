export const COUNCIL_SUBMISSION_UNCERTAIN = 'COUNCIL_SUBMISSION_UNCERTAIN';
export const COUNCIL_SUBMISSION_UNCERTAIN_MESSAGE =
    'Submission uncertain. Council may have accepted the job. Check existing jobs in Alpha Edge Intelligence before submitting again.';

export class CouncilSubmissionUncertainError extends Error {
    readonly code = COUNCIL_SUBMISSION_UNCERTAIN;

    constructor(readonly submissionId?: string) {
        super(COUNCIL_SUBMISSION_UNCERTAIN_MESSAGE);
        this.name = 'CouncilSubmissionUncertainError';
    }
}

export function isCouncilSubmissionUncertain(error: unknown): boolean {
    return error instanceof CouncilSubmissionUncertainError;
}

export function councilRejectionMessage(body: any): string {
    if (typeof body?.detail === 'string') return body.detail;
    if (typeof body?.detail?.message === 'string') return body.detail.message;
    if (Array.isArray(body?.detail)) {
        return body.detail.map((issue: any) => `${(issue.loc || []).join('.')}: ${issue.msg || 'Invalid value'}`).join('; ');
    }
    return 'Council rejected the submission.';
}

export async function recoverCouncilSubmission(fetcher: typeof fetch, submissionId: string, timeoutMs = 10000): Promise<any | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetcher(`/api/council/jobs?submission_id=${encodeURIComponent(submissionId)}`, { method: 'GET', signal: controller.signal });
        const body = await response.json();
        return response.ok && typeof body?.job_id === 'string' && body.job_id.trim() ? body : null;
    } catch { return null; }
    finally { clearTimeout(timeout); }
}

// A response can be lost after the server accepts work. Never retry a paid
// submission here, including when reading its response body fails or stalls.
export async function submitCouncilJob(
    fetcher: typeof fetch,
    init: RequestInit,
    timeoutMs = 45000,
    pendingKey?: string,
): Promise<any> {
    const storageKey = pendingKey ? `alpha-edge-council-submission:${pendingKey}` : null;
    let previous: string | null = null;
    if (storageKey && typeof window !== 'undefined') previous = localStorage.getItem(storageKey);
    if (previous) {
        const recovered = await recoverCouncilSubmission(fetcher, previous, Math.min(timeoutMs, 10000));
        if (!recovered) throw new CouncilSubmissionUncertainError(previous);
        localStorage.removeItem(storageKey!);
        return recovered;
    }
    const headers = new Headers(init.headers);
    const submissionId = headers.get('Idempotency-Key') || crypto.randomUUID();
    headers.set('Idempotency-Key', submissionId);
    // Persist before transmitting. A page reload must not turn a lost reply into a new paid run.
    if (storageKey && typeof window !== 'undefined') localStorage.setItem(storageKey, submissionId);
    const clearPending = () => { if (storageKey && typeof window !== 'undefined') localStorage.removeItem(storageKey); };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let rejected = false;
    try {
        const response = await fetcher('/api/council/jobs', { ...init, headers, signal: controller.signal });
        const body = await response.json();
        if (body?.code === COUNCIL_SUBMISSION_UNCERTAIN ||
            (response.status >= 500 && body?.submission_status !== 'not_submitted')) {
            throw new CouncilSubmissionUncertainError();
        }
        if (!response.ok) {
            rejected = true;
            clearPending();
            throw new Error(councilRejectionMessage(body));
        }
        if (typeof body?.job_id !== 'string' || !body.job_id.trim()) {
            throw new CouncilSubmissionUncertainError();
        }
        clearPending();
        return body;
    } catch (error) {
        if (rejected) throw error;
        clearTimeout(timeout);
        const recovered = await recoverCouncilSubmission(fetcher, submissionId, Math.min(timeoutMs, 10000));
        if (recovered) { clearPending(); return recovered; }
        throw new CouncilSubmissionUncertainError(submissionId);
    } finally {
        clearTimeout(timeout);
    }
}
