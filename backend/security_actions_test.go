package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/gorilla/mux"
)

func setupSecurityActionTestDB(t *testing.T) func() {
	t.Helper()

	previousDB := db
	testDB, err := sql.Open("sqlite3", "file:security_actions_test?mode=memory&cache=shared")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}

	db = testDB
	initDB()
	return func() {
		db = previousDB
		testDB.Close()
	}
}

func insertSecurityActionTestAlert(t *testing.T, ticker, alertType string) int {
	t.Helper()
	result, err := db.Exec(`
		INSERT INTO alerts (ticker, alert_type, strength, source, is_active)
		VALUES (?, ?, 'MEDIUM', 'tms', 1)
	`, ticker, alertType)
	if err != nil {
		t.Fatalf("insert %s alert: %v", alertType, err)
	}
	alertID, err := result.LastInsertId()
	if err != nil {
		t.Fatalf("read %s alert id: %v", alertType, err)
	}
	if err := ensureSecurityActionForAlertID(int(alertID)); err != nil {
		t.Fatalf("project %s alert: %v", alertType, err)
	}
	return int(alertID)
}

func actionForAlertID(t *testing.T, alertID int) (id int, status string, blockedBy sql.NullInt64) {
	t.Helper()
	err := db.QueryRow(`
		SELECT id, status, blocked_by_action_id
		FROM security_actions
		WHERE alert_id = ?
	`, alertID).Scan(&id, &status, &blockedBy)
	if err != nil {
		t.Fatalf("read action for alert %d: %v", alertID, err)
	}
	return id, status, blockedBy
}

func TestCommodityRawSellDoesNotEnterSecurityActionQueue(t *testing.T) {
	if _, ok := securityActionSpecForAlert("SELL", "ctf"); ok {
		t.Fatal("raw commodity SELL must not create a producer-equity action")
	}
	if spec, ok := securityActionSpecForAlert("EQUITY_REGIME_STRONG_TRIM", "ctf"); !ok || spec.Scope != "ASSET_CLASS" || spec.Intent != "REDUCE" {
		t.Fatalf("equity regime action spec = %#v, %v", spec, ok)
	}
}

func TestSecurityActionQueuePrioritisesExitAndPreservesEarlierInstructions(t *testing.T) {
	cleanup := setupSecurityActionTestDB(t)
	defer cleanup()

	if _, err := db.Exec(`
		INSERT INTO holdings (ticker, company_name, quantity, current_price, value_aud, is_active)
		VALUES ('AEVT', 'Alpha Event Test', 100, 10, 1000, 1)
	`); err != nil {
		t.Fatalf("seed holding: %v", err)
	}

	addAlertID := insertSecurityActionTestAlert(t, "ASX:AEVT", "ADD")
	reduceAlertID := insertSecurityActionTestAlert(t, "ASX:AEVT", "SELL_DOWN")
	exitAlertID := insertSecurityActionTestAlert(t, "ASX:AEVT", "SELL")

	if err := refreshSecurityActionQueue(); err != nil {
		t.Fatalf("refresh queue: %v", err)
	}

	exitActionID, exitStatus, exitBlockedBy := actionForAlertID(t, exitAlertID)
	if exitStatus != securityActionOpen || exitBlockedBy.Valid {
		t.Fatalf("Exit action = status %q blocked by %v; want open unblocked", exitStatus, exitBlockedBy)
	}

	for _, alertID := range []int{addAlertID, reduceAlertID} {
		_, status, blockedBy := actionForAlertID(t, alertID)
		if status != securityActionBlocked {
			t.Fatalf("alert %d action status = %q, want %q", alertID, status, securityActionBlocked)
		}
		if !blockedBy.Valid || int(blockedBy.Int64) != exitActionID {
			t.Fatalf("alert %d action blocked by %v, want Exit action %d", alertID, blockedBy, exitActionID)
		}
	}

	listRequest := httptest.NewRequest(http.MethodGet, "/api/security-actions?ticker=ASX:AEVT", nil)
	listResponse := httptest.NewRecorder()
	getSecurityActions(listResponse, listRequest)
	if listResponse.Code != http.StatusOK {
		t.Fatalf("list action queue status = %d: %s", listResponse.Code, listResponse.Body.String())
	}
	var actions []SecurityAction
	if err := json.NewDecoder(listResponse.Body).Decode(&actions); err != nil {
		t.Fatalf("decode action queue: %v", err)
	}
	if len(actions) != 3 {
		t.Fatalf("queue length = %d, want 3", len(actions))
	}
	if !actions[0].IsPrimary || actions[0].AlertID != exitAlertID || actions[0].QueueCount != 3 {
		t.Fatalf("primary queue response = %#v, want Exit primary with queue count 3", actions[0])
	}

	record := httptest.NewRequest(http.MethodPost, "/api/security-actions/1/ignore", nil)
	record = mux.SetURLVars(record, map[string]string{"id": stringInt(exitActionID)})
	response := httptest.NewRecorder()
	ignoreSecurityAction(response, record)
	if response.Code != http.StatusConflict {
		t.Fatalf("ignore Exit status = %d, want %d: %s", response.Code, http.StatusConflict, response.Body.String())
	}
}

