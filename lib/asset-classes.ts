import type { AssetClass } from '@/lib/api';
import { normalizeAssetClassCode } from '@/lib/asset-class';

export function getAssignableAssetClasses(
    assetClasses: AssetClass[],
): AssetClass[] {
    return assetClasses
        .filter(
            (assetClass) =>
                assetClass.active &&
                assetClass.allow_grouping &&
                String(assetClass.class_type || '').toUpperCase() !==
                    'SYSTEM_BUCKET',
        )
        .sort((a, b) => a.display_order - b.display_order);
}

export function getAnalysisAssetClasses(assetClasses: AssetClass[]): AssetClass[] {
    return getAssignableAssetClasses(assetClasses).filter(
        (assetClass) => assetClass.analysis_eligible !== false,
    );
}

export function formatAssetClassName(assetClass: AssetClass): string {
    return (
        String(assetClass.display_name || '').trim() ||
        normalizeAssetClassCode(assetClass.code)
            .toLowerCase()
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (char) => char.toUpperCase())
    );
}
