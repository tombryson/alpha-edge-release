package main

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Export goes to a disposable directory: shipped migrations are never rewritten.
// The source is a new in-memory database, never broker data or a developer database.
func TestExportLegacyDatabaseBaseline(t *testing.T) {
	if os.Getenv("EXPORT_DATABASE_BASELINE") != "1" {
		t.Skip("one-time baseline generation")
	}
	previous := db
	var err error
	db, err = sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close(); db = previous })
	initLegacyDB()
	if err := initWebhookInbox(); err != nil {
		t.Fatal(err)
	}
	if err := ensurePortfolioMemoSchema(); err != nil {
		t.Fatal(err)
	}
	rows, err := db.Query(`SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name`)
	if err != nil {
		t.Fatal(err)
	}
	var schema, seeds strings.Builder
	var tables []string
	for rows.Next() {
		var kind, name, statement string
		if err := rows.Scan(&kind, &name, &statement); err != nil {
			t.Fatal(err)
		}
		schema.WriteString(statement + ";\n\n")
		if kind == "table" {
			tables = append(tables, name)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	rows.Close()
	for _, table := range tables {
		cols, err := db.Query("PRAGMA table_info(" + quoteSQLiteIdentifier(table) + ")")
		if err != nil {
			t.Fatal(err)
		}
		var names, quoted []string
		for cols.Next() {
			var cid, nn, pk int
			var name, typ string
			var def sql.NullString
			if err := cols.Scan(&cid, &name, &typ, &nn, &def, &pk); err != nil {
				t.Fatal(err)
			}
			if def.Valid && strings.Contains(strings.ToUpper(def.String), "CURRENT_TIMESTAMP") {
				continue
			}
			names = append(names, quoteSQLiteIdentifier(name))
			quoted = append(quoted, "quote("+quoteSQLiteIdentifier(name)+")")
		}
		if err := cols.Err(); err != nil {
			t.Fatal(err)
		}
		cols.Close()
		data, err := db.Query("SELECT " + strings.Join(quoted, ",") + " FROM " + quoteSQLiteIdentifier(table) + " ORDER BY rowid")
		if err != nil {
			t.Fatal(err)
		}
		for data.Next() {
			values := make([]string, len(names))
			args := make([]any, len(names))
			for i := range values {
				args[i] = &values[i]
			}
			if err := data.Scan(args...); err != nil {
				t.Fatal(err)
			}
			seeds.WriteString("INSERT INTO " + quoteSQLiteIdentifier(table) + " (" + strings.Join(names, ",") + ") VALUES (" + strings.Join(values, ",") + ");\n")
		}
		if err := data.Err(); err != nil {
			t.Fatal(err)
		}
		data.Close()
	}
	dir := t.TempDir()
	for name, content := range map[string]string{"0001_baseline.sql": schema.String(), "0001_fresh_defaults.sql": seeds.String()} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	t.Logf("exported %d tables, schema %d bytes, fresh defaults %d bytes to %s", len(tables), schema.Len(), seeds.Len(), dir)
}
