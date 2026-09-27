package database

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"errors"
	"path/filepath"
	"reflect"
	"testing"
)

//go:embed testdata/production_v187_schema.sql
var productionSchemaFixture string

func productionFixture(t *testing.T, db *sql.DB) {
	t.Helper()
	execute(t, db, productionSchemaFixture)
	known, err := productionLegacySchema(context.Background(), db)
	if err != nil || !known {
		t.Fatalf("fixture fingerprint differs: %v", err)
	}
	var seeds []productionMomentumSeed
	if err := json.Unmarshal([]byte(productionMomentumCatalogue), &seeds); err != nil {
		t.Fatal(err)
	}
	for i, seed := range seeds {
		execute(t, db, "INSERT INTO security_identities(id,ticker,exchange_prefix,canonical_name) VALUES(?,?,?,?)", 101+i, seed.Ticker, seed.Exchange, "Synthetic "+seed.Ticker)
	}
	execute(t, db, `INSERT INTO account_statements(id,account_name,statement_date,total_value_aud,cash_aud) VALUES(901,'Synthetic IG','2026-09-10',10000,7000);
		INSERT INTO holdings(id,ticker,company_name,quantity,cost_aud,value_aud,current_price,is_active) VALUES(902,'ASX:FIXTURE','Synthetic holding',100,2500,3000,30,1);
		INSERT INTO statement_holdings(id,statement_id,details,quantity,cost_aud,current_price,value_aud,gain_loss_aud,gain_loss_pct,currency,market_value) VALUES(903,901,'Synthetic holding',100,2500,30,3000,500,20,'AUD',3000);
		INSERT INTO alerts(id,ticker,alert_type,source) VALUES(904,'ASX:FIXTURE','TRIM','tms');
		INSERT INTO decisions(id,alert_id,decision,notes) VALUES(905,904,'TRIM','Recorded');
		INSERT INTO security_actions(id,alert_id,ticker,intent,priority,status,execution_note) VALUES(906,904,'ASX:FIXTURE','REDUCE',1,'AWAITING_STATEMENT','Do not repeat');
		INSERT INTO stock_analysis(ticker,name,security_id) VALUES('LSF','Synthetic LSF',113);
		UPDATE security_identities SET exchange_prefix='' WHERE id=113;
		INSERT INTO portfolio_mix_snapshots(id,status,notes) VALUES(907,'APPROVED','Synthetic shape');
		INSERT INTO portfolio_mix_snapshot_rows(snapshot_id,asset_class,display_name,weight_pct) VALUES(907,'GOLD_MINERS','Gold Miners',30),(907,'CASH','Cash',70);
		INSERT INTO settings(key,value) VALUES('etf_core_sleeve_ratio_pct','50'),('synthetic_preference','preserve');`)
}

func TestProductionBridgeAndRecovery(t *testing.T) {
	db, _ := testDB(t)
	productionFixture(t, db)
	before := recordDump(t, db)
	ctx := context.Background()
	p, err := Migrate(ctx, db, options(t))
	if err != nil {
		t.Fatal(err)
	}
	if p.Fresh || p.Statements != 36 || len(p.Pending) != len(migrations()) {
		t.Fatalf("plan: %+v", p)
	}
	// Project added columns away on a separate recovered copy for exact evidence comparison.
	done, err := applied(ctx, db)
	if err != nil || len(done) != len(migrations()) || done[0].BackupSHA256 == "" || done[0].BackupSHA256 != done[len(done)-1].BackupSHA256 {
		t.Fatalf("atomic adoption/backup: %+v %v", done, err)
	}
	restoredPath := filepath.Join(t.TempDir(), "restored.db")
	if _, err := Backup(ctx, done[0].BackupPath, restoredPath); err != nil {
		t.Fatal(err)
	}
	restored, err := Open(restoredPath, false)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	if !reflect.DeepEqual(before, recordDump(t, restored)) {
		t.Fatal("pre-upgrade recovery lost evidence")
	}
	var count int
	if err := db.QueryRow("SELECT count(*) FROM etf_momentum_universe_members WHERE security_id BETWEEN 101 AND 115").Scan(&count); err != nil || count != 15 {
		t.Fatalf("catalogue did not reuse identity IDs: %d %v", count, err)
	}
	if err := db.QueryRow("SELECT count(*) FROM asset_class_etf_policies").Scan(&count); err != nil || count != 0 {
		t.Fatal("invented Core policies")
	}
	if err := db.QueryRow("SELECT count(*) FROM security_actions WHERE execution_units IS NULL AND execution_snapshot_json='[]'").Scan(&count); err != nil || count != 1 {
		t.Fatal("fabricated execution evidence")
	}
	for table := range before {
		cols, err := columns(ctx, restored, table)
		if err != nil {
			t.Fatal(err)
		}
		for _, col := range cols {
			query := "SELECT quote(" + ident(col.Name) + ") FROM " + ident(table) + " ORDER BY rowid"
			read := func(conn *sql.DB) []string {
				rows, err := conn.Query(query)
				if err != nil {
					t.Fatal(err)
				}
				defer rows.Close()
				var values []string
				for rows.Next() {
					var value string
					if err := rows.Scan(&value); err != nil {
						t.Fatal(err)
					}
					values = append(values, value)
				}
				if err := rows.Err(); err != nil {
					t.Fatal(err)
				}
				return values
			}
			if !reflect.DeepEqual(read(db), read(restored)) {
				t.Fatalf("changed original %s.%s", table, col.Name)
			}
		}
	}
	after := recordDump(t, db)
	if _, err := Migrate(ctx, db, Options{}); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(after, recordDump(t, db)) {
		t.Fatal("repeat changed records")
	}
}

