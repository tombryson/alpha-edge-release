import { expect, test } from '@playwright/test';

test('opens Help from the shell and routes its contents', async ({ page }) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('alpha-edge-api-token', 'help-page-fixture-token');
        window.localStorage.removeItem('alpha-edge-active-tab');
    });

    await page.goto('/');
    await page.getByTestId('header-help').click();

    await expect(page).toHaveURL(/#\/help$/);
    await expect(page.getByTestId('help-tab')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Help', exact: true })).toBeVisible();
    await expect(page.getByTestId('help-article-overview')).toBeVisible();
    await expect(page.getByTestId('help-article-overview')).toContainText('Current positions');
    await expect(page.getByTestId('help-article-overview')).toContainText('Research ledger');
    await expect(page.getByTestId('help-article-overview')).toContainText('Market gates');

    const contents = page.getByRole('navigation', { name: 'Help contents' });
    await contents.getByRole('button', { name: 'Markets', exact: true }).click();

    await expect(page).toHaveURL(/#\/help\/markets$/);
    await expect(contents.getByRole('button', { name: 'Markets', exact: true })).toHaveAttribute(
        'aria-current',
        'page',
    );
    await expect(page.getByTestId('help-article-markets')).toBeVisible();
    await expect(page.getByTestId('help-market-direct-path')).toContainText('Direct commodity sleeve');
    await expect(page.getByTestId('help-market-equity-path')).toContainText('Equity, Company, then Outperform');
    const equityPath = page.getByTestId('help-market-equity-diagram');
    await expect(equityPath.locator('[data-help-path-node]')).toHaveCount(3);
    await expect(equityPath.locator('[data-help-path-connector]')).toHaveCount(3);
    await expect(equityPath.locator('[data-help-path-connector]').first()).toHaveCSS('height', '2px');
    await expect(equityPath).toContainText('Equity');
    await expect(equityPath).toContainText('Company');
    await expect(equityPath).toContainText('Outperform');
    await expect(equityPath).not.toContainText('Equity regime');
    await expect(equityPath).not.toContainText('Stock CDF');

    await page.goBack();
    await expect(page).toHaveURL(/#\/help$/);
    await expect(page.getByTestId('help-article-overview')).toBeVisible();
});

test('loads a Help section directly from its route', async ({ page }) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('alpha-edge-api-token', 'help-page-fixture-token');
        window.localStorage.removeItem('alpha-edge-active-tab');
    });

    await page.goto('/#/help/markets');

    await expect(page.getByTestId('help-tab')).toBeVisible();
    await expect(page.getByTestId('help-article-markets')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Help contents' }).getByRole('button', { name: 'Markets', exact: true })).toHaveAttribute('aria-current', 'page');
});
