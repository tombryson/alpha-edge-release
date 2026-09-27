# Asset-Class Visual Identity

Palette version: **1**.

## Contract

A class has one stable visual identity across Alpha Edge. Gold Miners must not
be purple in a pie, gold in the Alert Stack and a different colour each time
History reorders its series. Identity belongs to the **asset-class code**, not
the display name, allocation percentage, row order, performance or current gate.

The user selected intuitive default class colours. Main examples:

| Class | Colour | Hex |
| --- | --- | --- |
| Gold Miners | Gold | `#d4a72c` |
| Physical Gold | Deeper gold | `#b8871b` |
| Silver Miners | Silver | `#c0c7d2` |
| Physical Silver | Blue-grey silver | `#8f9fb5` |
| Copper Miners | Copper | `#b87333` |
| Uranium Miners | Lime | `#84cc16` |
| Rare Earths & Critical Minerals | Teal | `#14b8a6` |
| Energy Producers | Coral | `#fb5b62` |
| Pharma & Biotech | Cyan | `#06b6d4` |
| Cash / Reserve | Slate grey | `#64748b` |
| Other | Neutral grey | `#77818c` |

Related physical and producer classes have related, not identical, colours.
Non-material sectors use stable differentiated accents; there is no universal
natural colour for every industry. Labels remain necessary, particularly for
colour-vision differences and charts containing many classes.

## Ownership

- `lib/asset-class-identity.ts` is the sole Terminal default class-colour registry.
  `assetClassColor(code)` returns a CSS variable with a canonical hex fallback;
  `assetClassDefaultColor(code)` returns the default hex for the editor/tests.
  `components/asset-class-palette.tsx` applies saved overrides on `:root`, so
  memoised DOM/SVG/Recharts views update without rebuilding data or remounting.
  `assetClassGroupColor`
  owns parent-group accents separately; parents never borrow the first child's
  colour.
- `lib/portfolio-composition-colors.ts` is a compatibility adapter, not a second
  palette. Its old index argument is ignored. The stock-table visual adapter
  also delegates to the same registry.
- `asset_classes` still owns the class vocabulary and assignments. This
  presentation registry must never populate selectors, create asset classes,
  combine budgets or replace database classification.
- The legacy `asset_class_config.alert_color` field remains in the database
  and API, but no longer overrides Terminal class identity. Alert labels,
  ordering and risk settings continue to work. No schema migration or saved
  colour deletion is involved.

Pass the canonical code from the data, never a translated or user-edited label.
Presentation aliases support legacy `GOLD`, `SILVER`, `COPPER`, `REE`, compact
codes and `THEME:` prefixes. They only select colours; they are not a financial
normalizer and must not be used to migrate allocation data.

Unregistered custom codes receive a deterministic colour from a fixed fallback
palette using FNV-1a. Sorting, filtering and adding other classes cannot change
it. Different custom codes can share a fallback colour; users can choose an
override for each. Add a reviewed explicit entry when a new default identity
is needed. A missing code is neutral
Unassigned, not a guessed class. Other is an aggregate, not cash.

## User Customisation

On the Portfolio shape page, click the colour square in the **Asset class**
column to open the same 30-colour modal directly. Its hover/focus outline and
expanded hit area do not change the row layout. The colour control and modal
do not expand/collapse holdings; clicking the rest of the row still does.
The source database class code is preserved for colour writes, including custom
class underscores, rather than using the compact code used for row comparisons.

Open the header palette button, then **Asset class colours**. On mobile the
palette button is inside Navigation. The searchable list comes from
`GET /api/asset-classes`, restricted to active target-weight classes, including
custom classes and Cash/Reserve. It is not populated from the colour registry.

Click a class swatch to open a compact modal with **30 named preset colours**,
arranged in a 6-column grid (5 columns on very narrow phones). The choices are
defined in `lib/asset-class-colour-presets.ts`: warm colours and metals, greens,
blues, purples/pinks and neutrals. The native colour picker and editable hex field
are removed. Each swatch has an accessible name, hover title and selected check;
keyboard arrow navigation uses a radio group. Single-click selects a draft;
**Save** or double-clicking a swatch saves and closes the selector. Double-clicking
the already-saved colour closes it without a redundant write. Failed saves keep
the selector open for retry. **Cancel** leaves the saved colour untouched.
**Reset** restores that class's default. The editor does not expose parent-group
or synthetic Other colours as if they were investable classes.

