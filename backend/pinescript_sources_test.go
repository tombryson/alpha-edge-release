package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// Read the actual Pine alert template rather than maintaining a second payload.
func pineTMSStopPayload(t *testing.T, cdfState string) []byte {
	t.Helper()
	source, err := os.ReadFile("../DOCS/Pinescripts/TMS - Trade Management System.pine")
	if os.IsNotExist(err) {
		// Public source releases omit the private PineScript sources.
		t.Skip("PineScript sources are not included in this checkout")
	}
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(source), `cdfStateJsonValue = inBuyZone ? "BUY" : "SELL"`) {
		t.Fatal("TMS stop context must come from its embedded CDF zone")
	}
	var payload string
	count := 0
	for _, line := range strings.Split(string(source), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "alert('") || !strings.Contains(line, `"signal": "sell"`) {
			continue
		}
		count++
		const suffix = "', alert.freq_once_per_bar_close)"
		if !strings.HasSuffix(line, suffix) {
			t.Fatal("unexpected TMS stop template")
		}
		payload = strings.TrimSuffix(strings.TrimPrefix(line, "alert('"), suffix)
		payload = strings.NewReplacer(
			"' + tickerStr + '", "ASX:MODE",
			"' + priceJsonValue + '", "10",
			"' + cdfStateJsonValue + '", cdfState,
		).Replace(payload)
	}
	if count != 1 {
		t.Fatalf("expected one TMS stop emitter, got %d", count)
	}
	var fields map[string]interface{}
	if err := json.Unmarshal([]byte(payload), &fields); err != nil {
		t.Fatal(err)
	}
	if fields["script"] != "tms" || fields["signal"] != "sell" || fields["cdf_state"] != cdfState {
		t.Fatalf("unexpected stop payload: %s", payload)
	}
	return []byte(payload)
}

func TestPineTMSStopContext(t *testing.T) {
	for _, kind := range []string{"STOCK", "ETF"} {
		for _, tc := range []struct {
			name, context, baseline, alert, intent, instruction string
			waiting                                             bool
			units                                               float64
		}{
			{"buy_zone", "BUY", "SELL", "SELL_50", "REDUCE", "Sell Down 50% of current holding", true, 50},
			{"sell_zone", "SELL", "BUY", "SELL", "EXIT", "Exit remaining holding", false, 100},
			{"legacy_missing_context", "", "BUY", "SELL", "EXIT", "Exit remaining holding", true, 100},
		} {
			t.Run(kind+"/"+tc.name, func(t *testing.T) {
				defer setupSecurityActionTestDB(t)()
				if kind == "ETF" {
					seedManagedFund(t)
					if w := changeManagement(t, "tms", "etf_tms", "BUY"); w.Code != http.StatusOK {
						t.Fatal(w.Body.String())
					}
				} else {
					actionUnitsExec(t, `INSERT INTO stock_analysis(ticker, name, security_type, primary_asset_class) VALUES ('ASX:MODE', 'Mode Test Stock', 'STOCK', 'GOLD_MINERS')`)
					actionUnitsExec(t, `INSERT INTO holdings(ticker, company_name, quantity, current_price, value_aud, is_active) VALUES ('MODE', 'Mode Test Stock', 100, 10, 1000, 1)`)
				}
				setupManagedConnection(t, "cdf", tc.baseline, http.StatusOK)
				setupManagedConnection(t, "tms", "", http.StatusOK)

				context := tc.context
				if context == "" {
					context = "BUY"
				}
				payload := pineTMSStopPayload(t, context)
				if tc.context == "" {
					var legacy map[string]interface{}
					if err := json.Unmarshal(payload, &legacy); err != nil {
						t.Fatal(err)
					}
					delete(legacy, "cdf_state")
					var err error
					payload, err = json.Marshal(legacy)
					if err != nil {
						t.Fatal(err)
					}
				}

				w := httptest.NewRecorder()
				tradingViewWebhookSync(w, httptest.NewRequest(http.MethodPost, "/api/webhook/tradingview", bytes.NewReader(payload)))
				if w.Code != http.StatusOK {
					t.Fatalf("stop response = %d: %s", w.Code, w.Body.String())
				}
				var alertID int
				var alertType, state string
				var waiting bool
				if err := db.QueryRow(`SELECT id, alert_type FROM alerts WHERE ticker = 'MODE' ORDER BY id DESC LIMIT 1`).Scan(&alertID, &alertType); err != nil {
					t.Fatal(err)
				}
				if err := db.QueryRow(`SELECT position_state, stopped_waiting_reentry FROM security_positions WHERE ticker = 'MODE'`).Scan(&state, &waiting); err != nil {
					t.Fatal(err)
				}
				if alertType != tc.alert || state != "SELL" || waiting != tc.waiting {
					t.Fatalf("stop = alert %s, state %s, waiting %t", alertType, state, waiting)
				}
				var action SecurityAction
				if err := db.QueryRow(`SELECT ticker, scope, intent, instruction FROM security_actions WHERE alert_id = ?`, alertID).
					Scan(&action.Ticker, &action.Scope, &action.Intent, &action.Instruction); err != nil {
					t.Fatal(err)
				}
				if action.Intent != tc.intent || action.Instruction != tc.instruction {
					t.Fatalf("projected action = %+v", action)
				}
				action.AlertType = alertType
				tx, err := db.Begin()
				if err != nil {
					t.Fatal(err)
				}
				snapshots, captureErr := captureSecurityActionUnits(tx, action, nil)
				if err := tx.Rollback(); err != nil {
					t.Fatal(err)
				}
				if captureErr != nil {
					t.Fatal(captureErr)
				}
				if len(snapshots) != 1 || snapshots[0].Expected != tc.units {
					t.Fatalf("expected reduction units = %+v, want %v", snapshots, tc.units)
				}
				var quantity float64
				if err := db.QueryRow(`SELECT quantity FROM holdings WHERE ticker = 'MODE'`).Scan(&quantity); err != nil {
					t.Fatal(err)
				}
				if quantity != 100 {
					t.Fatalf("signal changed broker holdings: %v", quantity)
				}
			})
		}
	}
}