func TestSecurityActionQueueRetiresInactiveSourceAlert(t *testing.T) {
	cleanup := setupSecurityActionTestDB(t)
	defer cleanup()

	staleExitAlertID := insertSecurityActionTestAlert(t, "ASX:AEVT", "SELL")
	currentAddAlertID := insertSecurityActionTestAlert(t, "ASX:AEVT", "ADD")
	if err := refreshSecurityActionQueue(); err != nil {
		t.Fatalf("initial refresh queue: %v", err)
	}

	staleExitActionID, staleStatus, _ := actionForAlertID(t, staleExitAlertID)
	if staleStatus != securityActionOpen {
		t.Fatalf("stale Exit action status = %q, want %q", staleStatus, securityActionOpen)
	}
	_, currentStatus, currentBlockedBy := actionForAlertID(t, currentAddAlertID)
	if currentStatus != securityActionBlocked || !currentBlockedBy.Valid || int(currentBlockedBy.Int64) != staleExitActionID {
		t.Fatalf("current Add = status %q blocked by %v, want blocked by stale Exit %d", currentStatus, currentBlockedBy, staleExitActionID)
	}

	if _, err := db.Exec(`
		UPDATE alerts
		SET is_active = 0, resolved_reason = 'SIMULATOR_RESET'
		WHERE id = ?
	`, staleExitAlertID); err != nil {
		t.Fatalf("retire stale source alert: %v", err)
	}
	if err := refreshSecurityActionQueue(); err != nil {
		t.Fatalf("refresh after source alert retirement: %v", err)
	}

	_, staleStatus, staleBlockedBy := actionForAlertID(t, staleExitAlertID)
	if staleStatus != securityActionNotApplicable || staleBlockedBy.Valid {
		t.Fatalf("retired simulator action = status %q blocked by %v, want %q and unblocked", staleStatus, staleBlockedBy, securityActionNotApplicable)
	}
	_, currentStatus, currentBlockedBy = actionForAlertID(t, currentAddAlertID)
	if currentStatus != securityActionOpen || currentBlockedBy.Valid {
		t.Fatalf("current Add = status %q blocked by %v, want open and unblocked", currentStatus, currentBlockedBy)
	}
}

func TestSecurityActionQueueExpiresOrdinaryInactiveSourceAlert(t *testing.T) {
	cleanup := setupSecurityActionTestDB(t)
	defer cleanup()

	alertID := insertSecurityActionTestAlert(t, "ASX:AEVT", "ADD")
	if _, err := db.Exec(`UPDATE alerts SET is_active = 0 WHERE id = ?`, alertID); err != nil {
		t.Fatalf("retire source alert: %v", err)
	}
	if err := refreshSecurityActionQueue(); err != nil {
		t.Fatalf("refresh queue: %v", err)
	}

	_, status, blockedBy := actionForAlertID(t, alertID)
	if status != securityActionExpired || blockedBy.Valid {
		t.Fatalf("expired source action = status %q blocked by %v, want %q and unblocked", status, blockedBy, securityActionExpired)
	}
}

