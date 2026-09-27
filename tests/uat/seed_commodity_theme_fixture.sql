-- UAT-only visual fixture for the commodity-theme inspector.
-- This does not alter holdings, portfolio mix snapshots, analysis, or live
-- confirmation events. It replaces only its namespaced mock evidence.

BEGIN IMMEDIATE;

DELETE FROM commodity_theme_events
WHERE event_key GLOB 'uat-fixture:commodity-theme:*';

INSERT INTO commodity_theme_events (
    event_key,
    theme_code,
    stage_key,
    scope,
    security_id,
    security_ticker,
    signal,
    script,
    signal_version,
    source_json,
    timeframe,
    bar_closed_at,
    close,
    raw_payload_json
) VALUES
    (
        'uat-fixture:commodity-theme:gold:commodity',
        'GOLD',
        'COMMODITY',
        'THEME',
        NULL,
        '',
        'BUY',
        'ctf',
        'uat-fixture-v1',
        '{"kind":"UNDERLYING_PRICE","symbol":"AMEX:GLD","label":"Gold price"}',
        '1D',
        CURRENT_TIMESTAMP,
        2385.12,
        '{"fixture":"uat-commodity-theme","description":"Gold price confirmed"}'
    ),
    (
        'uat-fixture:commodity-theme:gold:equity-relative',
        'GOLD',
        'EQUITY_RELATIVE',
        'THEME',
        NULL,
        '',
        'BUY',
        'ctf',
        'uat-fixture-v1',
        '{"kind":"RELATIVE_STRENGTH","numerator":"AMEX:GDX","denominator":"AMEX:GLD","label":"Gold equities / gold"}',
        '1D',
        CURRENT_TIMESTAMP,
        1.41,
        '{"fixture":"uat-commodity-theme","description":"Gold miners confirmed"}'
    ),
    (
        'uat-fixture:commodity-theme:silver:commodity',
        'SILVER',
        'COMMODITY',
        'THEME',
        NULL,
        '',
        'BUY',
        'ctf',
        'uat-fixture-v1',
        '{"kind":"UNDERLYING_PRICE","symbol":"TVC:SILVER","label":"Silver price"}',
        '1D',
        CURRENT_TIMESTAMP,
        48.18,
        '{"fixture":"uat-commodity-theme","description":"Silver price confirmed"}'
    ),
    (
        'uat-fixture:commodity-theme:silver:equity-relative',
        'SILVER',
        'EQUITY_RELATIVE',
        'THEME',
        NULL,
        '',
        'BUY',
        'ctf',
        'uat-fixture-v1',
        '{"kind":"RELATIVE_STRENGTH","numerator":"AMEX:SILJ","denominator":"AMEX:SLV","label":"SILJ / SLV"}',
        '1D',
        CURRENT_TIMESTAMP,
        1.18,
        '{"fixture":"uat-commodity-theme","description":"Silver miners confirmed"}'
    ),
    (
        'uat-fixture:commodity-theme:copper:commodity',
        'COPPER',
        'COMMODITY',
        'THEME',
        NULL,
        '',
        'BUY',
        'ctf',
        'uat-fixture-v1',
        '{"kind":"UNDERLYING_PRICE","symbol":"COMEX:HG1!","label":"Copper price"}',
        '1D',
        CURRENT_TIMESTAMP,
        4.72,
        '{"fixture":"uat-commodity-theme","description":"Copper price confirmed"}'
    ),
    (
        'uat-fixture:commodity-theme:copper:equity-relative',
        'COPPER',
        'EQUITY_RELATIVE',
        'THEME',
        NULL,
        '',
        'SELL',
        'ctf',
        'uat-fixture-v1',
        '{"kind":"RELATIVE_STRENGTH","numerator":"AMEX:COPX","denominator":"AMEX:CPER","label":"COPX / copper"}',
        '1D',
        CURRENT_TIMESTAMP,
        0.86,
        '{"fixture":"uat-commodity-theme","description":"Copper miners blocked"}'
    ),
    (
        'uat-fixture:commodity-theme:uranium:commodity',
        'URANIUM',
        'COMMODITY',
        'THEME',
        NULL,
        '',
        'SELL',
        'ctf',
        'uat-fixture-v1',
        '{"kind":"UNDERLYING_PRICE","symbol":"OTC:SRUUF","label":"Uranium price"}',
        '1D',
        CURRENT_TIMESTAMP,
        78.50,
        '{"fixture":"uat-commodity-theme","description":"Uranium price blocked"}'
    ),
    (
        'uat-fixture:commodity-theme:oil-producers:commodity',
        'OIL_PRODUCERS',
        'COMMODITY',
        'THEME',
        NULL,
        '',
        'BUY',
        'ctf',
        'uat-fixture-v1',
        '{"kind":"UNDERLYING_PRICE","symbol":"NYMEX:CL1!","label":"WTI crude"}',
        '1D',
        CURRENT_TIMESTAMP,
        74.21,
        '{"fixture":"uat-commodity-theme","description":"WTI crude confirmed"}'
    ),
    (
        'uat-fixture:commodity-theme:lithium:commodity',
        'LITHIUM',
        'COMMODITY',
        'THEME',
        NULL,
        '',
        'BUY',
        'ctf',
        'uat-fixture-v1',
        '{"kind":"UNDERLYING_PRICE","symbol":"AMEX:EVMT","label":"Battery metals"}',
        '1D',
        CURRENT_TIMESTAMP,
        42.13,
        '{"fixture":"uat-commodity-theme","description":"Battery metals confirmed"}'
    ),
    (
        'uat-fixture:commodity-theme:lithium:equity-relative',
        'LITHIUM',
        'EQUITY_RELATIVE',
        'THEME',
        NULL,
        '',
        'BUY',
        'ctf',
        'uat-fixture-v1',
        '{"kind":"RELATIVE_STRENGTH","numerator":"AMEX:LITP","denominator":"AMEX:EVMT","label":"LITP / battery metals"}',
        '1D',
        CURRENT_TIMESTAMP,
        1.09,
        '{"fixture":"uat-commodity-theme","description":"Lithium miners confirmed"}'
    ),
    (
        'uat-fixture:commodity-theme:natural-gas:commodity-connect',
        'NATURAL_GAS',
        'COMMODITY',
        'THEME',
        NULL,
        '',
        'CONNECT',
        'ctf',
        'uat-fixture-v1',
        '{"kind":"UNDERLYING_PRICE","symbol":"NYMEX:NG1!","label":"Natural gas"}',
        '1D',
        CURRENT_TIMESTAMP,
        3.12,
        '{"fixture":"uat-commodity-theme","description":"Natural gas source connected"}'
    );

