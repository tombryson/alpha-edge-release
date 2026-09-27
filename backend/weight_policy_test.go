package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/gorilla/mux"
)

func seedWeightPolicy(t *testing.T) {
	t.Helper()
	t.Setenv("COUNCIL_API_TOKEN", "")
	seedDeploymentTicketClass(t, 500)
	seedDeploymentTicketSecurity(t, "ASX:AEVT", 1, 1500)
	seedDeploymentTicketSecurity(t, "ASX:BETA", 99, 200)
	actionUnitsExec(t, `UPDATE portfolio_mix_snapshot_rows SET weight_pct=20`)
	actionUnitsExec(t, `UPDATE account_statements SET statement_date=?`, time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02"))
	actionUnitsExec(t, `UPDATE stock_analysis SET gemini_quality=70,gemini_value=70,gemini_pt=10,current_price=5,include_in_sizing=0`)
}

func nextWeightStatement(t *testing.T) {
	t.Helper()
	actionUnitsExec(t, `INSERT INTO account_statements(account_name,statement_date,total_value_aud,cash_aud) VALUES('Policy Test',?,10000,500)`, time.Now().UTC().Format("2006-01-02"))
}

func weightActionCount(t *testing.T) int {
	t.Helper()
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM security_actions sa JOIN alerts a ON a.id=sa.alert_id WHERE a.alert_type='WEIGHT_REDUCE'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func setTestWeightMode(t *testing.T, enabled bool) {
	t.Helper()
	mode, err := readWeightPolicy(db)
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	updateWeightPolicy(w, httptest.NewRequest(http.MethodPatch, "/api/weight-policy", bytes.NewBufferString(fmt.Sprintf(`{"enabled":%t,"epoch":%d}`, enabled, mode.Epoch))))
	if w.Code != 200 {
		t.Fatalf("change policy: %d %s", w.Code, w.Body.String())
	}
}

func TestWeightReferenceUsesHeldResearchNotStoredAllocation(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedWeightPolicy(t)
	seedDeploymentTicketSecurity(t, "ASX:WATCH", 90, 0)
	actionUnitsExec(t, `UPDATE holdings SET quantity=0 WHERE ticker='WATCH'`)
	actionUnitsExec(t, `UPDATE stock_analysis SET gemini_quality=99,gemini_value=99,gemini_pt=100,current_price=1 WHERE ticker='ASX:WATCH'`)
	capacities, err := deploymentClassCapacities()
	if err != nil {
		t.Fatal(err)
	}
	refs, err := weightReferencesFrom(db, capacities, "")
	if err != nil {
		t.Fatal(err)
	}
	assertBudgetValue(t, "held A ideal", refs["AEVT"].Ideal, 1000)
	assertBudgetValue(t, "held B ideal", refs["BETA"].Ideal, 1000)
	if _, ok := refs["WATCH"]; ok {
		t.Fatal("watchlist diluted held weights")
	}
	if !refs["AEVT"].Available {
		t.Fatalf("OUT holding lost research: %+v", refs["AEVT"])
	}
	prospective, err := weightReferencesFrom(db, capacities, "ASX:WATCH")
	if err != nil {
		t.Fatal(err)
	}
	if prospective["WATCH"].Ideal <= refs["AEVT"].Ideal {
		t.Fatal("prospective candidate was not included")
	}
}

func TestWeightOffRemovesLegacyCeilingButRetainsClassBudget(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedWeightPolicy(t)
	mode, err := readWeightPolicy(db)
	if err != nil || mode.Enabled {
		t.Fatalf("default mode: %+v %v", mode, err)
	}
	alert := insertSecurityActionTestAlert(t, "ASX:AEVT", "ADD")
	assertDeploymentState(t, alert, deploymentStateFunded)
	setTestWeightMode(t, true)
	assertDeploymentState(t, alert, "WEIGHT_LIMIT")
	setTestWeightMode(t, false)
	assertDeploymentState(t, alert, deploymentStateFunded)
	actionUnitsExec(t, `UPDATE holdings SET value_aud=1900 WHERE ticker='AEVT'`)
	assertDeploymentState(t, alert, "CAPACITY_REACHED")
	actionUnitsExec(t, `UPDATE holdings SET value_aud=1500 WHERE ticker='AEVT';UPDATE q4_crisis_state SET active=1`)
	assertDeploymentState(t, alert, "Q4_BLOCKED")
}

func TestWeightObservationDatesAndSingleProposal(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedWeightPolicy(t)
	setTestWeightMode(t, true)
	for i := 0; i < 4; i++ {
		if err := projectOpenDeploymentActions(); err != nil {
			t.Fatal(err)
		}
	}
	if weightActionCount(t) != 0 {
		t.Fatal("polls counted as days")
	}
	nextWeightStatement(t)
	for i := 0; i < 4; i++ {
		if err := projectOpenDeploymentActions(); err != nil {
			t.Fatal(err)
		}
	}
	if weightActionCount(t) != 1 {
		t.Fatalf("wanted one proposal, got %d", weightActionCount(t))
	}
	var amount float64
	if err := db.QueryRow(`SELECT instruction_value FROM security_actions WHERE intent='REDUCE'`).Scan(&amount); err != nil {
		t.Fatal(err)
	}
	assertBudgetValue(t, "stock reduces to 125%", amount, 250)
	w := httptest.NewRecorder()
	getSecurityActions(w, httptest.NewRequest("GET", "/api/security-actions", nil))
	if w.Code != 200 {
		t.Fatalf("actions: %d %s", w.Code, w.Body.String())
	}
	var actions []SecurityAction
	if err := json.Unmarshal(w.Body.Bytes(), &actions); err != nil {
		t.Fatal(err)
	}
	if len(actions) != 1 || actions[0].Source != "weight_policy" || actions[0].WeightEvidence == nil {
		t.Fatalf("missing policy evidence: %+v", actions)
	}
	ignoreSecurityAction(httptest.NewRecorder(), mux.SetURLVars(httptest.NewRequest("POST", "/ignore", nil), map[string]string{"id": fmt.Sprint(actions[0].ID)}))
	if err := projectOpenDeploymentActions(); err != nil {
		t.Fatal(err)
	}
	if weightActionCount(t) != 1 {
		t.Fatal("dismissed proposal reappeared")
	}
}

func TestWeightThresholdsMaterialityAndMissingData(t *testing.T) {
	for _, tc := range []struct {
		name, role         string
		held, ideal, total float64
		fresh, available   bool
		missing            int
		want               bool
	}{
		{"stock boundary", "STOCK", 1500, 1000, 50000, true, true, 0, true},
		{"stock under", "STOCK", 1499, 1000, 50000, true, true, 0, false},
		{"ETF boundary", "CORE_ETF", 1250, 1000, 50000, true, true, 0, true},
		{"non-Core", "ETF", 1250, 1000, 50000, true, true, 0, false},
		{"small sale", "STOCK", 150, 100, 50000, true, true, 0, false},
		{"no target", "STOCK", 1500, 0, 50000, true, false, 0, false},
		{"stale", "STOCK", 1500, 1000, 50000, false, true, 0, false},
		{"incomplete peers", "STOCK", 1500, 1000, 50000, true, true, 1, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			destination := 1.25
			if tc.role == "CORE_ETF" {
				destination = 1
			}
			r := weightReference{Role: tc.role, Held: tc.held, Ideal: tc.ideal, Coverage: tc.held / tc.ideal, Reduction: tc.held - destination*tc.ideal, PortfolioValue: tc.total, Fresh: tc.fresh, Available: tc.available, ResearchMissing: tc.missing}
			if got := weightQualifies(r); got != tc.want {
				t.Fatalf("qualified=%t want=%t", got, tc.want)
			}
		})
	}
}

func TestWeightMissingResearchPausesAddWithoutSuppressingExit(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedWeightPolicy(t)
	actionUnitsExec(t, `UPDATE stock_analysis SET gemini_pt=0 WHERE ticker='ASX:AEVT'`)
	setTestWeightMode(t, true)
	alert := insertSecurityActionTestAlert(t, "ASX:AEVT", "ADD")
	assertDeploymentState(t, alert, deploymentStateTargetUnavailable)
	exit := insertSecurityActionTestAlert(t, "ASX:BETA", "SELL")
	if err := projectOpenDeploymentActions(); err != nil {
		t.Fatal(err)
	}
	_, status, _ := actionForAlertID(t, exit)
	if status != "OPEN" {
		t.Fatal("exit hidden")
	}
}

func TestWeightExistingReductionWins(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedWeightPolicy(t)
	setTestWeightMode(t, true)
	nextWeightStatement(t)
	insertSecurityActionTestAlert(t, "ASX:AEVT", "SELL_DOWN")
	if err := projectOpenDeploymentActions(); err != nil {
		t.Fatal(err)
	}
	if weightActionCount(t) != 0 {
		t.Fatal("duplicate sale proposed")
	}
}

func TestWeightOffPreservesRecordedExecution(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedWeightPolicy(t)
	setTestWeightMode(t, true)
	nextWeightStatement(t)
	if err := projectOpenDeploymentActions(); err != nil {
		t.Fatal(err)
	}
	var id int
	if err := db.QueryRow(`SELECT id FROM security_actions WHERE intent='REDUCE'`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	w := fundingTestExecute(id, `{"expected_instruction_value":250}`)
	if w.Code != 200 {
		t.Fatalf("record: %d %s", w.Code, w.Body.String())
	}
	setTestWeightMode(t, false)
	var status, snapshot string
	if err := db.QueryRow(`SELECT status,execution_snapshot_json FROM security_actions WHERE id=?`, id).Scan(&status, &snapshot); err != nil {
		t.Fatal(err)
	}
	if status != "AWAITING_STATEMENT" {
		t.Fatalf("off unlocked execution: %s", status)
	}
	var units []securityActionUnitSnapshot
	if err := json.Unmarshal([]byte(snapshot), &units); err != nil {
		t.Fatal(err)
	}
	assertBudgetValue(t, "estimated reduction units", units[0].Expected, 250/15.0)
	if err := projectOpenDeploymentActions(); err != nil {
		t.Fatal(err)
	}
	if weightActionCount(t) != 1 {
		t.Fatal("duplicate awaiting trade")
	}
	setTestWeightMode(t, true)
	actionUnitsExec(t, `INSERT INTO account_statements(account_name,statement_date,total_value_aud,cash_aud) VALUES('Policy Test',?,10000,500)`, time.Now().UTC().AddDate(0, 0, 1).Format("2006-01-02"))
	if err := projectOpenDeploymentActions(); err != nil {
		t.Fatal(err)
	}
	if weightActionCount(t) != 1 {
		t.Fatal("re-enabling duplicated an unreconciled weight reduction")
	}
}

func TestWeightOptimisticModeAndStaleEvidence(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedWeightPolicy(t)
	setTestWeightMode(t, true)
	w := httptest.NewRecorder()
	updateWeightPolicy(w, httptest.NewRequest("PATCH", "/api/weight-policy", bytes.NewBufferString(`{"enabled":false,"epoch":0}`)))
	if w.Code != 409 {
		t.Fatalf("stale settings accepted: %d", w.Code)
	}
	actionUnitsExec(t, `UPDATE account_statements SET statement_date='2020-01-01'`)
	alert := insertSecurityActionTestAlert(t, "ASX:AEVT", "ADD")
	assertDeploymentState(t, alert, deploymentStateTargetUnavailable)
	if weightActionCount(t) != 0 {
		t.Fatal("stale reduction")
	}
}

func TestWeightCorrectedStatementInvalidatesConfirmation(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedWeightPolicy(t)
	setTestWeightMode(t, true)
	actionUnitsExec(t, `UPDATE account_statements SET cash_aud=501`)
	if err := projectOpenDeploymentActions(); err != nil {
		t.Fatal(err)
	}
	if weightActionCount(t) != 0 {
		t.Fatal("same-date correction counted as another day")
	}
	nextWeightStatement(t)
	if err := projectOpenDeploymentActions(); err != nil {
		t.Fatal(err)
	}
	if weightActionCount(t) != 1 {
		t.Fatal("expected confirmed proposal")
	}
	actionUnitsExec(t, `UPDATE account_statements SET total_value_aud=12000 WHERE id=(SELECT MIN(id) FROM account_statements)`)
	if err := projectOpenDeploymentActions(); err != nil {
		t.Fatal(err)
	}
	var status, reason string
	if err := db.QueryRow(`SELECT sa.status,e.closed_reason FROM security_actions sa JOIN weight_action_evidence e ON e.action_id=sa.id WHERE sa.intent='REDUCE'`).Scan(&status, &reason); err != nil {
		t.Fatal(err)
	}
	if status != "NOT_APPLICABLE" || reason != "Statement correction requires fresh confirmation" {
		t.Fatalf("invalid evidence remained executable: %s %s", status, reason)
	}
}

func TestWeightChangedAmountRequiresReview(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedWeightPolicy(t)
	setTestWeightMode(t, true)
	nextWeightStatement(t)
	if err := projectOpenDeploymentActions(); err != nil {
		t.Fatal(err)
	}
	var id int
	if err := db.QueryRow(`SELECT id FROM security_actions WHERE intent='REDUCE'`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{`{}`, `{"expected_instruction_value":249}`} {
		if w := fundingTestExecute(id, body); w.Code != 409 {
			t.Fatalf("stale amount accepted: %d %s", w.Code, w.Body.String())
		}
	}
	var decisions int
	if err := db.QueryRow(`SELECT COUNT(*) FROM decisions`).Scan(&decisions); err != nil {
		t.Fatal(err)
	}
	if decisions != 0 {
		t.Fatal("rejected review created an execution")
	}
}

func TestWeightReductionUsesExistingStatementUnitReconciliation(t *testing.T) {
	for _, tc := range []struct {
		name  string
		units float64
		want  string
	}{
		{"sale confirmed", 83.333333, "CONFIRMED"}, {"price loss is not a sale", 100, "VARIANCE"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			defer setupSecurityActionTestDB(t)()
			seedWeightPolicy(t)
			setTestWeightMode(t, true)
			nextWeightStatement(t)
			if err := projectOpenDeploymentActions(); err != nil {
				t.Fatal(err)
			}
			var id int
			if err := db.QueryRow(`SELECT id FROM security_actions WHERE intent='REDUCE'`).Scan(&id); err != nil {
				t.Fatal(err)
			}
			if w := fundingTestExecute(id, `{"expected_instruction_value":250}`); w.Code != 200 {
				t.Fatalf("%d %s", w.Code, w.Body.String())
			}
			// Keep the later evidence date distinct from the observation seeded for today.
			today := time.Now().UTC()
			actionUnitsExec(t, `UPDATE security_actions SET execution_reported_at=? WHERE id=?`, today.Format("2006-01-02 15:04:05"), id)
			statement := actionUnitsExec(t, `INSERT INTO account_statements(account_name,statement_date,total_value_aud,cash_aud) VALUES('Policy Test',?,10000,750)`, today.AddDate(0, 0, 1).Format("2006-01-02"))
			var name string
			if err := db.QueryRow(`SELECT company_name FROM holdings WHERE ticker='AEVT'`).Scan(&name); err != nil {
				t.Fatal(err)
			}
			actionUnitsExec(t, `INSERT INTO statement_holdings(statement_id,details,quantity,cost_aud,current_price,value_aud,gain_loss_aud,gain_loss_pct,market_value) VALUES(?,?,?,1000,15,1250,0,0,1250)`, statement, name, tc.units)
			reconcileSecurityActionsAfterStatement(statement, 100)
			var status string
			if err := db.QueryRow(`SELECT status FROM security_actions WHERE id=?`, id).Scan(&status); err != nil {
				t.Fatal(err)
			}
			if status != tc.want {
				t.Fatalf("got %s want %s", status, tc.want)
			}
		})
	}
}

func TestWeightObservationsSurviveDatabaseReopen(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedWeightPolicy(t)
	setTestWeightMode(t, true)
	path := filepath.Join(t.TempDir(), "restarted.db")
	actionUnitsExec(t, `VACUUM INTO ?`, path)
	original := db
	reopened, err := sql.Open("sqlite3", path)
	if err != nil {
		t.Fatal(err)
	}
	db = reopened
	defer func() { db = original; reopened.Close() }()
	mode, err := readWeightPolicy(db)
	if err != nil || !mode.Enabled || mode.Epoch != 1 {
		t.Fatalf("lost persisted mode: %+v %v", mode, err)
	}
	if err = projectOpenDeploymentActions(); err != nil {
		t.Fatal(err)
	}
	if weightActionCount(t) != 0 {
		t.Fatal("restart invented another day")
	}
	nextWeightStatement(t)
	if err = projectOpenDeploymentActions(); err != nil {
		t.Fatal(err)
	}
	if weightActionCount(t) != 1 {
		t.Fatal("restart lost first observation")
	}
}

func TestWeightPausedPurchaseStillAcceptsTruthfulException(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedWeightPolicy(t)
	setTestWeightMode(t, true)
	alert := insertSecurityActionTestAlert(t, "ASX:AEVT", "ADD")
	assertDeploymentState(t, alert, "WEIGHT_LIMIT")
	id, _, _ := actionForAlertID(t, alert)
	if w := fundingTestExecute(id, `{}`); w.Code != 409 {
		t.Fatalf("unfunded normal purchase accepted %d", w.Code)
	}
	if w := fundingTestExecute(id, `{"units":1,"cash_value":15,"exception_reason":"Executed at broker before checking the weight limit"}`); w.Code != 200 {
		t.Fatalf("truthful exception denied: %d %s", w.Code, w.Body.String())
	}
	_, status, _ := actionForAlertID(t, alert)
	if status != "AWAITING_STATEMENT" {
		t.Fatal(status)
	}
}

func TestWeightMissingDataDoesNotHideIndependentExit(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedWeightPolicy(t)
	setTestWeightMode(t, true)
	add := insertSecurityActionTestAlert(t, "ASX:AEVT", "ADD")
	exit := insertSecurityActionTestAlert(t, "ASX:BETA", "SELL")
	actionUnitsExec(t, `DROP TABLE security_price_daily`)
	assertDeploymentState(t, add, deploymentStateTargetUnavailable)
	_, status, _ := actionForAlertID(t, exit)
	if status != "OPEN" {
		t.Fatalf("independent exit lost: %s", status)
	}
}

func TestWeightIncompletePeerSuppressesReduction(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedWeightPolicy(t)
	actionUnitsExec(t, `UPDATE stock_analysis SET gemini_pt=0 WHERE ticker='ASX:BETA'`)
	capacities, err := deploymentClassCapacities()
	if err != nil {
		t.Fatal(err)
	}
	refs, err := weightReferencesFrom(db, capacities, "")
	if err != nil {
		t.Fatal(err)
	}
	if refs["AEVT"].ResearchMissing != 1 {
		t.Fatal("peer gap not retained")
	}
	for _, ticker := range []string{"AEVT", "BETA"} {
		ref := refs[ticker]
		if ref.Available || ref.Ideal != 0 || ref.Percent != 0 || ref.Reduction != 0 || ref.Reason == "" {
			t.Fatalf("partial class exposed a recommendation: %+v", ref)
		}
	}
	ideal, room, err := weightTargetFrom(db, "ASX:AEVT", capacities["GOLD_MINERS"])
	if err != nil || ideal != 0 || room != 0 {
		t.Fatalf("partial class authorised a purchase: %v %v %v", ideal, room, err)
	}
	setTestWeightMode(t, true)
	add := insertSecurityActionTestAlert(t, "ASX:AEVT", "ADD")
	assertDeploymentState(t, add, deploymentStateTargetUnavailable)
	nextWeightStatement(t)
	if err := projectOpenDeploymentActions(); err != nil {
		t.Fatal(err)
	}
	if weightActionCount(t) != 0 {
		t.Fatal("incomplete research generated a sale")
	}
	actionUnitsExec(t, `UPDATE stock_analysis SET gemini_pt=10 WHERE ticker='ASX:BETA'`)
	refs, err = weightReferencesFrom(db, capacities, "")
	if err != nil || !refs["AEVT"].Available || refs["AEVT"].ResearchMissing != 0 {
		t.Fatalf("completed peer research did not restore references: %+v %v", refs, err)
	}
}

func TestWeightClassCompletenessIncludesPriceAndPartialModels(t *testing.T) {
	for _, change := range []string{"gemini_quality=0", "gemini_value=0", "gemini_pt=0", "current_price=0"} {
		t.Run(change, func(t *testing.T) {
			defer setupSecurityActionTestDB(t)()
			seedWeightPolicy(t)
			actionUnitsExec(t, `UPDATE stock_analysis SET `+change+` WHERE ticker='ASX:BETA'`)
			capacities, err := deploymentClassCapacities()
			if err != nil {
				t.Fatal(err)
			}
			refs, err := weightReferencesFrom(db, capacities, "")
			if err != nil {
				t.Fatal(err)
			}
			if refs["AEVT"].Available || refs["AEVT"].ResearchMissing != 1 {
				t.Fatalf("incomplete peer was ignored: %+v", refs["AEVT"])
			}
		})
	}
}

func TestWeightIncompleteWatchlistAndOtherClassesDoNotSuppressHeldClass(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedWeightPolicy(t)
	seedDeploymentTicketSecurity(t, "ASX:WATCH", 0, 0)
	actionUnitsExec(t, `UPDATE holdings SET quantity=0 WHERE ticker='WATCH'`)
	seedDeploymentTicketSecurity(t, "ASX:CBA", 0, 300)
	actionUnitsExec(t, `DELETE FROM stock_analysis WHERE ticker='ASX:CBA'`)
	actionUnitsExec(t, `INSERT INTO stock_groups(id,name,asset_class_code,display_order) VALUES('banks','Banks','BANKS',0)`)
	actionUnitsExec(t, `INSERT INTO stock_group_assignments(company_name,group_id) VALUES('CBA Holdings','banks')`)
	capacities, err := deploymentClassCapacities()
	if err != nil {
		t.Fatal(err)
	}
	refs, err := weightReferencesFrom(db, capacities, "")
	if err != nil {
		t.Fatal(err)
	}
	if !refs["AEVT"].Available || refs["AEVT"].ResearchMissing != 0 {
		t.Fatalf("unrelated missing research suppressed Gold: %+v", refs["AEVT"])
	}
	// Purchase checks pass only the requested class, not every class in the registry.
	ideal, _, err := weightTargetFrom(db, "ASX:AEVT", capacities["GOLD_MINERS"])
	if err != nil || ideal <= 0 {
		t.Fatalf("unrelated class blocked purchase reference: %v %v", ideal, err)
	}
}

func TestWeightMissingResearchRecordSuppressesClassButNotCoreETF(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	t.Setenv("COUNCIL_API_TOKEN", "")
	seedClassBudgetCore(t)
	seedDeploymentTicketSecurity(t, "ASX:MEK", 0, 500)
	actionUnitsExec(t, `DELETE FROM stock_analysis WHERE ticker='ASX:MEK'`)
	actionUnitsExec(t, `UPDATE stock_analysis SET gemini_quality=70,gemini_value=70,gemini_pt=10,current_price=5 WHERE ticker='ASX:AEVT'`)
	capacities, err := deploymentClassCapacities()
	if err != nil {
		t.Fatal(err)
	}
	refs, err := weightReferencesFrom(db, capacities, "")
	if err != nil {
		t.Fatal(err)
	}
	if refs["AEVT"].Available || refs["AEVT"].ResearchMissing != 1 {
		t.Fatalf("missing research record ignored: %+v", refs["AEVT"])
	}
	if !refs["SGDJ"].Available || refs["SGDJ"].ResearchMissing != 0 || refs["SGDJ"].Ideal <= 0 {
		t.Fatalf("stock research blocked policy-backed Core ETF: %+v", refs["SGDJ"])
	}
}

func TestWeightCoreUsesLedgerAndLosesProposalWhenDeselected(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	t.Setenv("COUNCIL_API_TOKEN", "")
	seedClassBudgetCore(t)
	actionUnitsExec(t, `UPDATE account_statements SET statement_date=?`, time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02"))
	actionUnitsExec(t, `UPDATE holdings SET value_aud=4000 WHERE ticker='SGDJ'`)
	capacities, err := deploymentClassCapacities()
	if err != nil {
		t.Fatal(err)
	}
	funding, err := loadDeploymentFunding(db)
	if err != nil {
		t.Fatal(err)
	}
	assertBudgetValue(t, "Off removes the fund ceiling", capacities["GOLD_MINERS"].forSecurity("SGDJ", funding).TargetShortfall, 5000)
	setTestWeightMode(t, true)
	capacities, err = deploymentClassCapacities()
	if err != nil {
		t.Fatal(err)
	}
	assertBudgetValue(t, "On respects fund ceiling", capacities["GOLD_MINERS"].forSecurity("SGDJ", funding).TargetShortfall, 0)
	nextWeightStatement(t)
	if err = projectOpenDeploymentActions(); err != nil {
		t.Fatal(err)
	}
	var amount float64
	var evidence string
	var id int
	if err = db.QueryRow(`SELECT sa.id,sa.instruction_value,e.evidence_json FROM security_actions sa JOIN weight_action_evidence e ON e.action_id=sa.id WHERE sa.intent='REDUCE'`).Scan(&id, &amount, &evidence); err != nil {
		t.Fatal(err)
	}
	assertBudgetValue(t, "Core reduction to effective target", amount, 875)
	var ref weightReference
	if err = json.Unmarshal([]byte(evidence), &ref); err != nil {
		t.Fatal(err)
	}
	if ref.Role != "CORE_ETF" || ref.SourceDates["etf_allocation_published_or_updated_at"] == "" {
		t.Fatal("lost fund role/publication evidence")
	}
	actionUnitsExec(t, `DELETE FROM asset_class_etf_policies`)
	if err = projectOpenDeploymentActions(); err != nil {
		t.Fatal(err)
	}
	var status string
	if err = db.QueryRow(`SELECT status FROM security_actions WHERE id=?`, id).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "NOT_APPLICABLE" || weightActionCount(t) != 1 {
		t.Fatal("deselection became a full sale")
	}
}
