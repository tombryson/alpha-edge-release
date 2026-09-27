package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func exchangeTestDB(t *testing.T) {
	t.Helper()
	cleanup := setupAnalysisTestDB(t)
	t.Cleanup(cleanup)
	db.SetMaxOpenConns(1)
	previous := exchangeLookup
	t.Cleanup(func() { exchangeLookup = previous })
	exchangeLookup = func(context.Context, exchangeSecurity) (exchangeMatch, error) {
		return exchangeMatch{Prefix: "ASX:", Source: "test listing"}, nil
	}
}

func exchangeSQL(t *testing.T, statement string, args ...any) int64 {
	t.Helper()
	result, err := db.Exec(statement, args...)
	if err != nil {
		t.Fatal(err)
	}
	id, _ := result.LastInsertId()
	return id
}

func assignExchangeRequest(t *testing.T, body string) []exchangeAssignmentResult {
	t.Helper()
	response := httptest.NewRecorder()
	autoAssignExchanges(response, httptest.NewRequest(http.MethodPost, "/api/analysis/exchanges/auto-assign", strings.NewReader(body)))
	if response.Code != http.StatusOK {
		t.Fatalf("status %d: %s", response.Code, response.Body.String())
	}
	var result struct{ Results []exchangeAssignmentResult }
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result.Results
}

func TestExchangeAssignmentPersistsLinkedRecordsAndIsIdempotent(t *testing.T) {
	exchangeTestDB(t)
	exchangeSQL(t, `INSERT INTO holdings (id, company_name, ticker, exchange_prefix, quantity, value_aud, cash_reserve) VALUES (1, 'Example Limited', 'EXM', '', 12, 300, 50)`)
	exchangeSQL(t, `INSERT INTO company_mappings (company_name, ticker, exchange_prefix, template_id) VALUES ('Example Limited', 'EXM', '', 'custom-template')`)
	exchangeSQL(t, `INSERT INTO stock_analysis (id, name, ticker, allocation, primary_asset_class, security_type) VALUES (1, 'Example Limited', 'EXM', 15, 'GOLD_MINERS', 'ETF')`)
	result := assignExchangeRequest(t, `{"items":[{"kind":"holding","id":1}]}`)[0]
	if result.Status != "assigned" || result.Prefix != "ASX:" {
		t.Fatalf("result=%+v", result)
	}
	var prefix, ticker, template, class, securityType string
	var quantity, value, cash, allocation float64
	var holdingID, analysisID, mappingID int64
	if err := db.QueryRow(`SELECT exchange_prefix, quantity, value_aud, cash_reserve, security_id FROM holdings WHERE id=1`).Scan(&prefix, &quantity, &value, &cash, &holdingID); err != nil {
		t.Fatal(err)
	}
	if prefix != "ASX:" || quantity != 12 || value != 300 || cash != 50 {
		t.Fatalf("holding changed unexpectedly %s/%f/%f/%f", prefix, quantity, value, cash)
	}
	if err := db.QueryRow(`SELECT ticker, allocation, primary_asset_class, security_type, security_id FROM stock_analysis WHERE id=1`).Scan(&ticker, &allocation, &class, &securityType, &analysisID); err != nil {
		t.Fatal(err)
	}
	if ticker != "ASX:EXM" || allocation != 15 || class != "GOLD_MINERS" || securityType != "ETF" {
		t.Fatalf("research changed unexpectedly %s/%f/%s/%s", ticker, allocation, class, securityType)
	}
	if err := db.QueryRow(`SELECT exchange_prefix, template_id, security_id FROM company_mappings WHERE company_name='Example Limited'`).Scan(&prefix, &template, &mappingID); err != nil {
		t.Fatal(err)
	}
	if prefix != "ASX:" || template != "custom-template" || holdingID == 0 || holdingID != analysisID || analysisID != mappingID {
		t.Fatalf("mapping/identity mismatch %s/%s/%d/%d/%d", prefix, template, holdingID, analysisID, mappingID)
	}
	if got := assignExchangeRequest(t, `{"items":[{"kind":"holding","id":1}]}`)[0]; got.Status != "skipped" {
		t.Fatalf("repeat overwrote assignment: %+v", got)
	}
}

