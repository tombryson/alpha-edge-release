# Alpha Edge Brand Assets

The primary identity is the existing AE monogram followed by **Alpha Edge**.
The application chip is a container for that identity, not part of the exported
logo. No new lettering or replacement symbol has been introduced.

## Files

- `alpha-edge-lockup-on-dark.png`: transparent, light wordmark for dark surfaces.
- `alpha-edge-lockup-on-light.png`: transparent, dark wordmark for light surfaces.
- `alpha-edge-lockup-dark.png`: border-free screenshot on the default dark surface.
- `alpha-edge-lockup-light.png`: border-free screenshot on the default light surface.
- `alpha-edge-brand-sheet.png`: preview of both treatments and the application chip.
- `index.html`: self-contained visual reference, also available at `/brand/index.html`.

The lockups are exported at 8x resolution. Use them proportionally; do not stretch
the icon and wordmark separately. Transparent means the surrounding canvas has no
background: the existing dark icon tile remains intentional. The horizontal stroke
through the wordmark is opaque and matches the corresponding theme background,
so choose the matching file. For other backgrounds, use the HTML/CSS identity and
set `--terminal-brand-surface` to that background before exporting.
These are raster exports, not vector masters.

## Source Of Truth

- Icon: `public/alpha-edge-header-icon.png`.
- Chip, icon geometry and wordmark: `.terminal-brand`, `.terminal-brand-mark` and
  `.terminal-brand-wordmark` in `app/globals.css`.
- Interface markup: `components/shell/terminal-unified-header.tsx`.

Desktop chip: 46px high, 38px icon, 4px gap, 18px/10px corner radii, subtle border
and inset shadow. The phone header keeps its existing compact icon-only treatment.
Exports retain the full wordmark and omit only the surrounding border and shadow.

Wordmark: 14px, weight 400, uppercase, with a 1.2px solid horizontal strike-through.
Text is pure white in dark mode and pure black in light mode, following the active
colour scheme. The strike-through uses the header's exact surface colour, falling
back to the theme background in standalone exports. The lettering has no added
text stroke.

## Regenerate

With the local demo preview running:

```sh
npm run brand:export
```

For another local port, set `BRAND_PREVIEW_URL`. The script reads the actual brand
CSS and preview font/theme values, uses the original full-resolution icon, and
renders the assets with Playwright. It makes no API writes or external requests.
Regenerate after changing the icon or wordmark, then inspect the preview sheet.
