import { expect, test } from '@playwright/test';

test('shows advisory listing reviews from Analysis without changing a security', async ({ page }) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('alpha-edge-api-token', 'local-test-token');
    });
    await page.route('**/api/analysis/listing-reviews', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify([
                {
                    id: 1,
                    security_id: 101,
                    analysis_id: 42,
                    name: 'Identity Test Limited',
                    ticker: 'ASX:IDT',
                    review_type: 'NAME_CHANGE_CANDIDATE',
                    provider: 'YAHOO',
                    current_name: 'Identity Test Limited',
                    observed_name: 'Identity Test Holdings Limited',
                    current_ticker: 'ASX:IDT',
                    observed_ticker: 'IDT.AX',
                    first_seen_at: '2026-08-19T00:00:00Z',
                    last_seen_at: '2026-08-19T00:00:00Z',
                    seen_count: 1,
                },
            ]),
        });
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'ANALYSIS', exact: true }).click();

    const reviewButton = page.getByRole('button', { name: 'Open 1 listing review', exact: true });
    await expect(reviewButton).toBeVisible();
    await reviewButton.click();

    const dialog = page.getByRole('dialog', { name: 'LISTING REVIEWS', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Identity Test Limited');
    await expect(dialog).toContainText('Name differs');
    await expect(dialog).toContainText('Identity Test Holdings Limited');
    await expect(dialog).toContainText('do not rename securities');

    await dialog.getByRole('button', { name: 'Close listing reviews', exact: true }).click();
    await expect(dialog).toBeHidden();
});