func TestExitGateProjectsExistingAlertBeforeDismissal(t *testing.T) {
	cleanup := setupSecurityActionTestDB(t)
	defer cleanup()

	result, err := db.Exec(`
		INSERT INTO alerts (ticker, alert_type, strength, source, is_active)
		VALUES ('ASX:AEVT', 'SELL', 'MEDIUM', 'tms', 1)
	`)
	if err != nil {
		t.Fatalf("seed legacy Exit alert: %v", err)
	}
	alertID, err := result.LastInsertId()
	if err != nil {
		t.Fatalf("read legacy Exit alert id: %v", err)
	}

	request := httptest.NewRequest(http.MethodPost, "/api/alerts/dismiss", nil)
	request = mux.SetURLVars(request, map[string]string{"id": stringInt(int(alertID))})
	response := httptest.NewRecorder()
	dismissAlert(response, request)
	if response.Code != http.StatusConflict {
		t.Fatalf("dismiss existing Exit status = %d, want %d: %s", response.Code, http.StatusConflict, response.Body.String())
	}

	var projected int
	if err := db.QueryRow(`SELECT COUNT(*) FROM security_actions WHERE alert_id = ?`, alertID).Scan(&projected); err != nil {
		t.Fatalf("read projected action: %v", err)
	}
	if projected != 1 {
		t.Fatalf("projected actions = %d, want 1", projected)
	}
}

func TestExitDoesNotExpireThroughGenericAlertExpiry(t *testing.T) {
	cleanup := setupSecurityActionTestDB(t)
	defer cleanup()

	alertID := insertSecurityActionTestAlert(t, "ASX:AEVT", "SELL")
	if _, err := db.Exec(`
		UPDATE alerts
		SET expiry_date = datetime('now', '-1 day')
		WHERE id = ?
	`, alertID); err != nil {
		t.Fatalf("expire test Exit alert: %v", err)
	}

	resolveExpiredAlerts()
	var active bool
	if err := db.QueryRow(`SELECT is_active FROM alerts WHERE id = ?`, alertID).Scan(&active); err != nil {
		t.Fatalf("read Exit alert: %v", err)
	}
	if !active {
		t.Fatal("generic expiry resolved an Exit alert")
	}
	_, status, _ := actionForAlertID(t, alertID)
	if status != securityActionOpen {
		t.Fatalf("Exit action status = %q, want %q", status, securityActionOpen)
	}
}

func TestExitOverrideRemainsPrimaryAndBlocksLaterActions(t *testing.T) {
	cleanup := setupSecurityActionTestDB(t)
	defer cleanup()

	if _, err := db.Exec(`
		INSERT INTO holdings (ticker, company_name, quantity, current_price, value_aud, is_active)
		VALUES ('AEVT', 'Alpha Event Test', 100, 10, 1000, 1)
	`); err != nil {
		t.Fatalf("seed holding: %v", err)
	}
	addAlertID := insertSecurityActionTestAlert(t, "ASX:AEVT", "ADD")
	exitAlertID := insertSecurityActionTestAlert(t, "ASX:AEVT", "SELL")
	if err := refreshSecurityActionQueue(); err != nil {
		t.Fatalf("refresh queue: %v", err)
	}
	exitActionID, _, _ := actionForAlertID(t, exitAlertID)

	request := httptest.NewRequest(
		http.MethodPost,
		"/api/security-actions/override-exit",
		bytes.NewBufferString(`{"reason":"Awaiting a tax-lot review"}`),
	)
	request = mux.SetURLVars(request, map[string]string{"id": stringInt(exitActionID)})
	response := httptest.NewRecorder()
	overrideSecurityActionExit(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("override Exit status = %d: %s", response.Code, response.Body.String())
	}

	if err := refreshSecurityActionQueue(); err != nil {
		t.Fatalf("refresh overridden queue: %v", err)
	}
	_, exitStatus, _ := actionForAlertID(t, exitAlertID)
	if exitStatus != securityActionOverridden {
		t.Fatalf("overridden Exit status = %q, want %q", exitStatus, securityActionOverridden)
	}
	_, addStatus, addBlockedBy := actionForAlertID(t, addAlertID)
	if addStatus != securityActionBlocked || !addBlockedBy.Valid || int(addBlockedBy.Int64) != exitActionID {
		t.Fatalf("later Add = status %q blocked by %v, want blocked by overridden Exit %d", addStatus, addBlockedBy, exitActionID)
	}
}

