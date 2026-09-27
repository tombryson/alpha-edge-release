package main

import (
	"context"
	"database/sql"
	"testing"
)

func TestManagedStartupAndFeatureReadsDoNotReseed(t *testing.T) {
	previous, previousManaged := db, managedSchema.Load()
	var err error
	db, err = sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close(); db = previous; managedSchema.Store(previousManaged) })
	if err := initializeDatabase(context.Background(), ""); err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`
		UPDATE asset_class_config SET display_name='Custom gold',alert_color='#123456',active=0 WHERE code='GOLD_MINERS';
		UPDATE commodity_themes SET display_name='Custom market',active=0 WHERE code='GOLD';
		INSERT INTO asset_class_etf_policies(asset_class,core_ticker,core_ratio_pct,momentum_influence_pct) VALUES('GOLD_MINERS','ASX:FIXTURE',50,35);
		UPDATE settings SET value='0' WHERE key='data_refresh_automation_enabled';
		DELETE FROM etf_momentum_universe_members;
	`)
	if err != nil {
		t.Fatal(err)
	}
	var changesBefore, schemaBefore int
	if err := db.QueryRow("SELECT total_changes()").Scan(&changesBefore); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("PRAGMA schema_version").Scan(&schemaBefore); err != nil {
		t.Fatal(err)
	}
	if err := initializeDatabase(context.Background(), ""); err != nil {
		t.Fatal(err)
	}
	for name, ensure := range map[string]func() error{
		"actions": ensureSecurityActionSchema, "narrative": ensureNewsNarrativeSchema,
		"candidates": ensureNewsFoundationCandidateSchema, "research": ensureNewsFoundationResearchSchema,
		"news jobs": ensureNewsFoundationJobSchema, "daily news": ensureNewsDailyJobSchema,
		"memos": ensurePortfolioMemoSchema, "inbox": initWebhookInbox,
		"identities": ensureSecurityIdentitySchema, "shortlist": ensureETFShortlistSchema,
		"management": ensureETFManagementSchema, "core": ensureETFCorePolicySchema,
		"momentum": ensureETFMomentumSchema, "listings": ensureWatchlistListingSchema,
		"commodities": ensureCommodityThemeSchema, "refresh": ensureDataRefreshSchema,
		"provenance": ensureAssetClassProvenanceSchema,
	} {
		if err := ensure(); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	var changesAfter, schemaAfter int
	if err := db.QueryRow("SELECT total_changes()").Scan(&changesAfter); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("PRAGMA schema_version").Scan(&schemaAfter); err != nil {
		t.Fatal(err)
	}
	if changesBefore != changesAfter || schemaBefore != schemaAfter {
		t.Fatalf("repeat startup/feature ensure changed data or schema: %d/%d -> %d/%d", changesBefore, schemaBefore, changesAfter, schemaAfter)
	}
}
