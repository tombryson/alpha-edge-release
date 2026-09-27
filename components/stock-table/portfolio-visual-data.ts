import type {
    PortfolioMixCurrentResponse,
    PortfolioRebalancePlanRow,
} from '@/lib/api';
import { normalizeAssetClassCode } from '@/lib/asset-class';
import {
    getPortfolioAssetClassColor,
    getPortfolioGroupColor,
} from '@/lib/portfolio-composition-colors';
export { getPortfolioAssetClassColor } from '@/lib/portfolio-composition-colors';
import type { OverlayAssetClassRow } from '@/components/stock-table/types';

export type PortfolioVisualSource = 'current' | 'target';

export type PortfolioVisualSegment = {
    key: string;
    label: string;
    pct: number;
    rawPct: number;
    value: number;
    color: string;
    assetClassCodes: string[];
};

export type PortfolioPieRow = {
    assetClass: string;
    displayName: string;
    parentGroup?: string;
    value: number;
};

type PortfolioMixRow = PortfolioMixCurrentResponse['rows'][number];

type ParentGroupResolver = (
    code?: string | null,
    fallbackLabel?: string | null,
) => string;

export function portfolioColorToSurfaceTint(hex: string): string {
    return `color-mix(in srgb, ${hex} 12%, var(--panel-bg-alt))`;
}

export function buildPortfolioVisualSegments({
    source,
    totalValue,
    targetActive,
    portfolioMixRows,
    overlayAssetClassRows,
    portfolioRebalanceRows,
    flatten,
    equalWidth,
    lockedOrder,
    getParentGroup,
}: {
    source: PortfolioVisualSource;
    totalValue: number;
    targetActive: boolean;
    portfolioMixRows?: PortfolioMixRow[] | null;
    overlayAssetClassRows?: OverlayAssetClassRow[] | null;
    portfolioRebalanceRows?: PortfolioRebalancePlanRow[] | null;
    flatten: boolean;
    equalWidth: boolean;
    lockedOrder?: string[] | null;
    getParentGroup: ParentGroupResolver;
}): PortfolioVisualSegment[] {
    const targetRows = portfolioRebalanceRows || [];
    const rows =
        source === 'target' && targetActive && targetRows.length > 0
            ? targetRows.map((row) => ({
                  key: normalizeAssetClassCode(row.asset_class),
                  color: getPortfolioAssetClassColor(row.asset_class),
                  label: row.display_name || row.asset_class,
                  pct: row.target_weight_pct || 0,
                  value: row.target_weight_pct || 0,
              }))
            : portfolioMixRows?.length
              ? portfolioMixRows.map((row) => ({
                    key: normalizeAssetClassCode(row.asset_class),
                    color: getPortfolioAssetClassColor(row.asset_class),
                    label: row.display_name || row.asset_class,
                    pct: row.weight_pct || 0,
                    value:
                        row.value ||
                        (totalValue > 0
                            ? ((row.weight_pct || 0) / 100) * totalValue
                            : row.weight_pct || 0),
                }))
              : (overlayAssetClassRows || []).map((row) => ({
                    key: normalizeAssetClassCode(row.asset_class),
                    color: getPortfolioAssetClassColor(row.asset_class),
                    label: row.display_name || row.asset_class,
                    pct:
                        row.total_class_capital_pct ??
                        row.portfolio_weight_pct ??
                        row.trigger_total_class_pct ??
                        0,
                    value:
                        row.total_class_capital_value ??
                        row.total_capital ??
                        row.invested_value ??
                        row.actual_invested_value ??
                        0,
                }));
    const visibleRows = rows.filter((row) => row.pct > 0 || row.value > 0);
    const barRows = flatten
        ? visibleRows.map((row) => ({
              ...row,
              assetClassCodes: [normalizeAssetClassCode(row.key)],
          }))
        : Array.from(
              visibleRows
                  .reduce<
                      Map<
                          string,
                          {
                              key: string;
                              label: string;
                              pct: number;
                              value: number;
                              color: string;
                              assetClassCodes: string[];
                          }
                      >
                  >((acc, row) => {
                      const assetClassCode = normalizeAssetClassCode(row.key);
                      const parentGroup = getParentGroup(
                          assetClassCode,
                          row.label,
                      );
                      const existing = acc.get(parentGroup);
                      acc.set(parentGroup, {
                          key: parentGroup,
                          label: parentGroup,
                          pct: (existing?.pct || 0) + (row.pct || 0),
                          value: (existing?.value || 0) + (row.value || 0),
                          color:
                              existing?.color ||
                              getPortfolioGroupColor(parentGroup),
                          assetClassCodes: Array.from(
                              new Set([
                                  ...(existing?.assetClassCodes || []),
                                  assetClassCode,
                              ]),
                          ),
                      });
                      return acc;
                  }, new Map())
                  .values(),
          );
    const basisTotal = visibleRows.reduce((sum, row) => {
        const basis = row.value > 0 ? row.value : row.pct;
        return sum + basis;
    }, 0);
    const lockedOrderIndex = new Map(
        (source === 'target' ? lockedOrder || [] : []).map(
            (key, index) => [key, index] as const,
        ),
    );
    const orderedBarRows = [...barRows].sort((a, b) => {
        const aLockedIndex = lockedOrderIndex.get(a.key);
        const bLockedIndex = lockedOrderIndex.get(b.key);
        if (aLockedIndex != null || bLockedIndex != null) {
            if (aLockedIndex == null) return 1;
            if (bLockedIndex == null) return -1;
            return aLockedIndex - bLockedIndex;
        }
        return b.pct - a.pct;
    });

    return orderedBarRows.map((row) => {
        const displayPct =
            basisTotal > 0
                ? ((row.value > 0 ? row.value : row.pct) / basisTotal) * 100
                : 0;
        return {
            ...row,
            rawPct: row.pct,
            pct: equalWidth ? 1 : displayPct,
            color: row.color,
        };
    });
}

