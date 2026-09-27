export const POSITION_ROW_APPEARANCE_KEY = 'alpha-edge:position-row-appearance-v1';

// Stable persisted IDs; class mappings are presentation only, never allocation rules.
export const ROW_ICON_CATALOGUE = [
    { value: 'none', label: 'Default arrow', group: 'Selection' },
    { value: 'auto', label: 'Class icon', group: 'Selection' },
    { value: 'gem', label: 'Precious metals', group: 'Metals & materials' },
    { value: 'mining', label: 'Mining', group: 'Metals & materials' },
    { value: 'gold', label: 'Gold miners', group: 'Metals & materials', classes: ['GOLD_MINERS'] },
    { value: 'gold-bullion', label: 'Physical gold', group: 'Metals & materials', classes: ['PHYSICAL_GOLD'] },
    { value: 'silver', label: 'Silver miners', group: 'Metals & materials', classes: ['SILVER_MINERS'] },
    { value: 'silver-bullion', label: 'Physical silver', group: 'Metals & materials', classes: ['PHYSICAL_SILVER'] },
    { value: 'platinum', label: 'Platinum group metals', group: 'Metals & materials', classes: ['PGM_MINERS'] },
    { value: 'copper', label: 'Copper miners', group: 'Metals & materials', classes: ['COPPER_MINERS'] },
    { value: 'base-metals', label: 'Base metals', group: 'Metals & materials', classes: ['BASE_METALS_MINERS'] },
    { value: 'lithium', label: 'Lithium & batteries', group: 'Metals & materials', classes: ['LITHIUM_MINERS'] },
    { value: 'uranium', label: 'Uranium & nuclear', group: 'Metals & materials', classes: ['URANIUM_MINERS'] },
    { value: 'rare-earths', label: 'Rare earths & critical minerals', group: 'Metals & materials', classes: ['RARE_EARTHS_CRITICAL_MINERALS'] },
    { value: 'iron-ore', label: 'Iron ore', group: 'Metals & materials', classes: ['IRON_ORE_MINERS'] },
    { value: 'diversified-miners', label: 'Diversified miners', group: 'Metals & materials', classes: ['DIVERSIFIED_MINERS'] },
    { value: 'aluminium', label: 'Aluminium', group: 'Metals & materials', classes: ['ALUMINIUM'] },
    { value: 'chemicals', label: 'Materials & chemicals', group: 'Metals & materials', classes: ['MATERIALS_CHEMICALS'] },
    { value: 'forestry', label: 'Forestry & paper', group: 'Metals & materials', classes: ['FORESTRY_PAPER_PACKAGING'] },
    { value: 'steel', label: 'Steel & metals processing', group: 'Metals & materials', classes: ['STEEL_METALS_PROCESSING'] },
    { value: 'mining-services', label: 'Mining services', group: 'Metals & materials', classes: ['MINING_SERVICES'] },
    { value: 'energy', label: 'Energy', group: 'Energy & commodities' },
    { value: 'oil', label: 'Oil & energy producers', group: 'Energy & commodities', classes: ['ENERGY_PRODUCERS'] },
    { value: 'energy-commodities', label: 'Energy commodities', group: 'Energy & commodities', classes: ['ENERGY_COMMODITIES'] },
    { value: 'oil-services', label: 'Oil services', group: 'Energy & commodities', classes: ['OIL_SERVICES'] },
    { value: 'gas', label: 'Natural gas', group: 'Energy & commodities', classes: ['NATURAL_GAS', 'NATURAL_GAS_PRODUCERS'] },
    { value: 'commodities', label: 'Direct commodities', group: 'Energy & commodities', classes: ['DIRECT_COMMODITIES'] },
    { value: 'solar', label: 'Solar energy', group: 'Energy & commodities' },
    { value: 'wind', label: 'Wind energy', group: 'Energy & commodities' },
    { value: 'renewables', label: 'Renewable energy', group: 'Energy & commodities' },
    { value: 'finance', label: 'Finance', group: 'Finance & property', classes: ['BANKS'] },
    { value: 'insurance', label: 'Insurance', group: 'Finance & property', classes: ['INSURANCE'] },
    { value: 'bonds', label: 'Bonds & fixed income', group: 'Finance & property', classes: ['BONDS'] },
    { value: 'cash', label: 'Cash & reserve', group: 'Finance & property', classes: ['CASH'] },
    { value: 'broad-equity', label: 'Broad equity', group: 'Finance & property', classes: ['BROAD_EQUITY'] },
    { value: 'real-estate', label: 'Real estate & REITs', group: 'Finance & property', classes: ['REAL_ESTATE_REIT'] },
    { value: 'technology', label: 'Technology', group: 'Technology & communications', classes: ['TECHNOLOGY'] },
    { value: 'semiconductors', label: 'Semiconductors', group: 'Technology & communications', classes: ['SEMICONDUCTORS'] },
    { value: 'platforms', label: 'Technology platforms', group: 'Technology & communications', classes: ['TECHNOLOGY_PLATFORMS'] },
    { value: 'software', label: 'Software & SaaS', group: 'Technology & communications', classes: ['SOFTWARE_SAAS'] },
    { value: 'crypto', label: 'Crypto & digital assets', group: 'Technology & communications', classes: ['CRYPTO_DIGITAL_ASSETS'] },
    { value: 'data-centres', label: 'Datacentres', group: 'Technology & communications', classes: ['DATACENTRES'] },
    { value: 'telecom', label: 'Telecommunications', group: 'Technology & communications', classes: ['TELECOMMUNICATIONS'] },
    { value: 'ai', label: 'Artificial intelligence', group: 'Technology & communications' },
    { value: 'health', label: 'Healthcare', group: 'Healthcare & science', classes: ['HEALTHCARE_SERVICES'] },
    { value: 'medtech', label: 'Medtech', group: 'Healthcare & science', classes: ['MEDTECH'] },
    { value: 'pharma', label: 'Pharma & biotech', group: 'Healthcare & science', classes: ['PHARMA_BIOTECH'] },
    { value: 'biotech', label: 'Biotechnology & genetics', group: 'Healthcare & science' },
    { value: 'research', label: 'Research & laboratories', group: 'Healthcare & science' },
    { value: 'hospital', label: 'Hospitals', group: 'Healthcare & science' },
    { value: 'industry', label: 'Industry', group: 'Industry & infrastructure' },
    { value: 'industrials', label: 'Industrials & manufacturing', group: 'Industry & infrastructure', classes: ['INDUSTRIALS'] },
    { value: 'construction', label: 'Construction & engineering', group: 'Industry & infrastructure', classes: ['CONSTRUCTION_ENGINEERING'] },
    { value: 'logistics', label: 'Transport & logistics', group: 'Industry & infrastructure', classes: ['TRANSPORT_LOGISTICS'] },
    { value: 'aerospace', label: 'Civil aerospace', group: 'Industry & infrastructure', classes: ['CIVIL_AEROSPACE'] },
    { value: 'defence', label: 'Defence', group: 'Industry & infrastructure', classes: ['DEFENCE'] },
    { value: 'infrastructure', label: 'Infrastructure', group: 'Industry & infrastructure', classes: ['INFRASTRUCTURE'] },
    { value: 'utilities', label: 'Utilities', group: 'Industry & infrastructure', classes: ['UTILITIES'] },
    { value: 'shipping', label: 'Shipping & ports', group: 'Industry & infrastructure' },
    { value: 'rail', label: 'Rail transport', group: 'Industry & infrastructure' },
    { value: 'space', label: 'Space', group: 'Industry & infrastructure' },
    { value: 'agriculture', label: 'Agriculture', group: 'Consumer & services', classes: ['AGRICULTURE_AGRIBUSINESS'] },
    { value: 'staples', label: 'Consumer staples', group: 'Consumer & services', classes: ['STAPLES', 'CONSUMER_STAPLES'] },
    { value: 'retail', label: 'Consumer discretionary & retail', group: 'Consumer & services', classes: ['CONSUMER_DISCRETIONARY'] },
    { value: 'gambling', label: 'Gambling', group: 'Consumer & services', classes: ['GAMBLING'] },
    { value: 'gaming', label: 'Gaming', group: 'Consumer & services', classes: ['GAMING_GAMBLING'] },
    { value: 'education', label: 'Education', group: 'Consumer & services', classes: ['EDUCATION'] },
    { value: 'media', label: 'Media & publishing', group: 'Consumer & services', classes: ['MEDIA_PUBLISHING'] },
    { value: 'packaging', label: 'Packaging', group: 'Consumer & services' },
    { value: 'food', label: 'Food & hospitality', group: 'Consumer & services' },
    { value: 'water', label: 'Water', group: 'Consumer & services' },
    { value: 'global', label: 'Global', group: 'General' },
    { value: 'other', label: 'Other', group: 'General', classes: ['OTHER'] },
    { value: 'unassigned', label: 'Unassigned', group: 'General', classes: ['UNASSIGNED'] },
] as const;
export type RowEmblem = typeof ROW_ICON_CATALOGUE[number]['value'];
export const ROW_EMBLEMS: readonly RowEmblem[] = ROW_ICON_CATALOGUE.map(option => option.value);

