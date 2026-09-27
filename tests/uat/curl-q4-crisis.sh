#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:8081/api}"
API_TOKEN="${UAT_API_TOKEN:-${API_TOKEN:-}}"
AUTH_ARGS=()
if [ -n "$API_TOKEN" ]; then AUTH_ARGS=(-H "Authorization: Bearer $API_TOKEN"); fi

echo "== Activate Q4 crisis =="
curl -sS ${AUTH_ARGS[@]+"${AUTH_ARGS[@]}"} -X POST "$API_BASE_URL/webhook/regime" \
  -H 'Content-Type: application/json' \
  -d '{
    "ticker": "Q4",
    "signal": "SELL",
    "script": "q4d"
  }'
echo

echo "== Overlay summary =="
curl -sS ${AUTH_ARGS[@]+"${AUTH_ARGS[@]}"} "$API_BASE_URL/portfolio-overlay-summary"
echo

echo "== Repeat Q4 crisis signal =="
curl -sS ${AUTH_ARGS[@]+"${AUTH_ARGS[@]}"} -X POST "$API_BASE_URL/webhook/regime" \
  -H 'Content-Type: application/json' \
  -d '{
    "ticker": "Q4",
    "signal": "SELL",
    "script": "q4d"
  }'
echo

echo "== Clear Q4 crisis =="
curl -sS ${AUTH_ARGS[@]+"${AUTH_ARGS[@]}"} -X POST "$API_BASE_URL/webhook/regime" \
  -H 'Content-Type: application/json' \
  -d '{
    "ticker": "Q4",
    "signal": "BUY",
    "script": "q4d"
  }'
echo
