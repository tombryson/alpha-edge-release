import { expect, test } from '@playwright/test';

test.describe('standalone UAT event simulator', () => {
    test.skip(
        process.env.UAT_EVENT_SIMULATOR_TEST !== '1',
        'the simulator runner intentionally mutates only its reserved UAT fixture',
    );

    const seedBaseline = async (page: import('@playwright/test').Page) => {
        const baselineImport = await page.request.post(
            `${process.env.UAT_API_BASE_URL || 'http://localhost:8081/api'}/statements/import`,
            {
                headers: { Authorization: `Bearer ${process.env.UAT_API_TOKEN || 'local'}` },
                data: {
                    account: {
                        account_name: 'UAT Simulator Account',
                        statement_date: '2026-08-08T00:00:00.000Z',
                        total_value_aud: 5000,
                        cash_aud: 5000,
                        usd_value: 0,
                        usd_aud: 0,
                        gbp_value: 0,
                        gbp_aud: 0,
                        aud_value: 5000,
                    },
                    holdings: [],
                },
            },
        );
        expect(baselineImport.ok()).toBe(true);
    };

    test('replays fixed events through the real webhook path', async ({ page }) => {
        await seedBaseline(page);

        await page.goto('/');
        await page.getByTestId('api-base').fill(process.env.UAT_API_BASE_URL || 'http://localhost:8081/api');
        await page.getByTestId('api-token').fill(process.env.UAT_API_TOKEN || 'local');
        await page.getByRole('button', { name: 'Check connection' }).click();
        await expect(page.locator('#status-line')).toContainText('Authenticated UAT connection confirmed');

        await page.getByTestId('scenario').selectOption('routing_guardrails');
        await page.getByTestId('start').click();
        await expect(page.locator('#status-line')).toContainText('Fixture ready');
        await expect(page.locator('#status-line')).toContainText('100 AEVT');

        const seededStatement = await page.request.get(
            `${process.env.UAT_API_BASE_URL || 'http://localhost:8081/api'}/statements/latest`,
            { headers: { Authorization: `Bearer ${process.env.UAT_API_TOKEN || 'local'}` } },
        );
        expect(seededStatement.ok()).toBe(true);
        const seededBody = await seededStatement.json();
        expect(seededBody.holdings).toEqual(expect.arrayContaining([
            expect.objectContaining({ details: 'UAT Event Simulator', ticker: 'AEVT' }),
        ]));

        await page.getByTestId('next').click();
        await expect(page.getByTestId('step-1')).toContainText('Backend match');

        await page.getByTestId('next').click();
        await expect(page.getByTestId('step-2')).toContainText('Backend match');

        await page.getByTestId('next').click();
        await expect(page.getByTestId('step-3')).toContainText('Backend match');

        await page.getByTestId('next').click();
        await expect(page.getByTestId('step-4')).toContainText('ADD card');
        await expect(page.getByTestId('step-4')).toContainText('funded $100 ticket');
        await expect(page.getByTestId('step-4')).toContainText('Backend match');
    });

    test('reuses fixture cash when Start clean runs again', async ({ page }) => {
        await seedBaseline(page);

        await page.goto('/');
        await page.getByTestId('api-base').fill(process.env.UAT_API_BASE_URL || 'http://localhost:8081/api');
        await page.getByTestId('api-token').fill(process.env.UAT_API_TOKEN || 'local');

        await page.getByTestId('start').click();
        await expect(page.locator('#status-line')).toContainText('Fixture ready');

        await page.getByTestId('start').click();
        await expect(page.locator('#status-line')).toContainText('Fixture ready');
        await expect(page.locator('#status-line')).toContainText('$500');
    });

    test('covers the complete stock alert catalogue, including Breakout', async ({ page }) => {
        await seedBaseline(page);

        await page.goto('/');
        await page.getByTestId('api-base').fill(process.env.UAT_API_BASE_URL || 'http://localhost:8081/api');
        await page.getByTestId('api-token').fill(process.env.UAT_API_TOKEN || 'local');
        await page.getByTestId('scenario').selectOption('stock_alert_catalogue');
        await page.getByTestId('start').click();
        await expect(page.locator('#status-line')).toContainText('Fixture ready');

        for (let step = 1; step <= 12; step += 1) {
            await page.getByTestId('next').click();
            await expect(page.getByTestId(`step-${step}`)).toContainText('Backend match');
        }

        await expect(page.getByTestId('step-3')).toContainText('BREAKOUT card');
        await expect(page.getByTestId('step-4')).toContainText('ADD card; Weak 1D');
        await expect(page.getByTestId('step-5')).toContainText('ADD card; Strong 3D');
        await expect(page.getByTestId('step-6')).toContainText('TRIM card; Weak 1D');
        await expect(page.getByTestId('step-7')).toContainText('TRIM card; Strong 2D');
        await expect(page.getByTestId('step-8')).toContainText('SELL DOWN card');
        await expect(page.getByTestId('step-9')).toContainText('SELL 50 card');
        await expect(page.getByTestId('step-10')).toContainText('REENTRY card');
        await expect(page.getByTestId('step-12')).toContainText('SELL card');
    });

    test('accepts TradingView BATS and ASX_DLY commodity-ratio payloads', async ({ page }) => {
        await seedBaseline(page);

        await page.goto('/');
        await page.getByTestId('api-base').fill(process.env.UAT_API_BASE_URL || 'http://localhost:8081/api');
        await page.getByTestId('api-token').fill(process.env.UAT_API_TOKEN || 'local');
        await page.getByTestId('scenario').selectOption('commodity_ratio_transport');
        await page.getByTestId('start').click();
        await expect(page.locator('#status-line')).toContainText('Fixture ready');

        for (let step = 1; step <= 4; step += 1) {
            await page.getByTestId('next').click();
            await expect(page.getByTestId(`step-${step}`)).toContainText('Backend match');
        }

        await expect(page.getByTestId('step-1')).toContainText('EQUITY RELATIVE; BUY');
        await expect(page.getByTestId('step-2')).toContainText('SECURITY OUTPERFORM; BUY; AEVT');
        await expect(page.getByTestId('step-3')).toContainText('SECURITY OUTPERFORM; SELL; AEVT');
        await expect(page.getByTestId('step-4')).toContainText('EQUITY REGIME STRONG TRIM includes AEVT');
    });
});
