import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import postcss from 'postcss';

const root = new URL('../', import.meta.url);
const output = new URL('public/brand/', root);
const base = new URL(process.env.BRAND_PREVIEW_URL || 'http://127.0.0.1:3312');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Use a local preview, not a private hosted portfolio.');
const css = postcss.parse(await readFile(new URL('app/globals.css', root), 'utf8'));
const selectors = ['.terminal-brand', '.terminal-brand-mark', '.terminal-brand-wordmark'];
const brandCSS = selectors.map(selector => {
    const rule = css.nodes.find(node => node.type === 'rule' && node.selector === selector);
    assert.ok(rule, `Missing brand rule: ${selector}`);
    return rule.toString();
}).join('\n');
const icon = await readFile(new URL('public/alpha-edge-header-icon.png', root));
const iconURL = `data:image/png;base64,${icon.toString('base64')}`;
const brand = (extra = '') => `<div class="terminal-brand ${extra}" aria-label="Alpha Edge"><img class="terminal-brand-mark" src="${iconURL}" alt="Alpha Edge" width="38" height="38"><span class="terminal-brand-wordmark">Alpha Edge</span></div>`;
const browser = await chromium.launch();
await mkdir(output, { recursive: true });

try {
    const app = await browser.newPage({ viewport: { width: 1920, height: 900 } });
    await app.route('**/*', route => {
        const url = new URL(route.request().url());
        return url.origin === base.origin ? route.continue() : route.abort();
    });
    await app.addInitScript(() => {
        localStorage.setItem('alpha-edge:welcome-guide:v1:demo', 'dismissed');
        localStorage.setItem('alpha-edge-shell-ui', JSON.stringify({ layout: { left: 'collapsed', right: 'collapsed' } }));
    });
    await app.goto(base.href, { waitUntil: 'domcontentloaded' });
    await app.locator('.terminal-brand-wordmark').waitFor({ state: 'visible' });
    await app.evaluate(() => document.fonts.ready);
    const font = await app.locator('.terminal-brand-wordmark').evaluate(el => getComputedStyle(el).fontFamily);
    const themes = {};
    for (const [name, theme] of [['dark', 'terminal-dark'], ['light', 'terminal-light-soft']]) {
        themes[name] = await app.evaluate(theme => {
            document.documentElement.dataset.theme = theme;
            document.documentElement.classList.toggle('light', theme.endsWith('light-soft'));
            const style = getComputedStyle(document.documentElement);
            return { foreground: style.getPropertyValue('--foreground').trim(), background: style.getPropertyValue('--background').trim() };
        }, theme);
    }
    const baseCSS = `* { box-sizing: border-box; } html { font-size: 16px; } body { margin: 0; font-family: ${font}; -webkit-font-smoothing: antialiased; }
${brandCSS}
.borderless { border-color: transparent; box-shadow: none; background: transparent; }
${Object.entries(themes).map(([name, theme]) => `.${name} { color-scheme: ${name}; --foreground: ${theme.foreground}; --background: ${theme.background}; color: var(--foreground); }`).join('\n')}`;
    const page = await browser.newPage({ viewport: { width: 900, height: 320 }, deviceScaleFactor: 8 });
    const dimensions = {};
    for (const name of Object.keys(themes)) {
        await page.setContent(`<!doctype html><html><head><style>${baseCSS} body { background: transparent; } .export { width: max-content; }</style></head><body class="${name}"><div class="export">${brand('borderless')}</div></body></html>`);
        await page.locator('img').evaluate(img => img.decode());
        const lockup = page.locator('.export');
        const bounds = await lockup.boundingBox();
        const pixels = await page.locator('.terminal-brand').evaluate(el => ({ border: getComputedStyle(el).borderColor, shadow: getComputedStyle(el).boxShadow }));
        assert.equal(pixels.border, 'rgba(0, 0, 0, 0)');
        assert.equal(pixels.shadow, 'none');
        const textColour = await page.locator('.terminal-brand-wordmark').evaluate(el => getComputedStyle(el).color);
        assert.equal(textColour, name === 'dark' ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)');
        dimensions[name] = { cssWidth: bounds.width, cssHeight: bounds.height, scale: 8 };
        await lockup.screenshot({ path: fileURLToPath(new URL(`alpha-edge-lockup-on-${name}.png`, output)), omitBackground: true });
        await page.addStyleTag({ content: '.export { background: var(--background); }' });
        await lockup.screenshot({ path: fileURLToPath(new URL(`alpha-edge-lockup-${name}.png`, output)) });
    }
    const sheet = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Alpha Edge brand assets</title><style>
${baseCSS}
body { background: #f6f7f8; color: #25282c; } main { max-width: 960px; margin: 0 auto; }
header, footer { padding: 24px 32px; } h1 { margin: 0; font-size: 24px; font-weight: 500; } p { margin: 8px 0 0; font-size: 13px; line-height: 1.6; }
.sample { background: var(--background); padding: 20px 32px; overflow: hidden; } .sample h2 { margin: 0; font-size: 12px; font-weight: 400; }
.display { display: flex; align-items: center; justify-content: center; height: 164px; } .display .terminal-brand { transform: scale(3); }
.chip { display: flex; align-items: center; gap: 24px; padding: 18px 32px; background: var(--background); } .chip > span { font-size: 12px; }
a { color: inherit; } nav { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 10px; font-size: 13px; }
@media (max-width: 540px) { .display .terminal-brand { transform: scale(2); } .chip { flex-wrap: wrap; } }
</style></head><body><main><header><h1>Alpha Edge</h1><p>Primary horizontal identity: monogram and wordmark. Exports omit the surrounding chip border and shadow.</p></header>
${Object.keys(themes).map(name => `<section class="sample ${name}"><h2>${name === 'dark' ? 'Dark' : 'Light'} background</h2><div class="display">${brand('borderless')}</div></section>`).join('\n')}
<section class="chip dark"><span>Application chip</span>${brand()}</section>
<footer><p>Transparent PNGs, rendered at 8x. The existing icon background and wordmark treatment are preserved.</p><nav>${Object.keys(themes).map(name => `<a href="alpha-edge-lockup-on-${name}.png">Transparent, for ${name} backgrounds</a>`).join('')}<a href="alpha-edge-brand-sheet.png">Preview sheet</a></nav></footer></main></body></html>`;
    await writeFile(new URL('index.html', output), sheet);
    const preview = await browser.newPage({ viewport: { width: 960, height: 800 }, deviceScaleFactor: 2 });
    await preview.setContent(sheet);
    await preview.locator('img').evaluateAll(images => Promise.all(images.map(img => img.decode())));
    await preview.screenshot({ path: fileURLToPath(new URL('alpha-edge-brand-sheet.png', output)), fullPage: true });
    console.log(JSON.stringify({ output: fileURLToPath(output), font, dimensions }, null, 2));
} finally {
    await browser.close();
}
