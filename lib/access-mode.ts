export type AccessMode = 'legacy' | 'owner' | 'demo';

let mode: AccessMode = 'legacy';
let ready = false;
let csrfToken = '';

export const getAccessMode = () => mode;
export const isSessionReady = () => ready;
export const getSessionCSRF = () => csrfToken;
export function configureAccess(next: AccessMode, authenticated: boolean, csrf = '') {
    mode = next;
    ready = authenticated;
    csrfToken = csrf;
}

export function clearPrivateBrowserCache() {
    if (typeof window === 'undefined') return;
    // Preserve presentation preferences, never old holdings or unfinished trading drafts.
    for (const key of ['alpha-edge-api-token', 'terminal-cached-data', 'terminal-review-draft', 'terminal-review-recovery', 'terminal-portfolio-adjustment-draft', 'alpha-edge-portfolio-memo', 'terminal-stock-groups', 'terminal-stock-group-assignments']) {
        localStorage.removeItem(key);
    }
    for (const key of Object.keys(localStorage)) {
        if (key.startsWith('alpha-edge-council-submission:')) localStorage.removeItem(key);
    }
    sessionStorage.clear();
}
