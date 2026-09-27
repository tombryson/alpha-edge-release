package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

func testDB(t *testing.T) (*sql.DB, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "book.db")
	db, err := sql.Open("sqlite3", path+"?_journal_mode=WAL&_busy_timeout=3000")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	return db, path
}
func execute(t *testing.T, db *sql.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.Exec(query, args...); err != nil {
		t.Fatal(err)
	}
}
func legacy(t *testing.T, db *sql.DB) {
	t.Helper()
	execute(t, db, baselineSQL)
	execute(t, db, freshDefaultsSQL)
}
func options(t *testing.T) Options { return Options{BackupDir: filepath.Join(t.TempDir(), "backups")} }

func TestLegacyRealDefaultIntegrityAndRecovery(t *testing.T) {
	db, path := testDB(t)
	legacy(t, db)
	// Old rows retain an implicit REAL default after ADD COLUMN. SQLite 3.42-3.45.1
	// falsely reported these as NULL during integrity checks (SQLite 460353dfff).
	execute(t, db, `CREATE TABLE legacy_ratio_fixture(id INTEGER PRIMARY KEY);
		INSERT INTO legacy_ratio_fixture VALUES(1),(2);
		ALTER TABLE legacy_ratio_fixture ADD COLUMN ratio REAL NOT NULL DEFAULT 0.75;
		INSERT INTO legacy_ratio_fixture(id,ratio) VALUES(3,0.5);`)
	ctx := context.Background()
	before := recordDump(t, db)
	if _, err := Inspect(ctx, db); err != nil {
		t.Fatalf("valid legacy REAL default rejected: %v", err)
	}
	if _, err := Migrate(ctx, db, options(t)); err != nil {
		t.Fatal(err)
	}
	after := recordDump(t, db)
	delete(after, "statement_revisions")
	if !reflect.DeepEqual(before, after) {
		t.Fatal("adoption changed legacy values")
	}
	restoredPath := filepath.Join(t.TempDir(), "restored.db")
	if _, err := Backup(ctx, path, restoredPath); err != nil {
		t.Fatal(err)
	}
	restored, err := Open(restoredPath, true)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	if !reflect.DeepEqual(recordDump(t, db), recordDump(t, restored)) {
		t.Fatal("recovery changed legacy values")
	}
}

const evidenceSQL = `
INSERT INTO account_statements(id,account_name,statement_date,total_value_aud,cash_aud) VALUES(901,'Synthetic IG','2026-09-10',10000,7000);
INSERT INTO holdings(id,ticker,company_name,quantity,cost_aud,value_aud,current_price,is_active) VALUES(902,'ASX:FIXTURE','Synthetic holding',100,2500,3000,30,1);
INSERT INTO statement_holdings(id,statement_id,details,quantity,cost_aud,current_price,value_aud,gain_loss_aud,gain_loss_pct,currency,market_value) VALUES(903,901,'Synthetic holding',100,2500,30,3000,500,20,'AUD',3000);
INSERT INTO alerts(id,ticker,alert_type,source) VALUES(904,'ASX:FIXTURE','TRIM','tms');
INSERT INTO decisions(id,alert_id,decision,notes) VALUES(905,904,'TRIM','Synthetic recorded execution');
INSERT INTO security_actions(id,alert_id,ticker,intent,priority,status,execution_note,execution_units) VALUES(906,904,'ASX:FIXTURE','REDUCE',1,'AWAITING_STATEMENT','Do not duplicate',5);
INSERT INTO portfolio_mix_snapshots(id,status,notes) VALUES(907,'APPROVED','Synthetic approved shape');
INSERT INTO portfolio_mix_snapshot_rows(snapshot_id,asset_class,display_name,weight_pct) VALUES(907,'GOLD_MINERS','Gold Miners',30),(907,'CASH','Cash',70);
INSERT INTO asset_class_etf_policies(asset_class,core_ticker,core_ratio_pct,momentum_influence_pct) VALUES('GOLD_MINERS','ASX:FIXTURE',50,35);
INSERT INTO settings(key,value) VALUES('synthetic_preference','keep me');
CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,applied_at TEXT);
INSERT INTO schema_migrations VALUES('0001_versioning_begins.sql','2026-06-11'),('0002_analyst_rated_at.sql','2026-06-12');
CREATE TABLE operator_extension(id INTEGER PRIMARY KEY,value TEXT);
INSERT INTO operator_extension VALUES(1,'Preserve unknown tables too');`

