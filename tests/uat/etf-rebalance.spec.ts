import { test, expect, type APIRequestContext } from '@playwright/test';
import { assertUatSafety } from './helpers/action-workflows';
import { resetLocalUatDatabaseIfConfigured } from './helpers/local-db';
import { apiBaseUrl } from './helpers/overlay-api';

type ETFRebalanceTarget = {
    sequence_number: number;
    ticker: string;
    current_allocation: number;
    target_allocation: number;
    pending_delta: number;
    status: string;
    weighted_portfolio_return?: number;
};

type ETFAllocation = {
    ticker: string;
    allocation_percent: number;
    base_weight: number;
};

type ETFAllocationLedger = {
    policy: {
        minimum_exposure_pct: number;
        core_sleeve_ratio_pct: number;
    };
    summary: {
        minimum_etf_value: number;
        tactical_target_value: number;
    };
    rows: Array<{
        ticker: string;
        asset_class: string;
        tactical_target_value: number;
        final_target_value: number;
        target_weight_pct: number;
        status: string;
    }>;
};

const postETFRebalance = async (
    request: APIRequestContext,
    payload: unknown,
): Promise<void> => {
    const response = await request.post(`${apiBaseUrl}/webhook/etf-rebalance`, {
        data: payload,
    });
    expect(
        response.ok(),
        `/webhook/etf-rebalance failed: ${await response.text()}`,
    ).toBe(true);
};

const getActiveETFRebalance = async (
    request: APIRequestContext,
): Promise<ETFRebalanceTarget[]> => {
    const response = await request.get(`${apiBaseUrl}/etf/rebalance`);
    expect(response.ok(), `/etf/rebalance failed: ${await response.text()}`).toBe(
        true,
    );
    return (await response.json()) as ETFRebalanceTarget[];
};

const getETFAllocations = async (
    request: APIRequestContext,
): Promise<ETFAllocation[]> => {
    const response = await request.get(`${apiBaseUrl}/etf/allocations`);
    expect(response.ok(), `/etf/allocations failed: ${await response.text()}`).toBe(
        true,
    );
    return (await response.json()) as ETFAllocation[];
};

const getETFAllocationLedger = async (
    request: APIRequestContext,
): Promise<ETFAllocationLedger> => {
    const response = await request.get(`${apiBaseUrl}/etf/allocation-ledger`);
    expect(
        response.ok(),
        `/etf/allocation-ledger failed: ${await response.text()}`,
    ).toBe(true);
    return (await response.json()) as ETFAllocationLedger;
};

test.describe('UAT ETF rebalance workflow', () => {
    test.skip(
        process.env.UAT_ETF_REBALANCE_TEST !== '1',
        'destructive ETF rebalance tests require UAT_ETF_REBALANCE_TEST=1',
    );

    test.beforeEach(() => {
        assertUatSafety();
        resetLocalUatDatabaseIfConfigured();
    });

    test('ETF rebalance webhook creates active targets and allocation rows', async ({
        request,
    }) => {
        const sequence = 91001;
        await postETFRebalance(request, {
            sequence_number: sequence,
            rebalance_date: '2026-05-17',
            weighted_portfolio_return: 5.62,
            allocations: [
                { ticker: 'FANG', rank: 1, return_60bar: 22.45, allocation: 18.45 },
                { ticker: 'QUAL', rank: 2, return_60bar: 13.1, allocation: 12.25 },
            ],
        });

        await expect
            .poll(
                async () =>
                    (await getActiveETFRebalance(request)).filter(
                        (target) => target.sequence_number === sequence,
                    ).length,
                { timeout: 20_000 },
            )
            .toBe(2);

        const active = (await getActiveETFRebalance(request)).filter(
            (target) => target.sequence_number === sequence,
        );
        expect(active.map((target) => target.ticker)).toEqual(['FANG', 'QUAL']);
        expect(active.every((target) => target.status === 'PENDING')).toBe(true);
        expect(active.find((target) => target.ticker === 'FANG')?.target_allocation).toBe(
            18.45,
        );

        const allocations = await getETFAllocations(request);
        expect(
            allocations.find((allocation) => allocation.ticker === 'FANG')
                ?.allocation_percent,
        ).toBe(18.45);
        expect(
            allocations.find((allocation) => allocation.ticker === 'FANG')?.base_weight,
        ).toBe(18.45);
        expect(
            allocations.find((allocation) => allocation.ticker === 'QUAL')
                ?.allocation_percent,
        ).toBe(12.25);

        const ledger = await getETFAllocationLedger(request);
        expect(ledger.policy.minimum_exposure_pct).toBe(25);
        expect(ledger.policy.core_sleeve_ratio_pct).toBe(25);
        const fang = ledger.rows.find((row) => row.ticker === 'FANG');
        expect(fang?.asset_class).toBe('TECHNOLOGY_PLATFORMS');
        expect(fang?.status).toBe('BUY');
        expect(fang?.final_target_value).toBeGreaterThan(0);
    });

    test('new ETF rebalance supersedes the prior sequence in the active workflow', async ({
        request,
    }) => {
        await postETFRebalance(request, {
            sequence_number: 91002,
            rebalance_date: '2026-05-17',
            weighted_portfolio_return: 4.2,
            allocations: [{ ticker: 'FANG', rank: 1, return_60bar: 12, allocation: 20 }],
        });
        await expect
            .poll(async () => (await getActiveETFRebalance(request)).length, {
                timeout: 20_000,
            })
            .toBe(1);

        await postETFRebalance(request, {
            sequence_number: 91003,
            rebalance_date: '2026-05-18',
            weighted_portfolio_return: 6.1,
            allocations: [{ ticker: 'QUAL', rank: 1, return_60bar: 15, allocation: 25 }],
        });

        await expect
            .poll(
                async () =>
                    (await getActiveETFRebalance(request)).map(
                        (target) => target.sequence_number,
                    ),
                { timeout: 20_000 },
            )
            .toEqual([91003]);
    });

    test('ETF rebalance dismiss removes the sequence from active workflow', async ({
        request,
    }) => {
        const sequence = 91004;
        await postETFRebalance(request, {
            sequence_number: sequence,
            rebalance_date: '2026-05-17',
            weighted_portfolio_return: 3.5,
            allocations: [{ ticker: 'FANG', rank: 1, return_60bar: 8, allocation: 15 }],
        });

        await expect
            .poll(async () => (await getActiveETFRebalance(request)).length, {
                timeout: 20_000,
            })
            .toBe(1);

        const response = await request.post(`${apiBaseUrl}/etf/rebalance/${sequence}/dismiss`);
        expect(response.ok(), `/etf/rebalance dismiss failed: ${await response.text()}`).toBe(
            true,
        );

        await expect
            .poll(async () => (await getActiveETFRebalance(request)).length, {
                timeout: 20_000,
            })
            .toBe(0);
    });
});
