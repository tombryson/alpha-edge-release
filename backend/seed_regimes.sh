#!/bin/bash

set -euo pipefail

# Seed the live regime signal layer only.
# Asset-class classification is now configured in the application, not via
# per-security regime-assignment endpoints.

API_BASE="${API_BASE:-http://127.0.0.1:8080/api}"

post_regime() {
  local ticker="$1"
  local signal="$2"

  curl -s -X POST "$API_BASE/webhook/regime" \
    -H "Content-Type: application/json" \
    -d "{\"ticker\":\"$ticker\",\"signal\":\"$signal\"}" | jq '.'
}

echo "========================================"
echo "Seeding Regime Signals"
echo "API: $API_BASE"
echo "========================================"

post_regime "SPY" "BUY"
post_regime "XAO" "BUY"
post_regime "GOLD" "BUY"
post_regime "SILVER" "BUY"
post_regime "COPPER" "BUY"
post_regime "MATERIALS" "BUY"
post_regime "ENERGY" "BUY"
post_regime "PHARMA" "BUY"
post_regime "HEALTHCARE" "BUY"
post_regime "FINANCIALS" "BUY"
post_regime "URANIUM" "BUY"
post_regime "IRON" "BUY"
post_regime "ALUMINIUM" "BUY"
post_regime "REE" "BUY"

echo
echo "========================================"
echo "Current Regime Status"
echo "========================================"
curl -s "$API_BASE/regimes/status" | jq '.'

echo
echo "Note:"
echo "- Security classification now comes from asset class."
echo "- There is no live /api/regime-assignments workflow anymore."
