import { assetClassColourKey, assetClassColorProperty } from './asset-class-identity';

export const CLASS_COLOUR_SETTING_PREFIX = 'asset_class_colour:';
export type AssetClassColourOverrides = Record<string, string>;

export function normaliseClassColour(value: unknown): string | null {
    return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value.trim())
        ? value.trim().toLowerCase() : null;
}

export function classColourOverrides(settings: Record<string, unknown>): AssetClassColourOverrides {
    const overrides: AssetClassColourOverrides = {};
    // Exact canonical keys win over a retained legacy alias, regardless of response order.
    const entries = Object.entries(settings).filter(([key]) => key.startsWith(CLASS_COLOUR_SETTING_PREFIX));
    entries.sort(([a], [b]) => a.localeCompare(b));
    for (const [key, value] of entries) {
        const code = key.slice(CLASS_COLOUR_SETTING_PREFIX.length);
        const colour = normaliseClassColour(value);
        if (code && colour) overrides[assetClassColourKey(code)] = colour;
    }
    for (const [key, value] of entries) {
        const code = key.slice(CLASS_COLOUR_SETTING_PREFIX.length);
        if (code !== assetClassColourKey(code)) continue;
        const colour = normaliseClassColour(value);
        if (colour) overrides[code] = colour;
        else if (value === '') delete overrides[code];
    }
    return overrides;
}

export function classColourStyle(overrides: AssetClassColourOverrides): string {
    return `:root { ${Object.entries(overrides).flatMap(([code, value]) => {
        const colour = normaliseClassColour(value);
        return colour ? [`${assetClassColorProperty(code)}: ${colour};`] : [];
    }).join(' ')} }`;
}
