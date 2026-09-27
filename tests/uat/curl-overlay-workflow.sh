#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:8081/api}"
API_TOKEN="${UAT_API_TOKEN:-${API_TOKEN:-}}"
AUTH_ARGS=()
if [ -n "$API_TOKEN" ]; then AUTH_ARGS=(-H "Authorization: Bearer $API_TOKEN"); fi

summary() {
  echo "== Summary =="
  curl -sS ${AUTH_ARGS[@]+"${AUTH_ARGS[@]}"} "$API_BASE_URL/portfolio-overlay-summary"
  echo
}

apply_stage1() {
  echo "== Apply Stage 1 =="
  local payload
  payload="$(
    curl -sS ${AUTH_ARGS[@]+"${AUTH_ARGS[@]}"} "$API_BASE_URL/portfolio-overlay-summary" | node -e '
      let input = "";
      process.stdin.on("data", chunk => input += chunk);
      process.stdin.on("end", () => {
        const summary = JSON.parse(input);
        const required = Number(summary.required_de_risk_value || 0);
        const baseline = Number(summary.portfolio_cash_bucket_value || 0);
        process.stdout.write(JSON.stringify({
          required_reduction_value: required,
          recorded_reduction_value: required,
          baseline_reserve_value: baseline,
          expected_reserve_value: baseline + required,
          sources: []
        }));
      });
    '
  )"
  curl -sS ${AUTH_ARGS[@]+"${AUTH_ARGS[@]}"} -X POST "$API_BASE_URL/portfolio-overlay/apply-stage1" \
    -H 'Content-Type: application/json' \
    -d "$payload"
  echo
}

mark_partial() {
  echo "== Mark Stage 1 Partial =="
  curl -sS ${AUTH_ARGS[@]+"${AUTH_ARGS[@]}"} -X POST "$API_BASE_URL/portfolio-overlay/mark-stage1-partial"
  echo
}

save_stage2() {
  echo "== Save Stage 2 =="
  curl -sS ${AUTH_ARGS[@]+"${AUTH_ARGS[@]}"} -X POST "$API_BASE_URL/portfolio-overlay/save-stage2" \
    -H 'Content-Type: application/json' \
    -d '{
      "items": [
        {"asset_class": "ENERGY", "target_pct": 18},
        {"asset_class": "INSURANCE", "target_pct": 10},
        {"asset_class": "STAPLES", "target_pct": 8},
        {"asset_class": "HEALTHCARE", "target_pct": 6}
      ]
    }'
  echo
}

complete_stage2() {
  echo "== Complete Stage 2 =="
  curl -sS ${AUTH_ARGS[@]+"${AUTH_ARGS[@]}"} -X POST "$API_BASE_URL/portfolio-overlay/complete-stage2"
  echo
}

set_baseline() {
  echo "== Accept Baseline =="
  curl -sS ${AUTH_ARGS[@]+"${AUTH_ARGS[@]}"} -X POST "$API_BASE_URL/portfolio-overlay/set-baseline"
  echo
}

summary
apply_stage1
summary
save_stage2
complete_stage2
summary
set_baseline
summary
