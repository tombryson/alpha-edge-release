import { assetClassColor, assetClassGroupColor } from './asset-class-identity';

export { assetClassGroupColor as getPortfolioGroupColor };
export const PORTFOLIO_COMPACT_OTHER_COLOR = assetClassColor('OTHER');

export function normalizePortfolioAssetClass(value: string): string {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Compatibility entry point; list position no longer affects identity.
export function getPortfolioAssetClassColor(
    assetClass: string,
    _fallbackIndex = 0,
): string {
    return assetClassColor(assetClass);
}
