export function normalizeAssetClassCode(value?: string | null): string {
    const raw = String(value || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
    if (!raw) return 'UNASSIGNED';
    if (raw === 'PHARMACEUTICALS') return 'PHARMA';
    if (raw === 'BASEMETALS') return 'BASEMETALS';
    if (
        raw === 'MININGSERVICES' ||
        raw === 'MININGSERVICE' ||
        raw === 'MININGCONTRACTORS' ||
        raw === 'MININGEQUIPMENT'
    ) {
        return 'MINING_SERVICES';
    }
    if (raw === 'RAREEARTHS') return 'REE';
    if (raw === 'SEMIS' || raw === 'SEMISCONDUCTORS') {
        return 'SEMICONDUCTORS';
    }
    if (raw === 'STAPLE' || raw === 'CONSUMERSTAPLES') return 'STAPLES';
    if (raw === 'CASH' || raw === 'CASHRESERVE' || raw === 'RESERVE') {
        return 'CASH';
    }
    return raw;
}