func TestExchangeAssignmentWatchlistExternalAndPartialResults(t *testing.T) {
	exchangeTestDB(t)
	exchangeSQL(t, `INSERT INTO stock_analysis (id, name, ticker, is_watchlist, is_external) VALUES (1,'Watch Limited','WAT',1,0), (2,'External Limited','EXT',0,1), (3,'Missing Limited','',1,0), (4,'Existing Limited','NASDAQ:EXT',1,0), (5,'Ambiguous Limited','AMB',1,0)`)
	exchangeLookup = func(_ context.Context, s exchangeSecurity) (exchangeMatch, error) {
		if s.Ticker == "AMB" {
			return exchangeMatch{}, errors.New("Multiple listings")
		}
		return exchangeMatch{Prefix: "NASDAQ:", Source: "test"}, nil
	}
	results := assignExchangeRequest(t, `{"items":[{"kind":"analysis","id":1},{"kind":"analysis","id":2},{"kind":"analysis","id":3},{"kind":"analysis","id":4},{"kind":"analysis","id":5}]}`)
	for i, want := range []string{"assigned", "assigned", "review", "skipped", "review"} {
		if results[i].Status != want {
			t.Fatalf("result %d = %+v want %s", i, results[i], want)
		}
	}
}

func TestExchangeAssignmentReusesLocalIdentityWithoutProvider(t *testing.T) {
	exchangeTestDB(t)
	id := exchangeSQL(t, `INSERT INTO security_identities (exchange_prefix,ticker,canonical_name) VALUES ('TSXV:','EXM','Example Limited')`)
	exchangeSQL(t, `INSERT INTO stock_analysis (id,name,ticker,security_id,is_watchlist) VALUES (1,'Example Limited','EXM',?,1)`, id)
	exchangeLookup = func(context.Context, exchangeSecurity) (exchangeMatch, error) {
		panic("provider should not be called")
	}
	result := assignExchangeRequest(t, `{"items":[{"kind":"analysis","id":1}]}`)[0]
	if result.Status != "assigned" || result.Prefix != "TSXV:" || result.Source != "existing records" {
		t.Fatalf("result=%+v", result)
	}
}

func TestExchangeAssignmentConflictsAndRacesNeverOverwrite(t *testing.T) {
	for _, scenario := range []string{"dual-local", "identity-collision", "changed-during-lookup", "renamed-during-lookup", "analysis-duplicate"} {
		t.Run(scenario, func(t *testing.T) {
			exchangeTestDB(t)
			exchangeSQL(t, `INSERT INTO stock_analysis(id,name,ticker,is_watchlist) VALUES (1,'Example Limited','EXM',1)`)
			switch scenario {
			case "dual-local":
				exchangeSQL(t, `INSERT INTO holdings(company_name,ticker,exchange_prefix) VALUES ('Example Limited','EXM','ASX:')`)
				exchangeSQL(t, `INSERT INTO company_mappings(company_name,ticker,exchange_prefix) VALUES ('Example Limited','EXM','TSX:')`)
			case "identity-collision":
				exchangeSQL(t, `INSERT INTO security_identities(exchange_prefix,ticker,canonical_name) VALUES ('ASX:','EXM','Other Listing')`)
			case "analysis-duplicate":
				exchangeSQL(t, `INSERT INTO stock_analysis(name,ticker,is_watchlist) VALUES ('Example Limited','ASX:EXM',1)`)
			case "changed-during-lookup", "renamed-during-lookup":
				exchangeLookup = func(context.Context, exchangeSecurity) (exchangeMatch, error) {
					if scenario == "changed-during-lookup" {
						exchangeSQL(t, `UPDATE stock_analysis SET ticker='NYSE:EXM' WHERE id=1`)
					} else {
						exchangeSQL(t, `UPDATE stock_analysis SET name='Changed Limited' WHERE id=1`)
					}
					return exchangeMatch{Prefix: "ASX:", Source: "test"}, nil
				}
			}
			result := assignExchangeRequest(t, `{"items":[{"kind":"analysis","id":1}]}`)[0]
			if result.Status != "review" || result.Reason == "" {
				t.Fatalf("unsafe assignment: %+v", result)
			}
			var ticker string
			if err := db.QueryRow(`SELECT ticker FROM stock_analysis WHERE id=1`).Scan(&ticker); err != nil {
				t.Fatal(err)
			}
			want := "EXM"
			if scenario == "changed-during-lookup" {
				want = "NYSE:EXM"
			}
			if ticker != want {
				t.Fatalf("ticker=%s want=%s", ticker, want)
			}
			if scenario == "analysis-duplicate" {
				var n int
				if err := db.QueryRow(`SELECT COUNT(*) FROM company_mappings`).Scan(&n); err != nil || n != 0 {
					t.Fatalf("transaction did not roll back: %d/%v", n, err)
				}
			}
		})
	}
}

