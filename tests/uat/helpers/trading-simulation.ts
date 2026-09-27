import type { APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';
import { apiBaseUrl, postJson } from './overlay-api';

export type AlertRow = {
    id: number;
    ticker: string;
    alert_type: string;
    source?: string;
    is_active?: boolean;
};

export type SecurityPosition = {
    ticker: string;
    position_state: string;
    stopped_waiting_reentry?: boolean;
};

export const postTradingViewSignal = async (
    request: APIRequestContext,
    payload: {
        ticker: string;
        signal: string;
        script: string;
        timeframe?: string;
        close?: number;
        price?: number;
    },
): Promise<unknown> =>
    postJson(request, '/webhook/tradingview', {
        timeframe: '1D',
        ...payload,
    });

export const getAlerts = async (
    request: APIRequestContext,
    includeHistory = false,
): Promise<AlertRow[]> => {
    const response = await request.get(
        `${apiBaseUrl}/alerts${includeHistory ? '?includeHistory=true' : ''}`,
    );
    expect(response.ok(), `/alerts failed: ${await response.text()}`).toBe(true);
    return (await response.json()) as AlertRow[];
};

export const waitForAlert = async (
    request: APIRequestContext,
    predicate: (alert: AlertRow) => boolean,
): Promise<AlertRow> => {
    let matching: AlertRow | undefined;

    await expect
        .poll(
            async () => {
                matching = (await getAlerts(request, true)).find(predicate);
                return Boolean(matching);
            },
            { timeout: 20_000 },
        )
        .toBe(true);

    return matching!;
};

export const recordDecision = async (
    request: APIRequestContext,
    alert: AlertRow,
    decision: 'BUY' | 'SELL' | 'SELL_50' | 'SELL_DOWN' | 'ADD' | 'TRIM' | 'IGNORE',
    notes = '',
): Promise<unknown> =>
    postJson(request, '/decisions', {
        alert_id: alert.id,
        decision,
        notes,
    });

export const getSecurityPositions = async (
    request: APIRequestContext,
): Promise<SecurityPosition[]> => {
    const response = await request.get(`${apiBaseUrl}/positions`);
    expect(response.ok(), `/positions failed: ${await response.text()}`).toBe(true);
    return (await response.json()) as SecurityPosition[];
};

export const expectSecurityState = async (
    request: APIRequestContext,
    ticker: string,
    expectedState: string,
): Promise<void> => {
    await expect
        .poll(
            async () =>
                (await getSecurityPositions(request)).find(
                    (position) => position.ticker === ticker,
                )?.position_state,
            { timeout: 20_000 },
        )
        .toBe(expectedState);
};

export const bulkMapCompanies = async (
    request: APIRequestContext,
    mappings: Array<{
        company_name: string;
        ticker: string;
        exchange_prefix: string;
        template_id?: string;
    }>,
): Promise<unknown> =>
    postJson(
        request,
        '/mappings/bulk',
        mappings.map((mapping) => ({
            template_id: '',
            ...mapping,
        })),
    );

export const setAnalysisSecurityType = async (
    request: APIRequestContext,
    payload: {
        name: string;
        ticker: string;
        security_type: 'STOCK' | 'ETF' | 'FUND';
        primary_asset_class: string;
    },
): Promise<unknown> =>
    postJson(request, '/analysis/security-type', {
        name: payload.name,
        ticker: payload.ticker,
        security_type: payload.security_type,
        primary_asset_class: payload.primary_asset_class,
    });

export const approveCurrentPortfolioMix = async (
    request: APIRequestContext,
    reason = 'UAT',
): Promise<unknown> =>
    postJson(request, '/portfolio-mix/approve-current', {
        reason,
        notes: 'Approved by UAT trading simulation.',
    });