func TestSecurityActionExecutionBlocksLaterActionsUntilStatementConfirms(t *testing.T) {
	cleanup := setupSecurityActionTestDB(t)
	defer cleanup()

	if _, err := db.Exec(`
		INSERT INTO holdings (ticker, company_name, quantity, current_price, value_aud, is_active)
		VALUES ('AEVT', 'Alpha Event Test', 100, 10, 1000, 1)
	`); err != nil {
		t.Fatalf("seed holding: %v", err)
	}
	reduceAlertID := insertSecurityActionTestAlert(t, "ASX:AEVT", "SELL_50")
	addAlertID := insertSecurityActionTestAlert(t, "ASX:AEVT", "ADD")
	if err := refreshSecurityActionQueue(); err != nil {
		t.Fatalf("refresh queue: %v", err)
	}

	reduceActionID, reduceStatus, _ := actionForAlertID(t, reduceAlertID)
	if reduceStatus != securityActionOpen {
		t.Fatalf("reduce action status = %q, want %q", reduceStatus, securityActionOpen)
	}

	record := httptest.NewRequest(
		http.MethodPost,
		"/api/security-actions/record-execution",
		bytes.NewBufferString(`{"notes":"broker order submitted"}`),
	)
	record = mux.SetURLVars(record, map[string]string{"id": stringInt(reduceActionID)})
	response := httptest.NewRecorder()
	recordSecurityActionExecution(response, record)
	if response.Code != http.StatusOK {
		t.Fatalf("record execution status = %d: %s", response.Code, response.Body.String())
	}

	if err := refreshSecurityActionQueue(); err != nil {
		t.Fatalf("refresh awaiting queue: %v", err)
	}
	_, reduceStatus, _ = actionForAlertID(t, reduceAlertID)
	if reduceStatus != securityActionAwaitingStatement {
		t.Fatalf("recorded action status = %q, want %q", reduceStatus, securityActionAwaitingStatement)
	}
	_, addStatus, addBlockedBy := actionForAlertID(t, addAlertID)
	if addStatus != securityActionBlocked || !addBlockedBy.Valid || int(addBlockedBy.Int64) != reduceActionID {
		t.Fatalf("later Add = status %q blocked by %v, want blocked by %d", addStatus, addBlockedBy, reduceActionID)
	}

	statementResult, err := db.Exec(`
		INSERT INTO account_statements (account_name, statement_date, total_value_aud, cash_aud)
		VALUES ('UAT', '2026-08-09T00:00:00Z', 500, 0)
	`)
	if err != nil {
		t.Fatalf("insert statement: %v", err)
	}
	statementID, err := statementResult.LastInsertId()
	if err != nil {
		t.Fatalf("read statement id: %v", err)
	}
	if _, err := db.Exec(`
		INSERT INTO company_mappings (company_name, ticker, exchange_prefix)
		VALUES ('Alpha Event Test', 'AEVT', 'ASX:')
	`); err != nil {
		t.Fatalf("insert mapping: %v", err)
	}
	if _, err := db.Exec(`
		INSERT INTO statement_holdings (
			statement_id, details, quantity, cost_aud, current_price, value_aud,
			gain_loss_aud, gain_loss_pct, currency, market_value, cash_reserve
		) VALUES (?, 'Alpha Event Test', 50, 5, 10, 500, 0, 0, 'AUD', 500, 0)
	`, statementID); err != nil {
		t.Fatalf("insert statement holding: %v", err)
	}

	reconcileSecurityActionsAfterStatement(statementID, 1)
	_, reduceStatus, _ = actionForAlertID(t, reduceAlertID)
	if reduceStatus != securityActionConfirmed {
		t.Fatalf("reconciled action status = %q, want %q", reduceStatus, securityActionConfirmed)
	}
	if err := refreshSecurityActionQueue(); err != nil {
		t.Fatalf("refresh confirmed queue: %v", err)
	}
	_, addStatus, addBlockedBy = actionForAlertID(t, addAlertID)
	if addStatus != securityActionOpen || addBlockedBy.Valid {
		t.Fatalf("later Add = status %q blocked by %v after confirmation; want open", addStatus, addBlockedBy)
	}
}

