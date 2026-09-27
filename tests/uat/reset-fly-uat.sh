#!/usr/bin/env bash
set -euo pipefail

APP="${FLY_UAT_BACKEND_APP:-alpha-edge-uat-backend}"
DB_PATH="${FLY_UAT_DB_PATH:-/litefs/trading.db}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

{
  cat "$SCRIPT_DIR/reset_uat_state.sql"
  printf '\n'
  cat "$SCRIPT_DIR/seed_fake_portfolio.sql"
} | fly ssh console -a "$APP" -C "sqlite3 $DB_PATH"

echo "Reset and seeded $APP:$DB_PATH"
