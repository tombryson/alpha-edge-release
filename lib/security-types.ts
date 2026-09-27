export const normalizeSecurityType = (value?: string | null): string =>
    String(value || '').trim().toUpperCase().replace(/[ -]+/g, '_');

export const isNonAllocatingSecurityType = (value?: string | null): boolean => {
    const normalized = normalizeSecurityType(value);
    return normalized === 'CVR' || normalized === 'NON_ALLOCATING';
};

export const requiresNonAllocatingConfirmation = (
    positionValue?: number | null,
): boolean => Math.round(Math.abs(positionValue || 0)) > 0;

export const preferredSecurityType = (
    first?: string | null,
    second?: string | null,
): string | null => {
    const candidates = [first, second].filter(
        (value): value is string => Boolean(value && String(value).trim()),
    );
    const nonAllocating = candidates.find(isNonAllocatingSecurityType);
    if (nonAllocating) return normalizeSecurityType(nonAllocating);
    if (candidates.some((value) => normalizeSecurityType(value) === 'ETF')) {
        return 'ETF';
    }
    return candidates[0] ? normalizeSecurityType(candidates[0]) : null;
};
