#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:8081/api}"
API_TOKEN="${UAT_API_TOKEN:-${API_TOKEN:-}}"
AUTH_ARGS=()
if [ -n "$API_TOKEN" ]; then AUTH_ARGS=(-H "Authorization: Bearer $API_TOKEN"); fi

post_q1() {
  local ticker="$1"
  local pct="$2"

  curl -sS ${AUTH_ARGS[@]+"${AUTH_ARGS[@]}"} -X POST "$API_BASE_URL/webhook/regime" \
    -H 'Content-Type: application/json' \
    -d "{\"ticker\":\"$ticker\",\"signal\":\"update\",\"target_equity_pct\":$pct,\"script\":\"regime_position_sizing\"}"
  echo
}

echo "== Baseline 100 / 100 =="
post_q1 "SPY" 100
post_q1 "XAO" 100

echo "== Drop to effective 50 =="
post_q1 "SPY" 50
post_q1 "XAO" 100

echo "== Persist at 50 =="
post_q1 "SPY" 50

echo "== Drop to effective 35 =="
post_q1 "SPY" 35

echo "== Improve to effective 50 =="
post_q1 "SPY" 50

echo "== Overlay summary =="
curl -sS ${AUTH_ARGS[@]+"${AUTH_ARGS[@]}"} "$API_BASE_URL/portfolio-overlay-summary"
echo