func seedDeploymentTicketClass(t *testing.T, cashReserve float64) {
	t.Helper()
	seedDeploymentPermissions(t)
	if _, err := db.Exec(`
		INSERT INTO account_statements (account_name, statement_date, total_value_aud, cash_aud)
		VALUES ('Policy Test', '2026-08-10T00:00:00Z', 10000, 500)
	`); err != nil {
		t.Fatalf("seed account statement: %v", err)
	}
	if _, err := db.Exec(`
		INSERT INTO asset_class_config (code, display_name, cash_reserve, stock_allocation_ratio, active)
		VALUES ('GOLD_MINERS', 'Gold Miners', ?, 0.75, 1)
		ON CONFLICT(code) DO UPDATE SET
			display_name = excluded.display_name,
			cash_reserve = excluded.cash_reserve,
			stock_allocation_ratio = excluded.stock_allocation_ratio,
			active = 1
	`, cashReserve); err != nil {
		t.Fatalf("seed Gold Miners cash reserve: %v", err)
	}
}

func seedDeploymentTicketSecurity(t *testing.T, ticker string, allocation, holdingValue float64) {
	t.Helper()
	seedDeploymentSecurityFeeds(t, ticker)
	symbol := securityActionTicker(ticker)
	if _, err := db.Exec(`
		INSERT INTO stock_analysis (ticker, name, allocation, include_in_sizing, primary_asset_class, security_type)
		VALUES (?, ?, ?, 1, 'GOLD_MINERS', 'STOCK')
	`, ticker, symbol+" Holdings", allocation); err != nil {
		t.Fatalf("seed %s analysis: %v", ticker, err)
	}
	if _, err := db.Exec(`
		INSERT INTO holdings (ticker, company_name, quantity, current_price, value_aud, is_active)
		VALUES (?, ?, 100, 5, ?, 1)
	`, symbol, symbol+" Holdings", holdingValue); err != nil {
		t.Fatalf("seed %s holding: %v", ticker, err)
	}
}

func deploymentProjectionForAlert(t *testing.T, alertID int) (state string, ticket, before, after float64) {
	t.Helper()
	err := db.QueryRow(`
		SELECT deployment_state, instruction_value, class_funding_before, class_funding_after
		FROM security_actions
		WHERE alert_id = ?
	`, alertID).Scan(&state, &ticket, &before, &after)
	if err != nil {
		t.Fatalf("read deployment projection for alert %d: %v", alertID, err)
	}
	return state, ticket, before, after
}

