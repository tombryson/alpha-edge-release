export default {
  "note": "Synthetic layout fixture. Local preview only; not live market evidence.",
  "themes": [
    {
      "code": "GOLD",
      "display_name": "Gold",
      "market_group": "Precious metals",
      "status": "PARTIAL",
      "confirmation_count": 2,
      "confirmation_total": 3,
      "strategic_floor": {
        "asset_class_code": "PHYSICAL_GOLD",
        "target_value": 0,
        "actual_value": 0
      },
      "direct_expression": {
        "status": "SIGNAL_ONLY",
        "existing_position_treatment": "CLASS_DEFINED"
      },
      "direct_sleeve": {
        "asset_class_code": "PHYSICAL_GOLD",
        "target_value": 0,
        "invested_value": 0,
        "sleeve_cash_value": 0,
        "capital_value": 0,
        "budget_approved": true
      },
      "equity_sleeve": {
        "asset_class_code": "GOLD_MINERS",
        "target_value": 10000,
        "invested_value": 2000,
        "sleeve_cash_value": 0,
        "capital_value": 2000,
        "budget_approved": true
      },
      "tactical": {
        "asset_class_code": "GOLD_MINERS",
        "maximum_value": 10000,
        "permitted_value": 3333.33,
        "actual_value": 2000,
        "available_value": 1333.33,
        "budget_approved": true
      },
      "reviews": [],
      "stages": [
        {
          "key": "COMMODITY",
          "order": 1,
          "scope": "THEME",
          "label": "Gold price",
          "status": "CONFIRMED",
          "signal": "BUY",
          "return_60d_pct": 4.8,
          "performance_as_of": "2026-09-21T00:00:00Z",
          "source": {
            "kind": "UNDERLYING_PRICE",
            "symbol": "AMEX:GLD",
            "label": "Gold price"
          }
        },
        {
          "key": "EQUITY_RELATIVE",
          "order": 2,
          "scope": "THEME",
          "label": "Gold equities / gold",
          "status": "CONFIRMED",
          "signal": "BUY",
          "source": {
            "kind": "RELATIVE_STRENGTH",
            "numerator": "AMEX:GDX",
            "denominator": "AMEX:GLD",
            "label": "Gold equities / gold"
          }
        },
        {
          "key": "SECURITY_TREND",
          "order": 3,
          "scope": "SECURITY",
          "label": "Company trend",
          "status": "PARTIAL",
          "eligible_security_count": 3,
          "blocked_security_count": 1,
          "eligible_security_total": 4,
          "source": {
            "kind": "SECURITY_TREND",
            "symbol": "SECURITY",
            "label": "Company trend"
          }
        },
        {
          "key": "SECURITY_OUTPERFORM",
          "order": 4,
          "scope": "SECURITY",
          "label": "Outperform",
          "status": "PARTIAL",
          "eligible_security_count": 2,
          "blocked_security_count": 2,
          "eligible_security_total": 4,
          "source": {
            "kind": "RELATIVE_STRENGTH",
            "numerator": "SECURITY",
            "denominator": "AMEX:GDX",
            "label": "Company / core fund"
          }
        }
      ],
      "eligible_securities": [
        {
          "security_id": 1,
          "ticker": "ASX:NST",
          "name": "Northern Star Resources",
          "include_in_sizing": true,
          "stage_states": {
            "SECURITY_TREND": "CONFIRMED",
            "SECURITY_OUTPERFORM": "CONFIRMED"
          },
          "latest_events": {}
        },
        {
          "security_id": 2,
          "ticker": "ASX:EVN",
          "name": "Evolution Mining",
          "include_in_sizing": true,
          "stage_states": {
            "SECURITY_TREND": "CONFIRMED",
            "SECURITY_OUTPERFORM": "CONFIRMED"
          },
          "latest_events": {}
        },
        {
          "security_id": 3,
          "ticker": "ASX:PRU",
          "name": "Perseus Mining",
          "include_in_sizing": true,
          "stage_states": {
            "SECURITY_TREND": "CONFIRMED",
            "SECURITY_OUTPERFORM": "BLOCKED"
          },
          "latest_events": {}
        },
        {
          "security_id": 4,
          "ticker": "ASX:GMD",
          "name": "Genesis Minerals",
          "include_in_sizing": true,
          "stage_states": {
            "SECURITY_TREND": "BLOCKED",
            "SECURITY_OUTPERFORM": "BLOCKED"
          },
          "latest_events": {}
        }
      ]
    }
  ]
}