export function rowIconForClass(canonicalCode: string): RowEmblem {
    return ROW_ICON_CATALOGUE.find(option => 'classes' in option && option.classes.some(code => code === canonicalCode))?.value || 'global';
}
export type PositionRowPreferences = {
    version: 3;
    icons: Record<string, RowEmblem>;
    classColourIcons?: Record<string, true>;
};

export function emptyRowPreferences(): PositionRowPreferences {
    return { version: 3, icons: {} };
}

// Preserve actual class codes, including custom underscores. Never key by a label.
export function positionRowClassKey(code?: string | null): string {
    const key = (code || '').trim().toUpperCase();
    return /^[A-Z0-9][A-Z0-9_:-]{0,95}$/.test(key) ? key : '';
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function parseRowPreferences(raw: string | null): PositionRowPreferences {
    try {
        const saved = record(JSON.parse(raw || 'null'));
        if (saved.version !== 1 && saved.version !== 2 && saved.version !== 3) return emptyRowPreferences();
        const icons: Record<string, RowEmblem> = {};
        for (const [code, appearance] of Object.entries(record(saved.overrides))) {
            const key = positionRowClassKey(code);
            if (key && appearance && typeof appearance === 'object' && !Array.isArray(appearance)) {
                // Retain explicit class icons from v1, never its global appearance.
                const emblem = record(appearance).emblem as RowEmblem;
                if (saved.version === 1 && ROW_EMBLEMS.includes(emblem) && emblem !== 'none') icons[key] = emblem;
            }
        }
        if (saved.version === 2 || saved.version === 3) {
            for (const [code, emblem] of Object.entries(record(saved.icons))) {
                const key = positionRowClassKey(code);
                if (key && ROW_EMBLEMS.includes(emblem as RowEmblem) && emblem !== 'none') icons[key] = emblem as RowEmblem;
            }
        }
        const classColourIcons: Record<string, true> = {};
        if (saved.version === 3) {
            for (const [code, enabled] of Object.entries(record(saved.classColourIcons))) {
                const key = positionRowClassKey(code);
                if (key && enabled === true) classColourIcons[key] = true;
            }
        }
        return { version: 3, icons, ...(Object.keys(classColourIcons).length ? { classColourIcons } : {}) };
    } catch {
        return emptyRowPreferences();
    }
}

export function resolveRowIcon(preferences: PositionRowPreferences, code?: string | null): RowEmblem {
    const key = positionRowClassKey(code);
    return key && Object.hasOwn(preferences.icons, key) ? preferences.icons[key] : 'none';
}

export function rowIconUsesClassColour(preferences: PositionRowPreferences, code: string): boolean {
    const key = positionRowClassKey(code);
    return !!key && preferences.classColourIcons?.[key] === true;
}
