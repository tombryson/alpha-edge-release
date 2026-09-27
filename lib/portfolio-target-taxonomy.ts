import type {
    PortfolioOverlaySummaryResponse,
    AssetClass,
} from './api';
import { normalizeAssetClassCode } from './asset-class';

export type PortfolioTargetClass = {
    id: string;
    displayName: string;
    category: string;
};

// Portfolio targets are investable allocation sleeves, not parent labels or security wrappers.
export const PORTFOLIO_TARGET_CLASSES: PortfolioTargetClass[] = [
    { id: 'cash', displayName: 'Cash/Reserve', category: 'cash' },
    { id: 'bonds', displayName: 'Bonds', category: 'defensive' },
    { id: 'broad_equity', displayName: 'Broad Equity', category: 'equity' },
    { id: 'physical_gold', displayName: 'Physical Gold', category: 'precious_metals' },
    { id: 'gold_miners', displayName: 'Gold Miners', category: 'precious_metals' },
    { id: 'physical_silver', displayName: 'Physical Silver', category: 'precious_metals' },
    { id: 'silver_miners', displayName: 'Silver Miners', category: 'precious_metals' },
    { id: 'copper_miners', displayName: 'Copper Miners', category: 'resources' },
    { id: 'base_metals_miners', displayName: 'Base Metals Miners', category: 'resources' },
    { id: 'lithium_miners', displayName: 'Lithium Miners', category: 'resources' },
    { id: 'uranium_miners', displayName: 'Uranium Miners', category: 'resources' },
    { id: 'rare_earths_critical_minerals', displayName: 'Rare Earths & Critical Minerals', category: 'resources' },
    { id: 'iron_ore_miners', displayName: 'Iron Ore Miners', category: 'resources' },
    { id: 'diversified_miners', displayName: 'Diversified Miners', category: 'resources' },
    { id: 'materials_chemicals', displayName: 'Materials & Chemicals', category: 'materials' },
    { id: 'forestry_paper_packaging', displayName: 'Forestry, Paper & Packaging', category: 'materials' },
    { id: 'steel_metals_processing', displayName: 'Steel & Metals Processing', category: 'materials' },
    { id: 'mining_services', displayName: 'Mining Services', category: 'materials' },
    { id: 'energy_producers', displayName: 'Energy Producers', category: 'energy' },
    { id: 'energy_commodities', displayName: 'Energy Commodities', category: 'energy' },
    { id: 'agriculture_agribusiness', displayName: 'Agriculture & Agribusiness', category: 'agriculture' },
    { id: 'banks', displayName: 'Banks', category: 'financials' },
    { id: 'insurance', displayName: 'Insurance', category: 'financials' },
    { id: 'staples', displayName: 'Staples', category: 'consumer' },
    { id: 'consumer_staples', displayName: 'Consumer Staples', category: 'consumer' },
    { id: 'consumer_discretionary', displayName: 'Consumer Discretionary', category: 'consumer' },
    { id: 'gambling', displayName: 'Gambling', category: 'consumer' },
    { id: 'gaming_gambling', displayName: 'Gaming & Gambling', category: 'consumer' },
    { id: 'education', displayName: 'Education', category: 'consumer' },
    { id: 'media_publishing', displayName: 'Media & Publishing', category: 'media' },
    { id: 'technology', displayName: 'Technology', category: 'technology' },
    { id: 'technology_platforms', displayName: 'Technology Platforms', category: 'technology' },
    { id: 'software_saas', displayName: 'Software & SaaS', category: 'technology' },
    { id: 'semiconductors', displayName: 'Semiconductors', category: 'technology' },
    { id: 'crypto_digital_assets', displayName: 'Crypto & Digital Assets', category: 'technology' },
    { id: 'datacentres', displayName: 'Datacentres', category: 'technology_infrastructure' },
    { id: 'telecommunications', displayName: 'Telecommunications', category: 'telecommunications' },
    { id: 'industrials', displayName: 'Industrials', category: 'industrials' },
    { id: 'construction_engineering', displayName: 'Construction & Engineering', category: 'industrials' },
    { id: 'transport_logistics', displayName: 'Transport & Logistics', category: 'industrials' },
    { id: 'civil_aerospace', displayName: 'Civil Aerospace', category: 'industrials' },
    { id: 'defence', displayName: 'Defence', category: 'industrials' },
    { id: 'infrastructure', displayName: 'Infrastructure', category: 'infrastructure' },
    { id: 'utilities', displayName: 'Utilities', category: 'utilities' },
    { id: 'real_estate_reit', displayName: 'Real Estate / REIT', category: 'real_estate' },
    { id: 'healthcare_services', displayName: 'Healthcare Services', category: 'healthcare' },
    { id: 'medtech', displayName: 'Medtech', category: 'healthcare' },
    { id: 'pharma_biotech', displayName: 'Pharma & Biotech', category: 'healthcare' },
];

