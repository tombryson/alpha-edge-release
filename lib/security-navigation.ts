export const SECURITY_DETAILS_REQUESTED = 'security-details:open';
export const SECURITY_HISTORY_REQUESTED = 'security-history:open';

export type SecurityNavigationDetail = { ticker: string; name: string };

export function openSecurityDetails(detail: SecurityNavigationDetail) {
    window.dispatchEvent(new CustomEvent(SECURITY_DETAILS_REQUESTED, { detail }));
}

export function openSecurityHistory(detail: SecurityNavigationDetail) {
    window.dispatchEvent(new CustomEvent(SECURITY_HISTORY_REQUESTED, { detail }));
}