func TestExchangeAssignmentValidatesAndSerializesBatches(t *testing.T) {
	exchangeTestDB(t)
	for _, body := range []string{`{}`, `{"items":[]}`, `{"items":[{"kind":"stock","id":1}]}`, `{"items":[{"kind":"analysis","id":-1}]}`, `{"items":[{"kind":"analysis","id":1},{"kind":"analysis","id":1}]}`, `{"items":[{"kind":"analysis","id":1}],"force":true}`, `{"items":[{"kind":"analysis","id":1}]} {}`} {
		response := httptest.NewRecorder()
		autoAssignExchanges(response, httptest.NewRequest("POST", "/", strings.NewReader(body)))
		if response.Code != 400 {
			t.Fatalf("accepted %s: %d", body, response.Code)
		}
	}
	exchangeAssignmentLock.Lock()
	defer exchangeAssignmentLock.Unlock()
	response := httptest.NewRecorder()
	autoAssignExchanges(response, httptest.NewRequest("POST", "/", strings.NewReader(`{"items":[{"kind":"analysis","id":1}]}`)))
	if response.Code != 409 {
		t.Fatalf("concurrent batch status=%d", response.Code)
	}
}

type exchangeRoundTrip func(*http.Request) (*http.Response, error)

func (f exchangeRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestExchangeLookupValidatesProviderEvidence(t *testing.T) {
	for _, scenario := range []string{"exact", "dual", "wrong-name", "wrong-symbol", "wrong-exchange", "wrong-currency", "unsupported", "outage", "malformed", "cancelled", "sonar", "sonar-unverified", "sonar-ambiguous", "sonar-no-source"} {
		t.Run(scenario, func(t *testing.T) {
			previous := exchangeHTTPClient
			t.Cleanup(func() { exchangeHTTPClient = previous })
			t.Setenv("PERPLEXITY_API_KEY", "")
			if strings.HasPrefix(scenario, "sonar") {
				t.Setenv("PERPLEXITY_API_KEY", "test-key")
			}
			var sonarCalls atomic.Int32
			exchangeHTTPClient = &http.Client{Transport: exchangeRoundTrip(func(r *http.Request) (*http.Response, error) {
				if scenario == "cancelled" {
					return nil, context.Canceled
				}
				status := 200
				body := `{"quotes":[{"symbol":"EXM.AX","exchange":"ASX","longname":"Example Ltd","quoteType":"EQUITY"}]}`
				if scenario == "dual" {
					body = `{"quotes":[{"symbol":"EXM.AX","exchange":"ASX","longname":"Example Ltd","quoteType":"EQUITY"},{"symbol":"EXM.TO","exchange":"TOR","longname":"Example Ltd","quoteType":"EQUITY"}]}`
				}
				if scenario == "unsupported" {
					body = `{"quotes":[{"symbol":"EXM","exchange":"UNKNOWN","longname":"Example Ltd","quoteType":"EQUITY"}]}`
				}
				if strings.HasPrefix(scenario, "sonar") {
					body = `{"quotes":[]}`
				}
				if r.URL.Host == "api.perplexity.ai" {
					sonarCalls.Add(1)
					if r.Header.Get("Authorization") != "Bearer test-key" {
						t.Error("missing Sonar credential")
					}
					body = `{"choices":[{"message":{"content":"{\"ticker\":\"EXM\",\"exchange\":\"ASX\",\"ambiguous\":false}"}}],"citations":["https://example.com/listing"]}`
					if scenario == "sonar-ambiguous" {
						body = strings.Replace(body, "false", "true", 1)
					}
					if scenario == "sonar-no-source" {
						body = strings.Replace(body, `["https://example.com/listing"]`, `[]`, 1)
					}
				}
				if strings.Contains(r.URL.Path, "/chart/") {
					body = `{"chart":{"result":[{"meta":{"symbol":"EXM.AX","exchangeName":"ASX","longName":"Example Limited","currency":"AUD","instrumentType":"EQUITY"}}]}}`
					switch scenario {
					case "wrong-name", "sonar-unverified":
						body = strings.Replace(body, "Example Limited", "Another Limited", 1)
					case "wrong-symbol":
						body = strings.Replace(body, "EXM.AX", "OTHER.AX", 1)
					case "wrong-exchange":
						body = strings.Replace(body, "ASX", "TOR", 1)
					case "wrong-currency":
						body = strings.Replace(body, "AUD", "CAD", 1)
					}
				}
				if scenario == "outage" {
					status = 429
				}
				if scenario == "malformed" {
					body = "not json"
				}
				return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
			})}
			match, err := lookupMissingExchange(context.Background(), exchangeSecurity{Name: "Example Limited", Ticker: "EXM", Currency: "AUD"})
			if scenario == "exact" || scenario == "sonar" {
				if err != nil || match.Prefix != "ASX:" {
					t.Fatalf("match=%+v error=%v", match, err)
				}
			} else if err == nil {
				t.Fatalf("unsafe match=%+v", match)
			}
			if scenario == "sonar" && sonarCalls.Load() != 1 {
				t.Fatalf("Sonar calls=%d", sonarCalls.Load())
			}
		})
	}
}