This is an editor-only constraint, not a change to saved colour identity.
Previously saved hex colours and default colours outside the 30 choices remain
valid. They are shown as the current colour without selecting an unrelated
preset. They change only when the user saves a preset or explicitly resets.
The API continues accepting valid six-digit hex values for compatibility.

Persistence uses the existing settings table and authenticated settings API:

```json
{ "asset_class_colour:GOLD_MINERS": "#d4a72c" }
```

`POST /api/settings` accepts one such key per editor save. An empty value resets
the class; the key can remain stored with an empty value. The backend validates
the class code against `asset_classes`, requires `#RRGGBB` or empty, and normalises
the hex value to lowercase. Invalid colour updates return 400 before any settings
are written. Database errors return 500. Existing settings are not replaced.
No new table or migration is required. `asset_class_config.alert_color` is not
modified and cannot compete with these overrides.

These are **Terminal-wide settings in the selected backend**, shared by browsers
using that backend, not per-account preferences. The initial authenticated load,
window focus/visibility and cross-tab save notification re-read saved settings.
Only a change notification is stored in localStorage; it is not another palette.
Each successful response updates the current page immediately. There is no
colour polling, financial recomputation or approval workflow. Concurrent changes
to separate class keys do not overwrite one another; the last save to the same
class wins.

Failed saves retain the previously applied colour and keep the editor open with
an error. Initial load failure disables edits until Retry succeeds. A later
refresh failure retains the last loaded palette. Responses started before a save
are ignored so they cannot undo the saved choice. Defaults remain available when
there is no saved override. Colours are not available offline after a fresh reload.

Saved choices apply to all current and historical appearances, in every theme;
history retains its original weights, not an old colour snapshot. Labels and
neutral borders remain important: arbitrary user colours are not automatically
contrast-corrected or recoloured by the application.

## Visual Rules

1. Use the exact base colour for class squares, identity rails, chart strokes
   and primary shape segments. Do not remap hue, saturation or lightness per page.
2. Muted target rings, chart-area fills and hover surfaces may use opacity or
   a mix with theme surfaces, retaining the base colour. Target/current is
   distinguished by geometry, outline or opacity, not another class palette.
3. Light mode keeps the same identity colour. Neutrals, separators and text follow
   the theme. Small swatches need separation from their background; colour is
   not a substitute for readable foreground text.
4. Buy/Sell, Bull/Bear, missing connections, Q3/Q4, performance returns, target
   differences and ETF funding progress keep their semantic colours. In Markets,
   only the class-name rail changes; stage nodes and Next Step remain state-driven.
