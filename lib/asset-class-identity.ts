/** Presentation only. Never use these aliases to allocate or combine capital. */
export const ASSET_CLASS_COLOUR_VERSION = 1;

type ClassIdentity = Readonly<{ color: string; aliases?: readonly string[] }>;

// Commodity colours follow their materials; other classes retain stable sector accents.
// Codes, not names or row positions, own colour identity across every view.
export const ASSET_CLASS_IDENTITIES: Readonly<Record<string, ClassIdentity>> = {
    GOLD_MINERS: { color: '#d4a72c', aliases: ['GOLD', 'GOLD_MINER'] },
    PHYSICAL_GOLD: { color: '#b8871b', aliases: ['PHYSICAL_GOLD_ETF'] },
    SILVER_MINERS: { color: '#c0c7d2', aliases: ['SILVER', 'SILVER_MINER'] },
    PHYSICAL_SILVER: { color: '#8f9fb5', aliases: ['PHYSICAL_SILVER_ETF'] },
    PGM_MINERS: { color: '#a2afaa', aliases: ['PLATINUM', 'PLATINUM_MINERS'] },
    COPPER_MINERS: { color: '#b87333', aliases: ['COPPER', 'COPPER_MINER'] },
    BASE_METALS_MINERS: {
        color: '#71717a',
        aliases: ['BASEMETALS', 'BASE_METALS', 'BASE_METALS_MINER'],
    },
    LITHIUM_MINERS: { color: '#d946ef', aliases: ['LITHIUM', 'LITHIUM_MINER'] },
    URANIUM_MINERS: { color: '#84cc16', aliases: ['URANIUM', 'URANIUM_MINER'] },
    RARE_EARTHS_CRITICAL_MINERALS: {
        color: '#14b8a6',
        aliases: ['REE', 'RARE_EARTHS', 'RARE_EARTHS_MINER'],
    },
    IRON_ORE_MINERS: {
        color: '#a16207',
        aliases: ['IRON', 'IRON_ORE', 'IRON_ORE_MINER'],
    },
    DIVERSIFIED_MINERS: {
        color: '#a88d6d',
        aliases: ['MATERIALS', 'DIVERSIFIED_MINER'],
    },
    ALUMINIUM: { color: '#94a3b8', aliases: ['ALUMINUM'] },
    MATERIALS_CHEMICALS: {
        color: '#38bdf8',
        aliases: ['BASIC_MATERIALS', 'CHEMICALS_MATERIALS'],
    },
    FORESTRY_PAPER_PACKAGING: { color: '#65a30d' },
    STEEL_METALS_PROCESSING: {
        color: '#8995ad',
        aliases: ['STEEL_BASE_METALS_PROCESSING'],
    },
    MINING_SERVICES: {
        color: '#f59e0b',
        aliases: ['MINING_SERVICE', 'MINING_CONTRACTORS', 'MINING_EQUIPMENT'],
    },
    ENERGY_PRODUCERS: {
        color: '#fb5b62',
        aliases: ['ENERGY', 'ENERGY_OIL_GAS', 'COAL_MINER'],
    },
    ENERGY_COMMODITIES: { color: '#e8904e' },
    OIL_SERVICES: { color: '#c77554' },
    NATURAL_GAS_PRODUCERS: { color: '#5da7bc' },
    NATURAL_GAS: { color: '#3c7f99' },
    DIRECT_COMMODITIES: { color: '#ad9470' },
    AGRICULTURE_AGRIBUSINESS: { color: '#75a766' },
    BANKS: { color: '#3c91aa', aliases: ['BANK_FINANCIALS', 'FINANCIALS'] },
    INSURANCE: { color: '#0ea5e9' },
    STAPLES: { color: '#22c55e', aliases: ['STAPLE'] },
    CONSUMER_STAPLES: { color: '#74bb90' },
    CONSUMER_DISCRETIONARY: { color: '#e1a25b', aliases: ['CONSUMER_RETAIL'] },
    GAMBLING: { color: '#f97316' },
    GAMING_GAMBLING: { color: '#df8474', aliases: ['GAMING'] },
    EDUCATION: { color: '#a78bfa' },
    MEDIA_PUBLISHING: { color: '#f472b6' },
    TECHNOLOGY: { color: '#22c7b7' },
    TECHNOLOGY_PLATFORMS: { color: '#569de2' },
    SOFTWARE_SAAS: { color: '#528ab8' },
    SEMICONDUCTORS: { color: '#818cf8', aliases: ['SEMIS', 'SEMISCONDUCTORS'] },
    CRYPTO_DIGITAL_ASSETS: { color: '#9972d8' },
    DATACENTRES: {
        color: '#48b0cb',
        aliases: ['DATA_CENTRES', 'DATA_CENTERS'],
    },
    TELECOMMUNICATIONS: { color: '#4e9d92' },
    INDUSTRIALS: { color: '#f6b117' },
    CONSTRUCTION_ENGINEERING: { color: '#d79862' },
    TRANSPORT_LOGISTICS: { color: '#c3a54e' },
    CIVIL_AEROSPACE: { color: '#7399d1' },
    DEFENCE: { color: '#a855f7', aliases: ['DEFENSE'] },
    INFRASTRUCTURE: { color: '#8396a1' },
    UTILITIES: { color: '#5ba981' },
    REAL_ESTATE_REIT: { color: '#b19cb8', aliases: ['REAL_ESTATE', 'REITS'] },
    HEALTHCARE_SERVICES: { color: '#ec4899', aliases: ['HEALTHCARE'] },
    MEDTECH: { color: '#c87db1' },
    PHARMA_BIOTECH: {
        color: '#06b6d4',
        aliases: ['PHARMA', 'PHARMACEUTICALS'],
    },
    BONDS: { color: '#7991d3', aliases: ['FIXED_INCOME'] },
    BROAD_EQUITY: { color: '#8b91c1', aliases: ['EQUITY', 'BROAD_BETA'] },
    CASH: {
        color: '#64748b',
        aliases: ['CASH_RESERVE', 'RESERVE', 'CASH_FLOATING', 'CASH_BSUB'],
    },
    UNASSIGNED: { color: '#909090', aliases: ['MISC'] },
    OTHER: { color: '#77818c' },
};