func recordDump(t *testing.T, db *sql.DB) map[string]string {
	t.Helper()
	objs, err := objects(context.Background(), db)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	for _, o := range objs {
		if o.Kind != "table" || o.Name == ledgerTable {
			continue
		}
		cols, err := columns(context.Background(), db, o.Name)
		if err != nil {
			t.Fatal(err)
		}
		var names []string
		for _, c := range cols {
			names = append(names, "quote("+ident(c.Name)+")")
		}
		rows, err := db.Query("SELECT " + strings.Join(names, ",") + " FROM " + ident(o.Name) + " ORDER BY rowid")
		if err != nil {
			t.Fatal(err)
		}
		var b strings.Builder
		for rows.Next() {
			values := make([]string, len(cols))
			args := make([]any, len(cols))
			for i := range values {
				args[i] = &values[i]
			}
			if err := rows.Scan(args...); err != nil {
				t.Fatal(err)
			}
			fmt.Fprintf(&b, "%q\n", values)
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		rows.Close()
		// Additive research/auth/setup tables contain no financial evidence. Once populated,
		// include every row so backup and recovery still check the complete record.
		if o.Name == "weight_policy" {
			var enabled, epoch int
			if err := db.QueryRow(`SELECT enabled,epoch FROM weight_policy WHERE id=1`).Scan(&enabled, &epoch); err != nil {
				t.Fatal(err)
			}
			if enabled == 0 && epoch == 0 {
				continue
			}
		}
		if (o.Name != "source_research_jobs" && o.Name != "security_announcement_subscriptions" && !strings.HasPrefix(o.Name, "owner_") && !strings.HasPrefix(o.Name, "weight_")) || b.Len() > 0 {
			out[o.Name] = b.String()
		}
	}
	return out
}

func TestFreshBaselineAndRepeat(t *testing.T) {
	db, _ := testDB(t)
	ctx := context.Background()
	p, err := Migrate(ctx, db, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if !p.Fresh || len(p.Pending) != len(migrations()) {
		t.Fatalf("plan: %+v", p)
	}
	before := recordDump(t, db)
	p, err = Migrate(ctx, db, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if p.CurrentVersion != len(migrations()) || len(p.Pending) != 0 {
		t.Fatalf("repeat: %+v", p)
	}
	if !reflect.DeepEqual(before, recordDump(t, db)) {
		t.Fatal("repeat changed records")
	}
	var accounts int
	if err = db.QueryRow("SELECT count(*) FROM account_statements").Scan(&accounts); err != nil || accounts != 0 {
		t.Fatal("fresh baseline invented a portfolio")
	}
}

func TestAdoptionPreservesEveryRecordAndRecovery(t *testing.T) {
	db, _ := testDB(t)
	legacy(t, db)
	execute(t, db, evidenceSQL)
	before := recordDump(t, db)
	ctx := context.Background()
	p, err := Migrate(ctx, db, options(t))
	if err != nil {
		t.Fatal(err)
	}
	if p.Fresh || p.Statements != 0 {
		t.Fatalf("unexpected rewrite: %+v", p)
	}
	after := recordDump(t, db)
	delete(after, "statement_revisions") // v7 adds labelled evidence; original tables must remain byte-for-byte unchanged.
	if !reflect.DeepEqual(before, after) {
		t.Fatal("adoption changed financial or legacy records")
	}
	var evidenceCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM statement_revisions WHERE source='legacy_snapshot' AND accepted_payload_json IS NULL AND json_extract(snapshot_json,'$.holdings[0].quantity')=100`).Scan(&evidenceCount); err != nil || evidenceCount != 1 {
		t.Fatalf("legacy snapshot missing: %d %v", evidenceCount, err)
	}
	done, err := applied(ctx, db)
	if err != nil || len(done) != len(migrations()) || done[0].BackupSHA256 == "" {
		t.Fatalf("missing verified backup: %+v %v", done, err)
	}
	restoredPath := filepath.Join(t.TempDir(), "restored.db")
	report, err := Backup(ctx, done[0].BackupPath, restoredPath)
	if err != nil {
		t.Fatal(err)
	}
	if report.Integrity != "ok" {
		t.Fatal(report)
	}
	restored, err := Open(restoredPath, false)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	if !reflect.DeepEqual(before, recordDump(t, restored)) {
		t.Fatal("restored records differ")
	}
	if _, err = Migrate(ctx, restored, options(t)); err != nil {
		t.Fatal(err)
	}
	afterRestore := recordDump(t, restored)
	delete(afterRestore, "statement_revisions")
	if !reflect.DeepEqual(before, afterRestore) {
		t.Fatal("restored upgrade changed evidence")
	}
}

func TestOlderAdditiveLayout(t *testing.T) {
	db, _ := testDB(t)
	legacy(t, db)
	execute(t, db, evidenceSQL)
	for _, name := range []string{"execution_cash_value", "execution_exception_reason", "execution_policy_snapshot"} {
		execute(t, db, "ALTER TABLE security_actions DROP COLUMN "+name)
	}
	execute(t, db, "DROP TABLE portfolio_memo_runs")
	p, err := Migrate(context.Background(), db, options(t))
	if err != nil {
		t.Fatal(err)
	}
	if p.Statements < 4 {
		t.Fatalf("missing additive upgrade: %+v", p)
	}
	var units float64
	var state, note string
	if err = db.QueryRow("SELECT execution_units,status,execution_note FROM security_actions WHERE id=906").Scan(&units, &state, &note); err != nil {
		t.Fatal(err)
	}
	if units != 5 || state != "AWAITING_STATEMENT" || note != "Do not duplicate" {
		t.Fatal("execution evidence changed")
	}
}

func TestRefusesUnknownFutureAndChangedHistory(t *testing.T) {
	for _, change := range []string{"UPDATE terminal_schema_migrations SET checksum='edited'", "UPDATE terminal_schema_migrations SET version=99 WHERE version=1", "INSERT INTO terminal_schema_migrations VALUES(99,'future','hash','date','','')"} {
		t.Run(change, func(t *testing.T) {
			db, _ := testDB(t)
			if _, err := Migrate(context.Background(), db, Options{}); err != nil {
				t.Fatal(err)
			}
			execute(t, db, change)
			before := recordDump(t, db)
			if _, err := Migrate(context.Background(), db, options(t)); err == nil {
				t.Fatal("accepted incompatible migration history")
			}
			if !reflect.DeepEqual(before, recordDump(t, db)) {
				t.Fatal("refusal changed rows")
			}
		})
	}
}

func TestPendingMigrationRollsBackAndRetries(t *testing.T) {
	db, _ := testDB(t)
	if _, err := Migrate(context.Background(), db, Options{}); err != nil {
		t.Fatal(err)
	}
	fail := true
	second := migration{Version: len(migrations()) + 1, Name: "test_additive", Content: "test migration", Apply: func(ctx context.Context, q querier) error {
		if _, err := q.ExecContext(ctx, "CREATE TABLE upgrade_fixture(id INTEGER PRIMARY KEY)"); err != nil {
			return err
		}
		if fail {
			return errors.New("injected interruption")
		}
		return nil
	}}
	list := append(migrations(), second)
	opts := options(t)
	if _, err := migrate(context.Background(), db, opts, list); err == nil {
		t.Fatal("expected rollback")
	}
	var count int
	db.QueryRow("SELECT count(*) FROM sqlite_master WHERE name='upgrade_fixture'").Scan(&count)
	if count != 0 {
		t.Fatal("partial DDL survived")
	}
	db.QueryRow("SELECT count(*) FROM terminal_schema_migrations").Scan(&count)
	if count != len(migrations()) {
		t.Fatal("failed version recorded")
	}
	fail = false
	if _, err := migrate(context.Background(), db, opts, list); err != nil {
		t.Fatal(err)
	}
	db.QueryRow("SELECT count(*) FROM terminal_schema_migrations").Scan(&count)
	if count != len(migrations())+1 {
		t.Fatal("retry not applied")
	}
}

func TestBackupRequiredAndFailureBeforeAnyMutation(t *testing.T) {
	db, _ := testDB(t)
	legacy(t, db)
	execute(t, db, evidenceSQL)
	before := recordDump(t, db)
	for _, opts := range []Options{{}, {BackupDir: filepath.Join(t.TempDir(), "not-directory")}} {
		if opts.BackupDir != "" {
			if err := os.WriteFile(opts.BackupDir, []byte("occupied"), 0600); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := Migrate(context.Background(), db, opts); err == nil {
			t.Fatal("upgrade did not require a successful backup")
		}
	}
	if !reflect.DeepEqual(before, recordDump(t, db)) {
		t.Fatal("failed backup changed records")
	}
	var n int
	db.QueryRow("SELECT count(*) FROM sqlite_master WHERE name=?", ledgerTable).Scan(&n)
	if n != 0 {
		t.Fatal("failed backup left ledger")
	}
}

func TestConcurrentStartupAppliesOnce(t *testing.T) {
	db, path := testDB(t)
	legacy(t, db)
	other, err := Open(path, false)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	opts := options(t)
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for _, d := range []*sql.DB{db, other} {
		wg.Add(1)
		go func(d *sql.DB) { defer wg.Done(); _, err := Migrate(context.Background(), d, opts); errs <- err }(d)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	var n int
	db.QueryRow("SELECT count(*) FROM terminal_schema_migrations").Scan(&n)
	if n != len(migrations()) {
		t.Fatal("duplicate migration")
	}
}

func TestBackupReadsWALAndNeverClobbers(t *testing.T) {
	db, path := testDB(t)
	execute(t, db, "PRAGMA wal_autocheckpoint=0; CREATE TABLE evidence(id INTEGER PRIMARY KEY,note TEXT); INSERT INTO evidence VALUES(1,'in the WAL')")
	out := filepath.Join(t.TempDir(), "copy.db")
	report, err := Backup(context.Background(), path, out)
	if err != nil {
		t.Fatal(err)
	}
	if report.Tables["evidence"] != 1 {
		t.Fatal("committed WAL row missing")
	}
	info, err := os.Stat(out)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("backup permissions: %v %v", info, err)
	}
	for _, dest := range []string{out, path} {
		if _, err := Backup(context.Background(), path, dest); err == nil {
			t.Fatal("overwrote destination")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	cancelled := filepath.Join(t.TempDir(), "cancelled.db")
	if _, err := Backup(ctx, path, cancelled); err == nil {
		t.Fatal("ignored cancellation")
	}
	if _, err := os.Stat(cancelled); !os.IsNotExist(err) {
		t.Fatal("published cancelled backup")
	}
}

func TestUnsupportedAndDamagedSchemasFailWithoutRebuild(t *testing.T) {
	for _, change := range []string{"ALTER TABLE holdings RENAME TO unexpected_holdings", "DROP INDEX idx_holdings_active; CREATE INDEX idx_holdings_active ON holdings(ticker)", "ALTER TABLE alerts RENAME COLUMN ticker TO not_ticker"} {
		t.Run(change, func(t *testing.T) {
			db, _ := testDB(t)
			legacy(t, db)
			execute(t, db, change)
			before := recordDump(t, db)
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			if _, err := Migrate(ctx, db, options(t)); err == nil {
				t.Fatal("accepted unsupported schema")
			}
			if !reflect.DeepEqual(before, recordDump(t, db)) {
				t.Fatal("failed preflight changed records")
			}
		})
	}
}

func TestColumnDeclarationScanner(t *testing.T) {
	ddl := `CREATE TABLE example (id INTEGER PRIMARY KEY, note TEXT NOT NULL DEFAULT 'a,b (c)', value REAL CHECK(value IN (1,2,3)), FOREIGN KEY(id) REFERENCES parent(id))`
	for name, want := range map[string]string{"note": "note TEXT NOT NULL DEFAULT 'a,b (c)'", "value": "value REAL CHECK(value IN (1,2,3))"} {
		got, err := columnDefinition(ddl, name)
		if err != nil || got != want {
			t.Fatalf("%s: %q %v", name, got, err)
		}
	}
	constraints, err := checks(`CREATE TABLE example (value REAL CHECK(value > 0) CHECK(value < 100))`)
	if err != nil || len(constraints) != 2 {
		t.Fatalf("missed an additional constraint: %v %v", constraints, err)
	}
}

func TestDeployedBaselineVariations(t *testing.T) {
	db, _ := testDB(t)
	ddl := strings.Replace(baselineSQL, `tactical_status TEXT CHECK(tactical_status IN ('BUY','SELL')) DEFAULT 'BUY'`, `tactical_status TEXT DEFAULT "BUY"`, 1)
	ddl = strings.Replace(ddl, "source_event_key TEXT UNIQUE", "source_event_key TEXT", 1)
	execute(t, db, ddl)
	execute(t, db, freshDefaultsSQL)
	execute(t, db, evidenceSQL)
	before := recordDump(t, db)
	p, err := Migrate(context.Background(), db, options(t))
	if err != nil || p.Statements != 0 {
		t.Fatalf("deployed layout required rewriting: %+v %v", p, err)
	}
	after := recordDump(t, db)
	delete(after, "statement_revisions")
	if !reflect.DeepEqual(before, after) {
		t.Fatal("adoption changed deployed-layout records")
	}
}

func TestModifiedDefaultIsRefused(t *testing.T) {
	db, _ := testDB(t)
	execute(t, db, strings.Replace(baselineSQL, "cash_reserve REAL DEFAULT 0", "cash_reserve REAL DEFAULT 1000", 1))
	if _, err := Migrate(context.Background(), db, options(t)); err == nil || !strings.Contains(err.Error(), "default differs") {
		t.Fatalf("changed monetary default not refused: %v", err)
	}
}

func TestCurrentDatabaseNeedsNoWritePermission(t *testing.T) {
	db, path := testDB(t)
	if _, err := Migrate(context.Background(), db, Options{}); err != nil {
		t.Fatal(err)
	}
	readonly, err := Open(path, true)
	if err != nil {
		t.Fatal(err)
	}
	defer readonly.Close()
	if _, err := Migrate(context.Background(), readonly, Options{}); err != nil {
		t.Fatalf("current read-only replica: %v", err)
	}
}

func TestProcessInterruptionRollsBackUpgrade(t *testing.T) {
	if path := os.Getenv("ALPHA_EDGE_MIGRATION_CRASH_FIXTURE"); path != "" {
		db, err := Open(path, false)
		if err != nil {
			t.Fatal(err)
		}
		list := append(migrations(), migration{Version: len(migrations()) + 1, Name: "crash_fixture", Content: "crash after DDL", Apply: func(ctx context.Context, q querier) error {
			if _, err := q.ExecContext(ctx, "CREATE TABLE interrupted_upgrade(id INTEGER); UPDATE settings SET value='uncommitted' WHERE key='synthetic_preference'"); err != nil {
				return err
			}
			os.Exit(23)
			return nil
		}})
		_, err = migrate(context.Background(), db, Options{BackupDir: filepath.Join(filepath.Dir(path), "crash-backups")}, list)
		t.Fatalf("child did not interrupt at the expected point: %v", err)
	}
	db, path := testDB(t)
	if _, err := Migrate(context.Background(), db, Options{}); err != nil {
		t.Fatal(err)
	}
	execute(t, db, evidenceSQL)
	before := recordDump(t, db)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestProcessInterruptionRollsBackUpgrade$")
	command.Env = append(os.Environ(), "ALPHA_EDGE_MIGRATION_CRASH_FIXTURE="+path)
	output, err := command.CombinedOutput()
	var exited *exec.ExitError
	if !errors.As(err, &exited) || exited.ExitCode() != 23 {
		t.Fatalf("unexpected subprocess result: %v %s", err, output)
	}
	if !reflect.DeepEqual(before, recordDump(t, db)) {
		t.Fatal("process interruption left changed data or partial DDL")
	}
	done, err := applied(context.Background(), db)
	if err != nil || len(done) != len(migrations()) {
		t.Fatalf("interrupted version recorded: %+v %v", done, err)
	}
	if _, err := Migrate(context.Background(), db, Options{}); err != nil {
		t.Fatalf("recovery startup failed: %v", err)
	}
}
