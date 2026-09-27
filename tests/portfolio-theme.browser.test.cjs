const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { mockContextPanel } = require('./fixtures/context-panel.cjs');
const base = process.env.CONTEXT_PANEL_BASE_URL || 'http://127.0.0.1:3312';
const themes = ['terminal-dark', 'terminal-light-soft', ...[1, 2, 3, 4].flatMap(n => [`theme${n}-dark`, `theme${n}-light`])];

async function appearance(locator) {
    return locator.evaluate(el => {
        const style = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d');
        const rgb = value => {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = value;
            ctx.fillRect(0, 0, 1, 1);
            return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
        };
        let background = style.backgroundColor;
        for (let parent = el.parentElement; background === 'rgba(0, 0, 0, 0)' && parent; parent = parent.parentElement) {
            background = getComputedStyle(parent).backgroundColor;
        }
        return {
            color: rgb(style.color), background: rgb(background), border: rgb(style.borderTopColor),
            transition: style.transitionProperty, duration: style.transitionDuration,
            box: { x: box.x, y: box.y, width: box.width, height: box.height },
        };
    });
}

function contrast(a, b) {
    const luminance = rgb => rgb.map(x => x / 255).map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4).reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0);
    const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (values[0] + 0.05) / (values[1] + 0.05);
}

for (const status of ['failed', 'running', 'succeeded']) {
    test(`Portfolio ${status} state and footer follow every theme without layout changes`, { timeout: 90000 }, async t => {
        const browser = await chromium.launch();
        t.after(() => browser.close());
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const fixture = await mockContextPanel(page);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        t.after(() => { assert.deepEqual(errors, []); assert.deepEqual(fixture.writes, []); });
        const job = { job_id: 'theme-fixture', status, progress_pct: 40, stage_message: 'Reviewing sources' };
        const submissions = [];
        await page.route('**/api/council/jobs**', route => {
            if (route.request().method() === 'POST') {
                submissions.push(route.request().postDataJSON());
                return status === 'failed'
                    ? route.fulfill({ status: 400, json: { detail: 'Council rejected the submission.', submission_status: 'not_submitted' } })
                    : route.fulfill({ status: 202, json: { ...job, status: 'queued' } });
            }
            return route.fulfill({ json: route.request().url().endsWith('/result')
                ? { job, asset_class_targets: [{ asset_class: 'GOLD_MINERS', target_pct: 100 }] }
                : job });
        });
        await page.goto(`${base}/#/portfolio`);
        const launch = page.getByRole('button', { name: 'Run portfolio analysis', exact: true });
        await expect(launch).toBeEnabled();
        await launch.click();
        const dialog = page.getByRole('dialog', { name: 'Portfolio analysis', exact: true });
        await dialog.getByRole('button', { name: 'Start analysis', exact: true }).click();
        if (status === 'failed') {
            await expect(dialog.getByRole('alert')).toContainText('Council rejected the submission.');
            await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        }
        await expect(dialog).toHaveCount(0);
        assert.equal(submissions.length, 1);
        const banner = page.getByTestId('portfolio-memo-status');
        const title = banner.getByText(`Portfolio analysis ${status === 'succeeded' ? 'ready' : status}`, { exact: true });
        const newTarget = page.getByRole('button', { name: 'New portfolio target', exact: true });
        const run = page.getByRole('button', { name: status === 'running' ? 'Analysis running' : 'Run portfolio analysis', exact: true });
        await expect(title).toBeVisible();
        await expect(newTarget).toBeVisible();
        if (status === 'running') await expect(run).toBeDisabled();
        else await expect(run).toBeEnabled();
        const elements = { banner, title, newTarget, run, footer: newTarget.locator('..') };
        if (status === 'failed') elements.detail = banner.getByText('Council rejected the submission.', { exact: true });
        if (status === 'succeeded') elements.review = banner.getByRole('button', { name: 'Review', exact: true });
        let baseline;
        for (const theme of themes) {
            await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
            const current = {};
            for (const [name, element] of Object.entries(elements)) {
                current[name] = await appearance(element);
                const value = current[name];
                assert.ok(value.duration === '0s' || value.transition === 'width', `${theme} ${name}: theme colours animate`);
                if (!['banner', 'footer'].includes(name)) assert.ok(contrast(value.color, value.background) >= 4.5, `${theme} ${name}: contrast ${contrast(value.color, value.background).toFixed(2)}`);
                if (baseline) {
                    assert.deepEqual(value.box, baseline[name].box, `${theme} ${name}: layout changed`);
                    if (theme === 'terminal-light-soft') {
                        if (!['banner', 'footer'].includes(name)) assert.notDeepEqual(value.color, baseline[name].color, `${name}: text did not change`);
                        assert.notDeepEqual(value.background, baseline[name].background, `${name}: background did not change`);
                    }
                }
            }
            baseline ??= current;
            if (status === 'failed' && theme.startsWith('terminal-')) await page.screenshot({ path: `/tmp/portfolio-theme-${theme}.png` });
        }
    });
}