func TestDeploymentTicketsUseClassCashNotAlertStrength(t *testing.T) {
	cleanup := setupSecurityActionTestDB(t)
	defer cleanup()

	// The approved class has ample stock capacity with no Core selected.
	// Current direct holdings are $1,000; class cash is the binding $150.
	seedDeploymentTicketClass(t, 150)
	seedDeploymentTicketSecurity(t, "ASX:AEVT", 10, 500)
	seedDeploymentTicketSecurity(t, "ASX:BETA", 10, 500)

	weakAlertID := insertSecurityActionTestAlert(t, "ASX:AEVT", "ADD")
	strongAlertID := insertSecurityActionTestAlert(t, "ASX:BETA", "ADD")
	if _, err := db.Exec(`UPDATE alerts SET strength = 'Strong' WHERE id = ?`, strongAlertID); err != nil {
		t.Fatalf("set strong evidence: %v", err)
	}

	if err := projectOpenDeploymentActions(); err != nil {
		t.Fatalf("project deployment tickets: %v", err)
	}

	state, ticket, before, after := deploymentProjectionForAlert(t, weakAlertID)
	if state != deploymentStateFunded || ticket != 100 || before != 150 || after != 50 {
		t.Fatalf("weak add projection = %q $%.0f ($%.0f -> $%.0f), want funded $100 ($150 -> $50)", state, ticket, before, after)
	}
	state, ticket, before, after = deploymentProjectionForAlert(t, strongAlertID)
	if state != deploymentStateBelowMinimum || ticket != 0 || before != 50 || after != 50 {
		t.Fatalf("strong add projection = %q $%.0f ($%.0f -> $%.0f), want below minimum with no ticket", state, ticket, before, after)
	}
}

func TestDeploymentTicketBlocksOrdinaryAddButPermitsTMSReentry(t *testing.T) {
	cleanup := setupSecurityActionTestDB(t)
	defer cleanup()

	seedDeploymentTicketClass(t, 500)
	seedDeploymentTicketSecurity(t, "ASX:AEVT", 20, 500)
	if _, err := db.Exec(`
		INSERT INTO security_positions (ticker, position_state, stopped_waiting_reentry)
		VALUES ('AEVT', 'SELL', 1)
		ON CONFLICT(ticker) DO UPDATE SET position_state = 'SELL', stopped_waiting_reentry = 1
	`); err != nil {
		t.Fatalf("seed Sell state: %v", err)
	}

	addAlertID := insertSecurityActionTestAlert(t, "ASX:AEVT", "ADD")
	if err := projectOpenDeploymentActions(); err != nil {
		t.Fatalf("project blocked add: %v", err)
	}
	state, ticket, _, _ := deploymentProjectionForAlert(t, addAlertID)
	if state != deploymentStateCDFBlocked || ticket != 0 {
		t.Fatalf("ordinary add = %q $%.0f, want CDF-blocked with no ticket", state, ticket)
	}

	if _, err := db.Exec(`UPDATE alerts SET is_active = 0 WHERE id = ?`, addAlertID); err != nil {
		t.Fatalf("retire add alert: %v", err)
	}
	if _, err := db.Exec(`UPDATE security_actions SET status = 'IGNORED' WHERE alert_id = ?`, addAlertID); err != nil {
		t.Fatalf("retire add action: %v", err)
	}
	reentryAlertID := insertSecurityActionTestAlert(t, "ASX:AEVT", "REENTRY")
	if err := projectOpenDeploymentActions(); err != nil {
		t.Fatalf("project re-entry: %v", err)
	}
	state, ticket, before, after := deploymentProjectionForAlert(t, reentryAlertID)
	if state != deploymentStateFunded || ticket != 100 || before != 500 || after != 400 {
		t.Fatalf("re-entry = %q $%.0f ($%.0f -> $%.0f), want funded $100 ($500 -> $400)", state, ticket, before, after)
	}
}

func TestRecordExecutionRejectsUnfundedDeployment(t *testing.T) {
	cleanup := setupSecurityActionTestDB(t)
	defer cleanup()

	seedDeploymentTicketClass(t, 500)
	seedDeploymentTicketSecurity(t, "ASX:AEVT", 20, 500)
	if _, err := db.Exec(`
		INSERT INTO security_positions (ticker, position_state)
		VALUES ('AEVT', 'SELL')
		ON CONFLICT(ticker) DO UPDATE SET position_state = 'SELL'
	`); err != nil {
		t.Fatalf("seed Sell state: %v", err)
	}
	alertID := insertSecurityActionTestAlert(t, "ASX:AEVT", "ADD")
	actionID, _, _ := actionForAlertID(t, alertID)

	request := httptest.NewRequest(http.MethodPost, "/api/security-actions/record-execution", bytes.NewBufferString(`{"notes":"should be rejected"}`))
	request = mux.SetURLVars(request, map[string]string{"id": stringInt(actionID)})
	response := httptest.NewRecorder()
	recordSecurityActionExecution(response, request)
	if response.Code != http.StatusConflict {
		t.Fatalf("record unfunded deployment = %d, want %d: %s", response.Code, http.StatusConflict, response.Body.String())
	}
}

