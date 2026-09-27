package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func setupClassColourTest(t *testing.T) {
	t.Helper()
	previous := db
	testDB, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	testDB.SetMaxOpenConns(1)
	db = testDB
	t.Cleanup(func() { db = previous; testDB.Close() })
	for _, query := range []string{
		`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)`,
		`CREATE TABLE asset_classes (code TEXT PRIMARY KEY)`,
		`INSERT INTO asset_classes VALUES ('GOLD_MINERS'), ('SILVER_MINERS'), ('CUSTOM_FUND_A')`,
		`INSERT INTO settings (key, value) VALUES ('etf_core_sleeve_ratio_pct', '25'), ('asset_class_colour:SILVER_MINERS', '#c0c7d2')`,
	} {
		if _, err := db.Exec(query); err != nil {
			t.Fatal(err)
		}
	}
}

func postClassColours(t *testing.T, updates map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(updates)
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	updateSettings(response, httptest.NewRequest(http.MethodPost, "/api/settings", bytes.NewReader(body)))
	return response
}

func TestClassColourSettingsPersistAndReset(t *testing.T) {
	setupClassColourTest(t)
	key := assetClassColourSettingPrefix + "GOLD_MINERS"
	for _, colour := range []string{" #AABBCC ", ""} {
		response := postClassColours(t, map[string]string{key: colour})
		if response.Code != http.StatusOK {
			t.Fatalf("save: %d %s", response.Code, response.Body.String())
		}
		get := httptest.NewRecorder()
		getSettings(get, httptest.NewRequest(http.MethodGet, "/api/settings", nil))
		var settings map[string]string
		if err := json.Unmarshal(get.Body.Bytes(), &settings); err != nil {
			t.Fatal(err)
		}
		expected := ""
		if colour != "" {
			expected = "#aabbcc"
		}
		if settings[key] != expected {
			t.Fatalf("saved colour %q, want %q", settings[key], expected)
		}
		if settings["etf_core_sleeve_ratio_pct"] != "25" || settings["asset_class_colour:SILVER_MINERS"] != "#c0c7d2" {
			t.Fatal("unrelated settings changed")
		}
	}
	response := postClassColours(t, map[string]string{assetClassColourSettingPrefix + "CUSTOM_FUND_A": "#123456"})
	if response.Code != http.StatusOK {
		t.Fatalf("custom class save: %s", response.Body.String())
	}
}

func TestClassColourSettingsRejectInvalidBeforeWrites(t *testing.T) {
	setupClassColourTest(t)
	for _, item := range []struct{ key, value string }{
		{"GOLD_MINERS", "red"}, {"GOLD_MINERS", "#fff"}, {"GOLD_MINERS", "#12345678"},
		{"GOLD_MINERS", "#ffffff; } body {display:none}"}, {"UNKNOWN", "#123456"},
		{"gold_miners", "#123456"}, {"", "#123456"}, {"BAD:CODE", "#123456"},
	} {
		t.Run(item.key+item.value, func(t *testing.T) {
			response := postClassColours(t, map[string]string{assetClassColourSettingPrefix + item.key: item.value, "etf_core_sleeve_ratio_pct": "99"})
			if response.Code != http.StatusBadRequest {
				t.Fatalf("got %d: %s", response.Code, response.Body.String())
			}
			var value string
			if err := db.QueryRow(`SELECT value FROM settings WHERE key = 'etf_core_sleeve_ratio_pct'`).Scan(&value); err != nil {
				t.Fatal(err)
			}
			if value != "25" {
				t.Fatal("invalid palette request partially updated other settings")
			}
		})
	}
}

func TestClassColourSettingsDatabaseFailure(t *testing.T) {
	setupClassColourTest(t)
	if _, err := db.Exec(`DROP TABLE asset_classes`); err != nil {
		t.Fatal(err)
	}
	response := postClassColours(t, map[string]string{assetClassColourSettingPrefix + "GOLD_MINERS": "#123456"})
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("unexpected response %d", response.Code)
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM settings`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatal("failed request wrote a setting")
	}
}