5. Existing geometry, row heights, typography and navigation stay unchanged.
   Headings remain neutral. Positions class icons default to neutral, with a
   per-row opt-in to the canonical colour. Their popup exposes the shared class-colour editor. Row backgrounds,
   borders, numeric values and security styling remain unchanged.
   See [the style contract](../development/TERMINAL_STYLE_STANDARD.md#positions-row-appearance).

## Adoption

- Portfolio summary pie and comparison dial, including their class lists.
- Portfolio current/target bars, overview, timeline, historical comparison and
  pinwheel class identities; Positions shape visualisations and hover tints.
- Right sidebar Shape references and their historical selections.
- History asset-class weight series and approved-shape previews. Series colour
  resolves the source class code rather than a series-position palette entry.
- System allocation/position groups; Markets class-name rails; Alert Stack group
  rails/tints. Alert expansion preferences now use stable class keys, with a
  fallback for saved legacy label-and-colour keys.
- The legacy Exposure rendering path uses the same registry too.

Neutral Analysis/Positions headings remain neutral. ETF role colours, funding
bars and connection bars do not encode class and are not recoloured. Financial
normalizers, historical percentages, class assignments, approved shapes,
allocation calculations, signals and trading permissions are unchanged.

## Reproducibility

Default palette version 1 is code-versioned. Defaults plus saved overrides apply
to current and historical records alike. Historical charts remain comparable to today's class legend.
We do not store a colour on each approved shape. Reproducing the exact appearance
of an old screenshot also requires its frontend/palette version and saved
`asset_class_colour:*` settings at that time. Back up the settings table with the
rest of the database.

To change a shipped default colour or fallback algorithm: review it as a
cross-application identity migration, increment `ASSET_CLASS_COLOUR_VERSION`,
update the examples/tests, and verify both themes. Never introduce a local map
to fix one chart. Renaming a display label should not change its class code.
User overrides do not change the shipped palette version.

## Icons

Default presentation retains the existing squares and rails. Small generated illustrations
are not introduced into dense tables: at that size they can be less legible than
a solid swatch. Optional class symbols use the same identity registry. Icons must be
additive to labels and colours, not replacements for them or for signal nodes.

Each Positions class row has its own icon palette, opened from the arrow or
icon beside its name. It offers fixed 16px Lucide icons, including an automatic
class symbol with a Global fallback. There is no global icon setting or optional
border editor. The default is a 10px triangle indicating the expanded/collapsed
state. A chosen icon replaces the triangle in the same fixed slot. Clicking the
name or symbol toggles expansion. Hovering over the symbol for 800ms changes
it to a pencil; clicking then opens the palette. Pointer exit restores disclosure
behaviour. An 800ms touch hold or the Arrow Down keyboard shortcut also opens
the palette. Default arrow restores the triangle. Symbols default
to the theme's neutral foreground. Two previews of the selected
symbol let the user choose Neutral or Class colour, without changing the palette.
This per-class browser preference persists independently of icon selection.
The colour square in this popup opens
the existing shared 30-colour editor: choices persist through the same settings
API used by Theme and Portfolio, and apply across the application. Icons themselves
remain per-class browser preferences; colour changes do not reset them. Photo uploads and background
images remain outside this version.

The palette has 72 symbols with explicit automatic mappings for every entry in
`ASSET_CLASS_IDENTITIES`. Gold/silver, lithium/uranium, data centres/semiconductors
and healthcare/pharma are no longer collapsed into broad regex-based symbols.
Aliases resolve through the same presentation registry as colours. Unknown
custom classes use a Global icon until the user makes a per-class choice.

## Verification

`npm run test:asset-class-colours` checks catalogue coverage, aliases, deterministic
fallbacks, distinct physical/producer identities, history/dial parity, preserved
weights, override parsing, reset and safe CSS generation. Existing comparison, dial and
history-marker model tests remain part of the regression set.

`node --test tests/asset-class-colours.browser.test.cjs` checks rendered cross-view
colour agreement and dark/light behaviour with isolated API fixtures. Existing
Context Panel and History preview browser suites cover mobile layout, dock
position, chart controls and interactions. These tests do not write UAT data.

`node --test tests/asset-class-colour-editor.browser.test.cjs` exercises draft,
Save, Cancel, Reset, reload persistence, external-change refresh, failed requests,
custom classes and mobile dark/light layout with mocked API writes. Run the Go
`TestClassColour` tests for actual settings persistence, validation, independent
class updates and failure handling against an isolated SQLite database. No test
edits UAT or production settings. See [Testing](../development/TESTING.md) for commands.

Initial 10 September verification: 43 identity/store/comparison/dial/history-marker model tests,
25 browser cases across colour, editor, Context Panel, History preview and Alert
Stack suites, the isolated Go colour-settings tests, TypeScript no-emit and
`git diff --check` passed. A History navigation timeout under concurrent test
load passed on an isolated rerun. The docs audit passed 33 checks with the
existing Full Q1 wording warning. Go tests required `-vet=off` for the existing
module-version mismatch; ESLint could not run because this repository has no
`eslint.config.*`. Desktop and mobile dark/light editor screenshots were checked.

11 September preset-grid refinement: 12 colour/identity/store tests and seven
colour/editor browser cases passed, along with TypeScript and diff checks. The
docs audit retained its existing Full Q1 warning. Checks include exactly 30
unique swatches, keyboard selection, explicit Save, retained off-palette colours,
6-by-5 desktop layout and narrow/short mobile screens in dark/light themes.
No backend or financial logic changed in this refinement.