const TARGET_BY_ID = new Map(
    PORTFOLIO_TARGET_CLASSES.map((item) => [item.id, item]),
);

const CURRENT_TO_TARGET: Record<string, string> = {
    ALUMINIUM: 'base_metals_miners',
    BASEMETALS: 'base_metals_miners',
    BASE_METALS_MINERS: 'base_metals_miners',
    BONDS: 'bonds',
    FIXED_INCOME: 'bonds',
    BROAD_EQUITY: 'broad_equity',
    CASH: 'cash',
    COPPER: 'copper_miners',
    COPPER_MINERS: 'copper_miners',
    DEFENCE: 'defence',
    ENERGY: 'energy_producers',
    ENERGY_COMMODITIES: 'energy_commodities',
    ENERGY_PRODUCERS: 'energy_producers',
    EQUITY: 'broad_equity',
    GOLD: 'gold_miners',
    GOLD_MINERS: 'gold_miners',
    PHYSICAL_GOLD: 'physical_gold',
    SILVER: 'silver_miners',
    SILVER_MINERS: 'silver_miners',
    PHYSICAL_SILVER: 'physical_silver',
    LITHIUM: 'lithium_miners',
    LITHIUM_MINERS: 'lithium_miners',
    URANIUM: 'uranium_miners',
    URANIUM_MINERS: 'uranium_miners',
    REE: 'rare_earths_critical_minerals',
    RARE_EARTHS_CRITICAL_MINERALS: 'rare_earths_critical_minerals',
    IRON: 'iron_ore_miners',
    IRON_ORE_MINERS: 'iron_ore_miners',
    MATERIALS: 'diversified_miners',
    DIVERSIFIED_MINERS: 'diversified_miners',
    MATERIALS_CHEMICALS: 'materials_chemicals',
    FORESTRY_PAPER_PACKAGING: 'forestry_paper_packaging',
    STEEL_METALS_PROCESSING: 'steel_metals_processing',
    MINING_SERVICES: 'mining_services',
    AGRICULTURE_AGRIBUSINESS: 'agriculture_agribusiness',
    FINANCIALS: 'banks',
    BANKS: 'banks',
    INSURANCE: 'insurance',
    STAPLES: 'staples',
    CONSUMER_STAPLES: 'consumer_staples',
    CONSUMER_DISCRETIONARY: 'consumer_discretionary',
    GAMBLING: 'gambling',
    GAMING: 'gaming_gambling',
    GAMING_GAMBLING: 'gaming_gambling',
    EDUCATION: 'education',
    MEDIA_PUBLISHING: 'media_publishing',
    TECHNOLOGY: 'technology',
    TECHNOLOGY_PLATFORMS: 'technology_platforms',
    SOFTWARE_SAAS: 'software_saas',
    SEMICONDUCTORS: 'semiconductors',
    CRYPTO_DIGITAL_ASSETS: 'crypto_digital_assets',
    DATACENTRES: 'datacentres',
    TELECOMMUNICATIONS: 'telecommunications',
    INDUSTRIALS: 'industrials',
    CONSTRUCTION_ENGINEERING: 'construction_engineering',
    TRANSPORT_LOGISTICS: 'transport_logistics',
    CIVIL_AEROSPACE: 'civil_aerospace',
    INFRASTRUCTURE: 'infrastructure',
    UTILITIES: 'utilities',
    REAL_ESTATE_REIT: 'real_estate_reit',
    HEALTHCARE: 'healthcare_services',
    HEALTHCARE_SERVICES: 'healthcare_services',
    MEDTECH: 'medtech',
    PHARMA: 'pharma_biotech',
    PHARMA_BIOTECH: 'pharma_biotech',
};

