'use client';

import { useEffect, useState } from 'react';
import { api, type CommodityTheme } from '@/lib/api';

export const COMMODITY_THEME_OPEN_EVENT = 'alpha-edge:open-commodity-theme';
export const COMMODITY_THEME_STATUS_BAR_SLOT_CLASS =
    'inline-flex h-4 w-[26px] shrink-0 items-center px-px';

type CommodityThemePathIndicatorProps = {
    themeCode: string;
    path?: 'direct' | 'equity';
    className?: string;
};

const toneByStatus: Record<string, string> = {
    CONFIRMED: 'bg-emerald-400',
    PARTIAL: 'bg-emerald-400',
    BLOCKED: 'bg-red-400',
    WAITING: 'border border-amber-400/80 bg-transparent',
    DISCONNECTED: 'border border-muted-foreground/45 bg-transparent',
};

function openCommodityTheme(themeCode: string) {
	window.dispatchEvent(
        new CustomEvent(COMMODITY_THEME_OPEN_EVENT, {
            detail: { code: themeCode },
        }),
    );
}

export function CommodityThemePathIndicator({
    themeCode,
    path = 'equity',
    className = '',
}: CommodityThemePathIndicatorProps) {
    const [theme, setTheme] = useState<CommodityTheme | null>(null);

    useEffect(() => {
        let cancelled = false;
        void api
            .getCommodityThemes()
            .then((response) => {
                if (cancelled) return;
                setTheme(
                    response.themes.find(
                        (item) => item.code === themeCode,
                    ) ?? null,
                );
            })
            .catch(() => {
                if (!cancelled) setTheme(null);
            });
        return () => {
            cancelled = true;
        };
    }, [themeCode]);

    if (!theme) return null;

    const directStage = theme.stages.find((stage) => stage.key === 'COMMODITY');
    const stages = path === 'direct'
        ? directStage ? [directStage] : []
        : theme.stages.filter((stage) => stage.key !== 'COMMODITY');
    const confirmationCount = path === 'direct'
        ? directStage?.status === 'CONFIRMED' ? 1 : 0
        : theme.confirmation_count;
    const confirmationTotal = path === 'direct' ? stages.length : theme.confirmation_total;
    const capacity = theme.tactical.budget_approved
        ? `${Math.round((theme.confirmation_count / Math.max(theme.confirmation_total, 1)) * 100)}% capacity`
        : 'No approved budget';
    const pathLabel = path === 'direct'
        ? theme.code === 'GOLD' ? 'Physical gold gate' : 'Direct commodity gate'
        : `${theme.display_name} equity path`;
    const title = path === 'direct'
        ? `${pathLabel}: ${directStage ? statusLabel(directStage.status) : 'No signal'}.`
        : `${pathLabel}: ${confirmationCount}/${confirmationTotal} confirmed. ${capacity}.`;

    return (
        <button
            type="button"
            className={`inline-flex items-center gap-1.5 rounded-[3px] px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-[0.06em] text-muted-foreground/85 transition-colors hover:bg-muted/40 hover:text-foreground ${className}`}
            title={title}
            onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openCommodityTheme(theme.code);
            }}
        >
            <span className="text-muted-foreground/70">
                {path === 'direct' && theme.code === 'GOLD' ? 'Physical gold' : theme.display_name}
            </span>
            <span className="flex items-center gap-0.5" aria-hidden="true">
                {stages.map((stage) => (
                    <span
                        key={stage.key}
                        className={`h-[5px] w-[5px] rounded-full ${toneByStatus[stage.status] ?? toneByStatus.DISCONNECTED}`}
                    />
                ))}
            </span>
            <span>{confirmationCount}/{confirmationTotal}</span>
        </button>
    );
}

type CommodityThemeEquityGateIndicatorProps = {
    theme: CommodityTheme;
    className?: string;
};

type CommodityThemeDirectAndEquityGateIndicatorProps = {
    theme: CommodityTheme;
    className?: string;
};

export function CommodityThemeStatusBar({
    status,
    className = '',
}: {
    status?: string | null;
    className?: string;
}) {
    const isBullish = status === 'CONFIRMED';

    return (
        <span
            aria-hidden="true"
            className={`block h-[5px] w-full rounded-[2px] transition-[background-color,box-shadow,border-color] ${
                isBullish
                    ? 'bg-[#c9a257] shadow-[0_0_6px_rgba(201,162,87,0.7)]'
                    : 'border border-muted-foreground/55 bg-transparent'
            } ${className}`}
        />
    );
}

function CommodityThemeGateBar({
    theme,
    stageKey,
    label,
}: {
    theme: CommodityTheme;
    stageKey: 'COMMODITY' | 'EQUITY_RELATIVE';
    label: string;
}) {
    const stage = theme.stages.find((item) => item.key === stageKey);
    const isBullish = stage?.status === 'CONFIRMED';
    const sourceLabel = stage?.source.label || label;
    const stateLabel = !stage
        ? 'No signal'
        : isBullish
        ? 'Bullish'
        : stage.status === 'BLOCKED'
          ? 'Bearish'
          : 'Not confirmed';

    return (
        <button
            type="button"
            className={COMMODITY_THEME_STATUS_BAR_SLOT_CLASS}
            title={`${sourceLabel}: ${stateLabel}. Open Market Map.`}
            aria-label={`${sourceLabel}: ${stateLabel}`}
            onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openCommodityTheme(theme.code);
            }}
        >
            <CommodityThemeStatusBar status={stage?.status} />
        </button>
    );
}

export function CommodityThemeDirectAndEquityGateIndicator({
    theme,
    className = '',
}: CommodityThemeDirectAndEquityGateIndicatorProps) {
    return (
        <span className={`ml-2 inline-flex items-center gap-1 ${className}`}>
            <CommodityThemeGateBar
                theme={theme}
                stageKey="COMMODITY"
                label={`${theme.display_name} commodity`}
            />
            <CommodityThemeGateBar
                theme={theme}
                stageKey="EQUITY_RELATIVE"
                label={`${theme.display_name} equities`}
            />
        </span>
    );
}

export function CommodityThemeEquityGateIndicator({
    theme,
    className = '',
}: CommodityThemeEquityGateIndicatorProps) {
    return (
        <span className={`ml-2 inline-flex ${className}`}>
            <CommodityThemeGateBar
                theme={theme}
                stageKey="EQUITY_RELATIVE"
                label={`${theme.display_name} equities`}
            />
        </span>
    );
}

function statusLabel(status: string): string {
    return {
        CONFIRMED: 'Confirmed',
        PARTIAL: 'Partial',
        BLOCKED: 'Blocked',
        WAITING: 'Waiting',
        DISCONNECTED: 'No signal',
    }[status] ?? 'No signal';
}
