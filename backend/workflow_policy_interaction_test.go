package main

import (
	"context"
	"testing"

	"trading-backend/internal/portfoliorebalance"
)

func TestWorkflowContractQ4DuringOpenPortfolioPlan(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	seedDeploymentTicketClass(t, 500)
	seedDeploymentTicketSecurity(t, "ASX:AEVT", 100, 350)
	plan, err := portfolioRebalanceStore().CreateOpen(context.Background(), portfoliorebalance.CreateInput{
		Driver: "USER", Rows: []portfoliorebalance.PlanRow{
			{AssetClass: "GOLD_MINERS", CurrentWeightPct: 20, TargetWeightPct: 75},
			{AssetClass: "CASH", CurrentWeightPct: 80, TargetWeightPct: 25},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	alert := insertSecurityActionTestAlert(t, "ASX:AEVT", "ADD")
	assertDeploymentState(t, alert, deploymentStateFunded)
	var approvedBefore string
	if err := db.QueryRow(`SELECT json_group_array(json_object('id',snapshot_id,'class',asset_class,'weight',weight_pct)) FROM portfolio_mix_snapshot_rows`).Scan(&approvedBefore); err != nil {
		t.Fatal(err)
	}
	for _, signal := range []string{"SELL", "BUY"} {
		if _, err := handleQ4DOverlaySignal(signal, "Q4D"); err != nil {
			t.Fatal(err)
		}
		want := deploymentStateFunded
		if signal == "SELL" {
			want = "Q4_BLOCKED"
		}
		assertDeploymentState(t, alert, want)
		current, err := portfolioRebalanceStore().LoadByID(context.Background(), plan.ID)
		if err != nil || current == nil || current.Status != "OPEN" || len(current.Rows) != 2 {
			t.Fatalf("plan changed: %+v %v", current, err)
		}
		for _, row := range current.Rows {
			want := 75.0
			if row.AssetClass == "CASH" {
				want = 25
			}
			if row.TargetWeightPct != want {
				t.Fatalf("Q4 changed draft target: %+v", row)
			}
		}
		var approvedAfter string
		if err := db.QueryRow(`SELECT json_group_array(json_object('id',snapshot_id,'class',asset_class,'weight',weight_pct)) FROM portfolio_mix_snapshot_rows`).Scan(&approvedAfter); err != nil || approvedBefore != approvedAfter {
			t.Fatalf("Q4 changed approved shape: %v", err)
		}
	}
}

func TestWorkflowContractTradingReductionAfterWeightProposal(t *testing.T) {
	for _, recorded := range []bool{false, true} {
		name := "unrecorded"
		if recorded {
			name = "recorded"
		}
		t.Run(name, func(t *testing.T) {
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
			if recorded {
				w := fundingTestExecute(id, `{"expected_instruction_value":250}`)
				if w.Code != 200 {
					t.Fatal(w.Body.String())
				}
			}
			insertSecurityActionTestAlert(t, "ASX:AEVT", "SELL_DOWN")
			if err := projectOpenDeploymentActions(); err != nil {
				t.Fatal(err)
			}
			var status string
			if err := db.QueryRow(`SELECT status FROM security_actions WHERE id=?`, id).Scan(&status); err != nil {
				t.Fatal(err)
			}
			if recorded {
				if status != securityActionAwaitingStatement {
					t.Fatalf("recorded evidence was unlocked: %s", status)
				}
			} else if status == securityActionOpen || status == securityActionBlocked {
				t.Fatalf("two competing reduction proposals remain: %s", status)
			}
			if weightActionCount(t) != 1 {
				t.Fatal("duplicate weight reduction created")
			}
		})
	}
}
