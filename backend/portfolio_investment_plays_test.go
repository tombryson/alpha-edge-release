package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func TestInvestmentPlaysPersistThroughSettingsDatabaseReopen(t *testing.T) {
	previous := db
	path := filepath.Join(t.TempDir(), "plays.db")
	var err error
	db, err = sql.Open("sqlite3", path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close(); db = previous })
	if _, err := db.Exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)`); err != nil {
		t.Fatal(err)
	}
	first := `{"id":"one","version":1,"title":"Agriculture","thesis":"Input costs","created_at":"2026-09-18","updated_at":"2026-09-18"}`
	second := `{"id":"two","version":1,"title":"Gold","thesis":"Margins","created_at":"2026-09-18","updated_at":"2026-09-18"}`
	brief := `{"portfolio_scope":"thematic_sleeve","base_currency":"AUD","tax_cost_policy":"Consider realised gains"}`
	response := postClassColours(t, map[string]string{"portfolio_investment_play:one": first, "portfolio_investment_play:two": second, "portfolio_investment_brief": brief, "unrelated": "retained"})
	if response.Code != http.StatusOK {
		t.Fatalf("save failed: %s", response.Body.String())
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = sql.Open("sqlite3", path)
	if err != nil {
		t.Fatal(err)
	}
	read := func() map[string]string {
		result := httptest.NewRecorder()
		getSettings(result, httptest.NewRequest(http.MethodGet, "/api/settings", nil))
		var settings map[string]string
		if err := json.Unmarshal(result.Body.Bytes(), &settings); err != nil {
			t.Fatal(err)
		}
		return settings
	}
	if settings := read(); settings["portfolio_investment_play:one"] != first || settings["portfolio_investment_play:two"] != second {
		t.Fatal("plays did not survive database reopen")
	}
	if read()["portfolio_investment_brief"] != brief {
		t.Fatal("investment brief did not survive database reopen")
	}
	if response := postClassColours(t, map[string]string{"portfolio_investment_play:one": ""}); response.Code != http.StatusOK {
		t.Fatalf("delete failed: %s", response.Body.String())
	}
	settings := read()
	if settings["portfolio_investment_play:one"] != "" || settings["portfolio_investment_play:two"] != second || settings["unrelated"] != "retained" {
		t.Fatal("deleting one play changed another record")
	}
}
