export const CLASSIFICATION_GROUPS = [
    { id: 'q1', label: 'Q1', description: 'Full Q3 equity-reduction sensitivity.' },
    { id: 'defensive', label: 'Q1-Defensive', description: 'Within Q1, with reduced Q3 sensitivity.' },
    { id: 'exempt', label: 'Q1-Exempt', description: 'Outside Q1 equity reductions; liquidity and Q4 rules may still apply.' },
    { id: 'other', label: 'Cash / unclassified', description: 'Cash is separate. Missing classifications need review.' },
] as const;

export type ClassRiskBucket = typeof CLASSIFICATION_GROUPS[number]['id'];
type ClassIdentity = {
    code: string; display_name: string; active: boolean;
    class_type?: string; parent_code?: string | null; allow_target_weight?: boolean;
};
type ClassPolicy = {
    key: string; display_name: string; active: boolean;
    overlay_eligible: boolean; q3_beneficiary: boolean;
    kind?: string | null; parent_code?: string | null;
    is_portfolio_sleeve?: boolean; is_system_bucket?: boolean;
    q3_logic?: string | null;
};
export type AssetClassIndexRow = {
    code: string; name: string; parent: string; bucket: ClassRiskBucket;
    kind: 'Asset class' | 'Group' | 'System'; reason: string;
};

const key = (code: string) => code.trim().toUpperCase();

// Matches the Positions/Analysis classification: exemption first, then beneficiary.
// Missing policy is explicitly unclassified in the reference, never a safety claim.
export function assetClassRiskBucket(code: string, policy?: ClassPolicy): ClassRiskBucket {
    if (key(code) === 'CASH' || key(code) === 'UNASSIGNED' || policy?.is_system_bucket || !policy) return 'other';
    if (!policy.overlay_eligible) return 'exempt';
    return policy.q3_beneficiary ? 'defensive' : 'q1';
}

export function buildAssetClassIndex(classes: ClassIdentity[], policies: ClassPolicy[]): AssetClassIndexRow[] {
    const identities = new Map(classes.map(row => [key(row.code), row]));
    const settings = new Map(policies.map(row => [key(row.key), row]));
    const codes = new Set([...identities.keys(), ...settings.keys()]);
    return [...codes].flatMap(code => {
        const identity = identities.get(code);
        const policy = settings.get(code);
        if (identity?.active === false || policy?.active === false || policy?.kind === 'SECURITY_TYPE' || code === 'ETF') return [];
        const parentCode = identity?.parent_code || policy?.parent_code;
        const parent = parentCode && key(parentCode) !== code && key(parentCode) !== 'UNASSIGNED'
            ? identities.get(key(parentCode))?.display_name || settings.get(key(parentCode))?.display_name || parentCode
            : '';
        const kind = identity?.class_type === 'SYSTEM_BUCKET' || policy?.is_system_bucket
            ? 'System' : identity?.allow_target_weight || policy?.is_portfolio_sleeve ? 'Asset class' : 'Group';
        return [{
            code, name: identity?.display_name || policy?.display_name || code, parent,
            bucket: assetClassRiskBucket(code, policy), kind,
            reason: code === 'UNASSIGNED' ? 'No asset class assigned.'
                : !policy ? 'Classification not configured.'
                : policy.q3_logic?.trim() || 'No rationale recorded.',
        } satisfies AssetClassIndexRow];
    }).sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
}

export function filterAssetClassIndex(rows: AssetClassIndexRow[], query: string, bucket: ClassRiskBucket | 'all') {
    const search = query.trim().toLowerCase();
    return rows.filter(row => (bucket === 'all' || row.bucket === bucket)
        && (!search || [row.name, row.code, row.parent, row.reason].some(value => value.toLowerCase().includes(search))));
}