func TestSecurityActionVarianceKeepsLaterActionBlocked(t *testing.T) {
	cleanup := setupSecurityActionTestDB(t)
	defer cleanup()

	if _, err := db.Exec(`
		INSERT INTO holdings (ticker, company_name, quantity, current_price, value_aud, is_active)
		VALUES ('AEVT', 'Alpha Event Test', 100, 10, 1000, 1)
	`); err != nil {
		t.Fatalf("seed holding: %v", err)
	}
	reduceAlertID := insertSecurityActionTestAlert(t, "ASX:AEVT", "SELL_50")
	addAlertID := insertSecurityActionTestAlert(t, "ASX:AEVT", "ADD")
	if err := refreshSecurityActionQueue(); err != nil {
		t.Fatalf("refresh queue: %v", err)
	}
	reduceActionID, _, _ := actionForAlertID(t, reduceAlertID)

	record := httptest.NewRequest(
		http.MethodPost,
		"/api/security-actions/record-execution",
		bytes.NewBufferString(`{}`),
	)
	record = mux.SetURLVars(record, map[string]string{"id": stringInt(reduceActionID)})
	recordResponse := httptest.NewRecorder()
	recordSecurityActionExecution(recordResponse, record)
	if recordResponse.Code != http.StatusOK {
		t.Fatalf("record execution status = %d: %s", recordResponse.Code, recordResponse.Body.String())
	}

	statementResult, err := db.Exec(`
		INSERT INTO account_statements (account_name, statement_date, total_value_aud, cash_aud)
		VALUES ('UAT', '2026-08-10T00:00:00Z', 900, 0)
	`)
	if err != nil {
		t.Fatalf("insert statement: %v", err)
	}
	statementID, err := statementResult.LastInsertId()
	if err != nil {
		t.Fatalf("read statement id: %v", err)
	}
	if _, err := db.Exec(`
		INSERT INTO company_mappings (company_name, ticker, exchange_prefix)
		VALUES ('Alpha Event Test', 'AEVT', 'ASX:')
	`); err != nil {
		t.Fatalf("insert mapping: %v", err)
	}
	if _, err := db.Exec(`
		INSERT INTO statement_holdings (
			statement_id, details, quantity, cost_aud, current_price, value_aud,
			gain_loss_aud, gain_loss_pct, currency, market_value, cash_reserve
		) VALUES (?, 'Alpha Event Test', 90, 9, 10, 900, 0, 0, 'AUD', 900, 0)
	`, statementID); err != nil {
		t.Fatalf("insert statement holding: %v", err)
	}

	reconcileSecurityActionsAfterStatement(statementID, 1)
	if err := refreshSecurityActionQueue(); err != nil {
		t.Fatalf("refresh variance queue: %v", err)
	}
	_, reduceStatus, _ := actionForAlertID(t, reduceAlertID)
	if reduceStatus != securityActionVariance {
		t.Fatalf("reconciled action status = %q, want %q", reduceStatus, securityActionVariance)
	}
	_, addStatus, addBlockedBy := actionForAlertID(t, addAlertID)
	if addStatus != securityActionBlocked || !addBlockedBy.Valid || int(addBlockedBy.Int64) != reduceActionID {
		t.Fatalf("later Add = status %q blocked by %v, want blocked by variance %d", addStatus, addBlockedBy, reduceActionID)
	}
}

func stringInt(value int) string {
	return strconv.Itoa(value)
}