-- AAR clears the security trend gate, while AGD provides a visible blocked
-- comparison. The final leadership gate is explicitly blocked for AAR, which
-- leaves Gold at 3/4 rather than presenting a misleading completed path.
INSERT INTO commodity_theme_events (
    event_key,
    theme_code,
    stage_key,
    scope,
    security_id,
    security_ticker,
    signal,
    script,
    signal_version,
    source_json,
    timeframe,
    bar_closed_at,
    close,
    raw_payload_json
)
SELECT
    'uat-fixture:commodity-theme:gold:aar:security-trend',
    'GOLD',
    'SECURITY_TREND',
    'SECURITY',
    sa.security_id,
    si.exchange_prefix || si.ticker,
    'BUY',
    'cdf',
    'uat-fixture-v1',
    '{"kind":"SECURITY_TREND","symbol":"' || si.exchange_prefix || si.ticker || '","label":"Security trend"}',
    '1D',
    CURRENT_TIMESTAMP,
    0.31,
    '{"fixture":"uat-commodity-theme","description":"Qualified miner"}'
FROM stock_analysis sa
JOIN security_identities si ON si.id = sa.security_id
WHERE sa.ticker = 'ASX:AAR'
  AND UPPER(sa.primary_asset_class) = 'GOLD_MINERS'
  AND UPPER(COALESCE(sa.security_type, 'STOCK')) != 'ETF';

INSERT INTO commodity_theme_events (
    event_key,
    theme_code,
    stage_key,
    scope,
    security_id,
    security_ticker,
    signal,
    script,
    signal_version,
    source_json,
    timeframe,
    bar_closed_at,
    close,
    raw_payload_json
)
SELECT
    'uat-fixture:commodity-theme:gold:agd:security-trend',
    'GOLD',
    'SECURITY_TREND',
    'SECURITY',
    sa.security_id,
    si.exchange_prefix || si.ticker,
    'SELL',
    'cdf',
    'uat-fixture-v1',
    '{"kind":"SECURITY_TREND","symbol":"' || si.exchange_prefix || si.ticker || '","label":"Security trend"}',
    '1D',
    CURRENT_TIMESTAMP,
    0.06,
    '{"fixture":"uat-commodity-theme","description":"Blocked comparison miner"}'
FROM stock_analysis sa
JOIN security_identities si ON si.id = sa.security_id
WHERE sa.ticker = 'ASX:AGD'
  AND UPPER(sa.primary_asset_class) = 'GOLD_MINERS'
  AND UPPER(COALESCE(sa.security_type, 'STOCK')) != 'ETF';

INSERT INTO commodity_theme_events (
    event_key,
    theme_code,
    stage_key,
    scope,
    security_id,
    security_ticker,
    signal,
    script,
    signal_version,
    source_json,
    timeframe,
    bar_closed_at,
    close,
    raw_payload_json
)
SELECT
    'uat-fixture:commodity-theme:gold:aar:security-leadership',
    'GOLD',
    'SECURITY_LEADERSHIP',
    'SECURITY',
    sa.security_id,
    si.exchange_prefix || si.ticker,
    'SELL',
    'tms',
    'uat-fixture-v1',
    '{"kind":"RELATIVE_STRENGTH","numerator":"' || si.exchange_prefix || si.ticker || '","denominator":"AMEX:GDX","label":"Security / GDX"}',
    '1D',
    CURRENT_TIMESTAMP,
    0.82,
    '{"fixture":"uat-commodity-theme","description":"Breakout gate blocked"}'
FROM stock_analysis sa
JOIN security_identities si ON si.id = sa.security_id
WHERE sa.ticker = 'ASX:AAR'
  AND UPPER(sa.primary_asset_class) = 'GOLD_MINERS'
  AND UPPER(COALESCE(sa.security_type, 'STOCK')) != 'ETF';

COMMIT;