const TARGET_ALIASES: Record<string, string> = {
    asset_managers_diversified_financials: 'banks',
    bank_financials: 'banks',
    bauxite_miner: 'base_metals_miners',
    base_metals_miner: 'base_metals_miners',
    broad_beta: 'broad_equity',
    chemicals_materials: 'materials_chemicals',
    coal_miner: 'energy_producers',
    consumer_retail: 'consumer_discretionary',
    copper_miner: 'copper_miners',
    diversified_miner: 'diversified_miners',
    energy: 'energy_producers',
    energy_oil_gas: 'energy_producers',
    etf: 'broad_equity',
    financials: 'banks',
    financials_bank_insurance: 'banks',
    fixed_income: 'bonds',
    general_equity: 'broad_equity',
    gold: 'gold_miners',
    gold_miner: 'gold_miners',
    healthcare: 'healthcare_services',
    iron: 'iron_ore_miners',
    iron_ore_miner: 'iron_ore_miners',
    lithium: 'lithium_miners',
    lithium_miner: 'lithium_miners',
    materials: 'diversified_miners',
    misc: 'broad_equity',
    pharma: 'pharma_biotech',
    physical_gold_etf: 'physical_gold',
    physical_silver_etf: 'physical_silver',
    rare_earths: 'rare_earths_critical_minerals',
    rare_earths_miner: 'rare_earths_critical_minerals',
    ree: 'rare_earths_critical_minerals',
    silver: 'silver_miners',
    silver_miner: 'silver_miners',
    steel_base_metals_processing: 'steel_metals_processing',
    mining_services: 'mining_services',
    uranium: 'uranium_miners',
    uranium_miner: 'uranium_miners',
    unassigned: 'broad_equity',
};

const TARGET_TO_CURRENT: Record<string, string> = {
    cash: 'CASH',
    bonds: 'BONDS',
    broad_equity: 'BROAD_EQUITY',
    physical_gold: 'PHYSICAL_GOLD',
    gold_miners: 'GOLD',
    physical_silver: 'PHYSICAL_SILVER',
    silver_miners: 'SILVER',
    copper_miners: 'COPPER',
    base_metals_miners: 'BASE_METALS_MINERS',
    lithium_miners: 'LITHIUM',
    uranium_miners: 'URANIUM',
    rare_earths_critical_minerals: 'REE',
    iron_ore_miners: 'IRON',
    diversified_miners: 'MATERIALS',
    materials_chemicals: 'MATERIALS_CHEMICALS',
    forestry_paper_packaging: 'FORESTRY_PAPER_PACKAGING',
    steel_metals_processing: 'STEEL_METALS_PROCESSING',
    mining_services: 'MINING_SERVICES',
    energy_producers: 'ENERGY',
    energy_commodities: 'ENERGY_COMMODITIES',
    agriculture_agribusiness: 'AGRICULTURE_AGRIBUSINESS',
    banks: 'BANKS',
    insurance: 'INSURANCE',
    staples: 'STAPLES',
    consumer_staples: 'CONSUMER_STAPLES',
    consumer_discretionary: 'CONSUMER_DISCRETIONARY',
    gambling: 'GAMBLING',
    gaming_gambling: 'GAMING_GAMBLING',
    education: 'EDUCATION',
    media_publishing: 'MEDIA_PUBLISHING',
    technology: 'TECHNOLOGY',
    technology_platforms: 'TECHNOLOGY_PLATFORMS',
    software_saas: 'SOFTWARE_SAAS',
    semiconductors: 'SEMICONDUCTORS',
    crypto_digital_assets: 'CRYPTO_DIGITAL_ASSETS',
    datacentres: 'DATACENTRES',
    telecommunications: 'TELECOMMUNICATIONS',
    industrials: 'INDUSTRIALS',
    construction_engineering: 'CONSTRUCTION_ENGINEERING',
    transport_logistics: 'TRANSPORT_LOGISTICS',
    civil_aerospace: 'CIVIL_AEROSPACE',
    defence: 'DEFENCE',
    infrastructure: 'INFRASTRUCTURE',
    utilities: 'UTILITIES',
    real_estate_reit: 'REAL_ESTATE_REIT',
    healthcare_services: 'HEALTHCARE_SERVICES',
    medtech: 'MEDTECH',
    pharma_biotech: 'PHARMA_BIOTECH',
};

