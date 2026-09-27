#!/usr/bin/env bash
set -euo pipefail

APP="${FLY_UAT_BACKEND_APP:-alpha-edge-uat-backend}"
DB_PATH="${FLY_UAT_DB_PATH:-/litefs/trading.db}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cat "$SCRIPT_DIR/seed_commodity_theme_fixture.sql" \
  | fly ssh console -a "$APP" -C "sqlite3 $DB_PATH"

fixture_count="$(fly ssh console -a "$APP" -C "sqlite3 $DB_PATH \"SELECT COUNT(*) FROM commodity_theme_events WHERE event_key GLOB 'uat-fixture:commodity-theme:*';\"" | tail -1)"
if [[ "$fixture_count" != "14" ]]; then
  echo "Expected 14 commodity-theme fixture events; found $fixture_count" >&2
  exit 1
fi

echo "Seeded mixed commodity-theme fixture in $APP:$DB_PATH"
