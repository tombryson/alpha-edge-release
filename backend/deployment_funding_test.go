package main

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/gorilla/mux"
)

func fundingTestAction(t *testing.T, ticker string) (int, int) {
	t.Helper()
	seedDeploymentTicketSecurity(t, ticker, 20, 500)
	alert := insertSecurityActionTestAlert(t, ticker, "ADD")
	id, _, _ := actionForAlertID(t, alert)
	return alert, id
}

func fundingTestExecute(id int, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, "/api/security-actions/record-execution", bytes.NewBufferString(body))
	r = mux.SetURLVars(r, map[string]string{"id": fmt.Sprint(id)})
	w := httptest.NewRecorder()
	recordSecurityActionExecution(w, r)
	return w
}

func TestCashBackingRejectsOversubscribedProposalsWithoutChangingThem(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedDeploymentTicketClass(t, 5000) // Broker cash is only $500.
	alert, id := fundingTestAction(t, "ASX:AEVT")
	if err := projectOpenDeploymentActions(); err != nil {
		t.Fatal(err)
	}
	state, value, _, _ := deploymentProjectionForAlert(t, alert)
	if state != deploymentStateInsufficientFunds || value != 0 {
		t.Fatalf("oversubscribed projection: %s %v", state, value)
	}
	var reserve float64
	if err := db.QueryRow(`SELECT cash_reserve FROM asset_class_config WHERE code = 'GOLD_MINERS'`).Scan(&reserve); err != nil || reserve != 5000 {
		t.Fatalf("proposal changed: %v %v", reserve, err)
	}
	if w := fundingTestExecute(id, `{}`); w.Code != http.StatusConflict {
		t.Fatalf("unfunded execution: %d %s", w.Code, w.Body.String())
	}
	// The legacy Alert Stack path must not resolve the alert or write a decision.
	w := httptest.NewRecorder()
	createDecision(w, httptest.NewRequest(http.MethodPost, "/api/decisions",
		bytes.NewBufferString(fmt.Sprintf(`{"alert_id":%d,"decision":"ADD"}`, alert))))
	if w.Code != http.StatusConflict {
		t.Fatalf("legacy bypass: %d %s", w.Code, w.Body.String())
	}
	var count int
	var active bool
	if err := db.QueryRow(`SELECT COUNT(*) FROM decisions`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT is_active FROM alerts WHERE id = ?`, alert).Scan(&active); err != nil {
		t.Fatal(err)
	}
	if count != 0 || !active {
		t.Fatalf("rejected execution mutated history: decisions %d active %v", count, active)
	}
}

func TestCashBackingCountsOtherClassesWithoutQueuedBuys(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedDeploymentTicketClass(t, 400)
	alert, _ := fundingTestAction(t, "ASX:AEVT")
	actionUnitsExec(t, `UPDATE asset_class_config SET cash_reserve = 200 WHERE code = 'COPPER_MINERS'`)
	if err := projectOpenDeploymentActions(); err != nil {
		t.Fatal(err)
	}
	state, _, _, _ := deploymentProjectionForAlert(t, alert)
	if state != deploymentStateInsufficientFunds {
		t.Fatalf("other class reserve was ignored: %s", state)
	}
}

func TestCashBackingReservesReportedPurchasesBeforeEarlierOpenSignals(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedDeploymentTicketClass(t, 500)
	open, _ := fundingTestAction(t, "ASX:FIRST")
	_, pending := fundingTestAction(t, "ASX:LATER")
	actionUnitsExec(t, `UPDATE security_actions SET status = 'AWAITING_STATEMENT',
		asset_class_code = 'GOLD_MINERS', instruction_value = 100, execution_cash_value = 450 WHERE id = ?`, pending)
	if err := projectOpenDeploymentActions(); err != nil {
		t.Fatal(err)
	}
	state, value, _, _ := deploymentProjectionForAlert(t, open)
	if state != deploymentStateInsufficientFunds || value != 0 {
		t.Fatalf("earlier signal spent committed cash: %s %v", state, value)
	}
	// Removing classification/target cannot free an existing commitment.
	actionUnitsExec(t, `UPDATE security_actions SET asset_class_code = '', status = 'VARIANCE' WHERE id = ?`, pending)
	actionUnitsExec(t, `DELETE FROM stock_analysis WHERE ticker = 'ASX:LATER'`)
	f, err := loadDeploymentFunding(db)
	if err != nil || f.available() != 50 {
		t.Fatalf("orphan commitment: %+v %v", f, err)
	}
}

func TestCashBackingConfirmedPurchaseIsNotDebitedTwice(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedDeploymentTicketClass(t, 400)
	_, confirmed := fundingTestAction(t, "ASX:DONE")
	actionUnitsExec(t, `UPDATE account_statements SET cash_aud = 400`)
	actionUnitsExec(t, `UPDATE security_actions SET status = 'CONFIRMED',
		asset_class_code = 'GOLD_MINERS', instruction_value = 100, execution_cash_value = 100 WHERE id = ?`, confirmed)
	alert, _ := fundingTestAction(t, "ASX:NEXT")
	if err := projectOpenDeploymentActions(); err != nil {
		t.Fatal(err)
	}
	state, value, before, _ := deploymentProjectionForAlert(t, alert)
	if state != deploymentStateFunded || value != 100 || before != 400 {
		t.Fatalf("double debit: %s %v %v", state, value, before)
	}
}

func TestCashBackingPendingProceedsAndDepositsAreNotFunding(t *testing.T) {
	for _, source := range []string{"STOCK_SALE", "EXTERNAL_CAPITAL"} {
		t.Run(source, func(t *testing.T) {
			defer setupSecurityActionTestDB(t)()
			seedDeploymentTicketClass(t, 500)
			alert, _ := fundingTestAction(t, "ASX:AEVT")
			actionUnitsExec(t, `INSERT INTO cash_movements (asset_class_code, amount_delta,
				previous_cash_reserve, target_cash_reserve, source_type, status)
				VALUES ('GOLD_MINERS', 450, 50, 500, ?, 'PENDING')`, source)
			if err := projectOpenDeploymentActions(); err != nil {
				t.Fatal(err)
			}
			_, value, before, _ := deploymentProjectionForAlert(t, alert)
			if value != 0 || before != 50 {
				t.Fatalf("expected cash spent: %v %v", value, before)
			}
			// Even abundant statement cash must not auto-confirm a source claim.
			actionUnitsExec(t, `UPDATE account_statements SET cash_aud = 1000`)
			f, err := loadDeploymentFunding(db)
			if err != nil || f.ClassCash["GOLD_MINERS"] != 50 {
				t.Fatalf("pending proceeds promoted: %+v %v", f, err)
			}
			// User explicitly replaces expected funding with existing broker cash.
			w := httptest.NewRecorder()
			createCashMovement(w, httptest.NewRequest(http.MethodPost, "/api/cash-movements",
				bytes.NewBufferString(`{"asset_class_code":"GOLD_MINERS","target_cash_reserve":500,"source_type":"PORTFOLIO_CASH_TRANSFER"}`)))
			if w.Code != http.StatusOK {
				t.Fatalf("replace funding: %s", w.Body.String())
			}
			f, err = loadDeploymentFunding(db)
			if err != nil || f.ClassCash["GOLD_MINERS"] != 500 {
				t.Fatalf("explicit broker cash allocation: %+v %v", f, err)
			}
			var status string
			if err := db.QueryRow(`SELECT status FROM cash_movements WHERE source_type = ?`, source).Scan(&status); err != nil {
				t.Fatal(err)
			}
			if status != "CANCELLED" {
				t.Fatalf("source claim incorrectly confirmed: %s", status)
			}
		})
	}
}

func TestCashBackingReportedUnitsReserveLargerEstimatedCost(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedDeploymentTicketClass(t, 500)
	_, id := fundingTestAction(t, "ASX:AEVT") // $500 / 100 units = $5 AUD.
	w := fundingTestExecute(id, `{"units":50}`)
	if w.Code != http.StatusOK {
		t.Fatalf("record: %d %s", w.Code, w.Body.String())
	}
	f, err := loadDeploymentFunding(db)
	if err != nil || f.Committed != 250 || f.available() != 250 {
		t.Fatalf("reported purchase cost ignored: %+v %v", f, err)
	}
	_, other := fundingTestAction(t, "ASX:BETA")
	if w := fundingTestExecute(other, `{"units":100}`); w.Code != http.StatusConflict {
		t.Fatalf("over-cash report accepted: %d %s", w.Code, w.Body.String())
	}
}

func TestCashBackingExecutionIsSerializedAcrossCompetingBuys(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedDeploymentTicketClass(t, 500)
	ids := make([]int, 6)
	for i := range ids {
		_, ids[i] = fundingTestAction(t, fmt.Sprintf("ASX:BUY%d", i))
	}
	codes := make(chan int, len(ids))
	var wg sync.WaitGroup
	for _, id := range ids {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			codes <- fundingTestExecute(id, `{}`).Code
		}(id)
	}
	wg.Wait()
	close(codes)
	accepted := 0
	for code := range codes {
		if code == http.StatusOK {
			accepted++
		} else if code != http.StatusConflict {
			t.Fatalf("unexpected execution status: %d", code)
		}
	}
	f, err := loadDeploymentFunding(db)
	if err != nil || accepted != 5 || f.Committed != 500 {
		t.Fatalf("competing execution: accepted %d funding %+v error %v", accepted, f, err)
	}
}

func TestCashBackingClearsStaleTicketsWithoutStatement(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedDeploymentTicketClass(t, 500)
	alert, _ := fundingTestAction(t, "ASX:AEVT")
	if err := projectOpenDeploymentActions(); err != nil {
		t.Fatal(err)
	}
	actionUnitsExec(t, `DELETE FROM account_statements`)
	if err := projectOpenDeploymentActions(); err != nil {
		t.Fatal(err)
	}
	state, value, _, _ := deploymentProjectionForAlert(t, alert)
	if state == deploymentStateFunded || value != 0 {
		t.Fatalf("stale funded ticket retained: %s %v", state, value)
	}
}

func TestCashBackingUnknownLegacyPurchaseFailsClosed(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedDeploymentTicketClass(t, 500)
	_, pending := fundingTestAction(t, "ASX:OLD")
	actionUnitsExec(t, `UPDATE security_actions SET status = 'AWAITING_STATEMENT', instruction_value = 0 WHERE id = ?`, pending)
	alert, _ := fundingTestAction(t, "ASX:NEW")
	if err := projectOpenDeploymentActions(); err != nil {
		t.Fatal(err)
	}
	state, value, _, _ := deploymentProjectionForAlert(t, alert)
	if state != deploymentStateInsufficientFunds || value != 0 {
		t.Fatalf("unknown purchase treated as free cash: %s %v", state, value)
	}
}

func TestCashBackingLegacyFundedBuyUsesAtomicExecution(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedDeploymentTicketClass(t, 500)
	alert, _ := fundingTestAction(t, "ASX:AEVT")
	w := httptest.NewRecorder()
	createDecision(w, httptest.NewRequest(http.MethodPost, "/api/decisions",
		bytes.NewBufferString(fmt.Sprintf(`{"alert_id":%d,"decision":"ADD"}`, alert))))
	if w.Code != http.StatusOK {
		t.Fatalf("legacy funded execution: %d %s", w.Code, w.Body.String())
	}
	f, err := loadDeploymentFunding(db)
	if err != nil || f.Committed != 100 {
		t.Fatalf("legacy execution not reserved: %+v %v", f, err)
	}
}

func TestCashBackingExecutionRollsBackOnWriteFailure(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedDeploymentTicketClass(t, 500)
	alert, id := fundingTestAction(t, "ASX:AEVT")
	actionUnitsExec(t, `CREATE TRIGGER fail_execution BEFORE UPDATE OF execution_cash_value ON security_actions
		BEGIN SELECT RAISE(ABORT, 'test write failure'); END`)
	if w := fundingTestExecute(id, `{}`); w.Code != http.StatusInternalServerError {
		t.Fatalf("write failure: %d %s", w.Code, w.Body.String())
	}
	var decisions int
	var active bool
	if err := db.QueryRow(`SELECT COUNT(*) FROM decisions`).Scan(&decisions); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT is_active FROM alerts WHERE id = ?`, alert).Scan(&active); err != nil {
		t.Fatal(err)
	}
	f, err := loadDeploymentFunding(db)
	if err != nil || f.Committed != 0 || decisions != 0 || !active {
		t.Fatalf("partial execution persisted: %+v %v decisions %d active %v", f, err, decisions, active)
	}
}

func TestCashBackingPendingFundingRevisions(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedDeploymentTicketClass(t, 500)
	for _, tc := range []struct{ target, usable float64 }{
		{800, 500}, {600, 500}, {100, 100}, {400, 100},
	} {
		w := httptest.NewRecorder()
		createCashMovement(w, httptest.NewRequest(http.MethodPost, "/api/cash-movements",
			bytes.NewBufferString(fmt.Sprintf(`{"asset_class_code":"GOLD_MINERS","target_cash_reserve":%v,"source_type":"STOCK_SALE"}`, tc.target))))
		if w.Code != http.StatusOK {
			t.Fatalf("revise proposal: %s", w.Body.String())
		}
		f, err := loadDeploymentFunding(db)
		if err != nil || f.ClassCash["GOLD_MINERS"] != tc.usable {
			t.Fatalf("target %v: usable %v want %v (%v)", tc.target, f.ClassCash["GOLD_MINERS"], tc.usable, err)
		}
	}
}