function normalizeTargetId(value?: string | null): string {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return TARGET_ALIASES[normalized] || normalized;
}

function toUpperSnake(value: string): string {
    return normalizeTargetId(value).toUpperCase();
}

export function buildPortfolioMemoTargetUniverse(
    sleeves: AssetClass[] = [],
) {
    const activeSleeves = sleeves
        .filter(
            (sleeve) => {
                const code = normalizeAssetClassCode(sleeve.code);
                const type = String(sleeve.class_type || '').toUpperCase();
                return (
                    sleeve.active &&
                    sleeve.allow_target_weight &&
                    code !== 'UNASSIGNED' &&
                    (type !== 'SYSTEM_BUCKET' || code === 'CASH')
                );
            },
        )
        .sort((a, b) => a.display_order - b.display_order);

    if (activeSleeves.length > 0) {
        return activeSleeves.map((sleeve) => {
            const assetClass = normalizeAssetClassCode(sleeve.code);
            return {
                asset_class: assetClass,
                display_name:
                    sleeve.display_name ||
                    TARGET_BY_ID.get(normalizeTargetId(assetClass))?.displayName ||
                    sleeve.code,
                category:
                    TARGET_BY_ID.get(normalizeTargetId(assetClass))?.category ||
                    normalizeTargetId(sleeve.parent_code) ||
                    'allocation',
            };
        });
    }

    return PORTFOLIO_TARGET_CLASSES.map((item) => ({
        asset_class: item.id.toUpperCase(),
        display_name: item.displayName,
        category: item.category,
    }));
}

export function mapCurrentAssetClassToPortfolioTarget(
    value?: string | null,
): string {
    const normalized = normalizeAssetClassCode(value);
    const mapped = CURRENT_TO_TARGET[normalized];
    if (mapped) return mapped.toUpperCase();
    const candidate = normalizeTargetId(value);
    return TARGET_BY_ID.has(candidate) ? candidate.toUpperCase() : 'BROAD_EQUITY';
}

export function mapPortfolioTargetToCurrentAssetClass(
    value?: string | null,
): string {
    const target = normalizeTargetId(value);
    if (TARGET_BY_ID.has(target)) return target.toUpperCase();
    return toUpperSnake(target || String(value || 'BROAD_EQUITY'));
}

export function getPortfolioTargetDisplayName(value?: string | null): string {
    const target = TARGET_BY_ID.get(normalizeTargetId(value));
    return target?.displayName || String(value || '').trim();
}

export function mapOverlayAssetClassesForMemo(
    rows: PortfolioOverlaySummaryResponse['asset_classes'] = [],
) {
    return rows.map((row) => {
        const targetId = mapCurrentAssetClassToPortfolioTarget(row.asset_class);
        return {
            ...row,
            source_asset_class: row.asset_class,
            asset_class: targetId,
            display_name:
                getPortfolioTargetDisplayName(targetId) || row.display_name,
        };
    });
}