function compact(value: string): string {
    return value
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
}

const canonicalByAlias = new Map<string, string>();
for (const [code, identity] of Object.entries(ASSET_CLASS_IDENTITIES)) {
    for (const alias of [code, ...(identity.aliases || [])]) {
        const key = compact(alias);
        if (canonicalByAlias.has(key) && canonicalByAlias.get(key) !== code)
            throw new Error(`Duplicate class colour alias: ${alias}`);
        canonicalByAlias.set(key, code);
    }
}

export function assetClassColourKey(value?: string | null): string {
    const key = compact(
        String(value || '')
            .trim()
            .replace(/^(?:THEME|ASSET_CLASS):/i, ''),
    );
    return canonicalByAlias.get(key) || key || 'UNASSIGNED';
}

const CUSTOM_COLOURS = [
    '#38bdf8',
    '#f59e0b',
    '#34d399',
    '#f472b6',
    '#a78bfa',
    '#fb7185',
    '#2dd4bf',
    '#c084fc',
    '#8da94e',
    '#de9467',
    '#849fca',
    '#b5976b',
];

export function assetClassDefaultColor(code?: string | null): string {
    const key = assetClassColourKey(code);
    const known = ASSET_CLASS_IDENTITIES[key];
    if (known) return known.color;
    // Frozen FNV-1a fallback: additions, sorting and filtering cannot recolour a custom code.
    let hash = 2166136261;
    for (let index = 0; index < key.length; index++) {
        hash = Math.imul(hash ^ key.charCodeAt(index), 16777619) >>> 0;
    }
    return CUSTOM_COLOURS[hash % CUSTOM_COLOURS.length];
}

export function assetClassColorProperty(code: string): string {
    return `--asset-class-colour-${assetClassColourKey(code)}`;
}

// CSS references keep memoised charts reactive without rebuilding their data or remounting views.
export function assetClassColor(code?: string | null): string {
    const key = assetClassColourKey(code);
    return `var(${assetClassColorProperty(key)}, ${assetClassDefaultColor(key)})`;
}

// Parent groups are not investable classes and must not borrow the first child's colour.
const PARENT_COLOURS: Readonly<Record<string, string>> = {
    MATERIALS: '#78716c',
    FINANCIALS: '#3c91aa',
    PRECIOUSMETALS: '#c5ab6b',
};

export function assetClassGroupColor(group: string): string {
    return PARENT_COLOURS[compact(group)] || assetClassColor(group);
}
