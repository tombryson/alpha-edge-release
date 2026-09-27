import { Children, createContext, isValidElement, useContext, type ReactNode } from 'react';

type RiskGroup = 'full_q1' | 'partial_q1' | 'q1_exempt';
type RowBoundary = { group: RiskGroup; first: boolean; last: boolean };
const RiskGroupContext = createContext<RowBoundary | null>(null);

// Providers add no table markup. Boundaries follow the currently visible rows.
export function PositionRiskGroup({ group, enabled, children }: {
    group: RiskGroup;
    enabled: boolean;
    children: ReactNode;
}) {
    if (!enabled) return children;
    const rows = Children.toArray(children).filter(isValidElement);
    return rows.map((row, index) => (
        <RiskGroupContext.Provider key={row.key} value={{ group, first: index === 0, last: index === rows.length - 1 }}>
            {row}
        </RiskGroupContext.Provider>
    ));
}

export function usePositionRiskRow() {
    const boundary = useContext(RiskGroupContext);
    return {
        'data-risk-group': boundary?.group,
        'data-risk-start': boundary?.first || undefined,
        'data-risk-end': boundary?.last || undefined,
    };
}