func TestProductionBridgeRejectsUnknownSchemaAndAmbiguousIdentity(t *testing.T) {
	for _, change := range []string{
		"ALTER TABLE holdings ADD COLUMN unknown_feature TEXT",
		"DROP TABLE alerts",
		"INSERT INTO security_identities(ticker,exchange_prefix,canonical_name) VALUES('ASX_DLY:FANG','ASX:','Synthetic duplicate')",
	} {
		t.Run(change, func(t *testing.T) {
			db, _ := testDB(t)
			productionFixture(t, db)
			execute(t, db, change)
			before := recordDump(t, db)
			if _, err := Migrate(context.Background(), db, options(t)); err == nil {
				t.Fatal("unsafe upgrade accepted")
			}
			if !reflect.DeepEqual(before, recordDump(t, db)) {
				t.Fatal("refusal changed records/schema")
			}
		})
	}
}

func TestProductionBridgeRollbackAndRetry(t *testing.T) {
	db, _ := testDB(t)
	productionFixture(t, db)
	before := recordDump(t, db)
	list := migrations()
	apply := list[1].Apply
	list[1].Apply = func(ctx context.Context, q querier) error {
		if err := apply(ctx, q); err != nil {
			return err
		}
		return errors.New("injected interruption after bridge")
	}
	if _, err := migrate(context.Background(), db, options(t), list); err == nil {
		t.Fatal("expected failure")
	}
	if !reflect.DeepEqual(before, recordDump(t, db)) {
		t.Fatal("partial bridge survived")
	}
	if _, err := Migrate(context.Background(), db, options(t)); err != nil {
		t.Fatal(err)
	}
}

func TestUATVersionOneUpgradePreservesRecords(t *testing.T) {
	db, _ := testDB(t)
	ctx := context.Background()
	if _, err := migrate(ctx, db, Options{}, migrations()[:1]); err != nil {
		t.Fatal(err)
	}
	execute(t, db, evidenceSQL)
	execute(t, db, "DELETE FROM etf_momentum_universe_members WHERE display_ticker='FANG'")
	before := recordDump(t, db)
	if _, err := Migrate(ctx, db, options(t)); err != nil {
		t.Fatal(err)
	}
	after := recordDump(t, db)
	delete(after, "statement_revisions")
	if !reflect.DeepEqual(before, after) {
		t.Fatal("v2 rewrote UAT data")
	}
}

func TestProductionBridgeDoesNotReinterpretRecordedVersionOne(t *testing.T) {
	db, _ := testDB(t)
	productionFixture(t, db)
	if checksum(migrations()[0]) != "bd2d3867ebe7951016f23f64fec5d3f4d497626828590e00b4a12dce5e5f71fe" {
		t.Fatal("shipped v1 checksum changed")
	}
	execute(t, db, `CREATE TABLE terminal_schema_migrations(version INTEGER PRIMARY KEY,name TEXT,checksum TEXT,applied_at TEXT,backup_path TEXT,backup_sha256 TEXT)`)
	m := migrations()[0]
	execute(t, db, "INSERT INTO terminal_schema_migrations VALUES(1,?,?, 'date','','')", m.Name, checksum(m))
	if _, err := Migrate(context.Background(), db, options(t)); err == nil {
		t.Fatal("recorded but incomplete v1 schema accepted as legacy")
	}
}

func TestProductionCatalogueInsertsOnlyMissingIdentities(t *testing.T) {
	db, _ := testDB(t)
	productionFixture(t, db)
	execute(t, db, "DELETE FROM security_identities WHERE ticker IN ('FANG','GPEQ','ESPO')")
	execute(t, db, "UPDATE security_identities SET exchange_prefix='NYSEARCA:' WHERE ticker='SGDJ'")
	if _, err := Migrate(context.Background(), db, options(t)); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow("SELECT count(*) FROM security_identities").Scan(&count); err != nil || count != 15 {
		t.Fatalf("unexpected identity inserts: %d %v", count, err)
	}
	if err := db.QueryRow("SELECT count(*) FROM etf_momentum_universe_members WHERE display_ticker='SGDJ' AND security_id=105").Scan(&count); err != nil || count != 1 {
		t.Fatal("exchange alias created duplicate identity")
	}
}