export function buildPortfolioPieRows({
    source,
    totalValue,
    targetActive,
    portfolioMixRows,
    overlayAssetClassRows,
    portfolioRebalanceRows,
    getParentGroup,
}: {
    source: PortfolioVisualSource;
    totalValue: number;
    targetActive: boolean;
    portfolioMixRows?: PortfolioMixRow[] | null;
    overlayAssetClassRows?: OverlayAssetClassRow[] | null;
    portfolioRebalanceRows?: PortfolioRebalancePlanRow[] | null;
    getParentGroup: ParentGroupResolver;
}): PortfolioPieRow[] {
    const targetRows = portfolioRebalanceRows || [];
    if (source === 'target' && targetActive && targetRows.length > 0) {
        return targetRows
            .map((row) => ({
                assetClass: normalizeAssetClassCode(row.asset_class),
                displayName: row.display_name || row.asset_class,
                parentGroup: getParentGroup(row.asset_class, row.display_name),
                value:
                    totalValue > 0
                        ? ((row.target_weight_pct || 0) / 100) * totalValue
                        : row.target_weight_pct || 0,
            }))
            .filter((row) => row.value > 0);
    }

    if (portfolioMixRows?.length) {
        return portfolioMixRows
            .map((row) => ({
                assetClass: normalizeAssetClassCode(row.asset_class),
                displayName: row.display_name || row.asset_class,
                parentGroup: getParentGroup(row.asset_class, row.display_name),
                value:
                    row.value ||
                    (totalValue > 0
                        ? ((row.weight_pct || 0) / 100) * totalValue
                        : row.weight_pct || 0),
            }))
            .filter((row) => row.value > 0);
    }

    return (overlayAssetClassRows || [])
        .map((row) => ({
            assetClass: normalizeAssetClassCode(row.asset_class),
            displayName: row.display_name || row.asset_class,
            parentGroup: getParentGroup(row.asset_class, row.display_name),
            value:
                row.actual_invested_value ??
                row.invested_value ??
                row.total_class_capital_value ??
                row.total_capital ??
                0,
        }))
        .filter((row) => row.value > 0);
}
