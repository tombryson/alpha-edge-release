async function mockBrowserAccess(page) {
    await page.addInitScript(() => {
        for (const mode of ['owner', 'legacy', 'demo']) {
            localStorage.setItem(`alpha-edge:welcome-guide:v1:${mode}`, 'dismissed');
        }
        localStorage.setItem('alpha-edge-api-token', 'isolated-browser-fixture');
    });
    await page.route('**/api/terminal/auth/session', route => route.fulfill({
        json: { authenticated: true, enrolled: true, csrf_token: 'isolated-browser-fixture' },
    }));
}

module.exports = { mockBrowserAccess };
