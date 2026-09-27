package portfoliorebalance

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/mux"
)

func TestHandlerCreateFromMemoUsesMemoDriver(t *testing.T) {
	var got CreateRequest
	handler := Handler{
		CreatePlan: func(_ctx context.Context, request CreateRequest) (*Plan, error) {
			got = request
			return &Plan{ID: 7, Status: "OPEN", Driver: request.Driver}, nil
		},
	}

	request := httptest.NewRequest(http.MethodPost, "/api/portfolio-rebalances/from-memo", bytes.NewBufferString(`{"title":"Target","rows":[]}`))
	response := httptest.NewRecorder()
	handler.CreateFromMemo(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if got.Driver != "MEMO" {
		t.Fatalf("driver = %q, want MEMO", got.Driver)
	}
	var body PlanResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Plan == nil || body.Plan.Driver != "MEMO" {
		t.Fatalf("unexpected response: %#v", body.Plan)
	}
}

func TestHandlerCompleteCanonicalisesRows(t *testing.T) {
	store := Store{DB: newTestDB(t)}
	plan, err := store.CreateOpen(context.Background(), CreateInput{
		Driver: "manual",
		Rows: []PlanRow{
			{AssetClass: "GOLD_MINERS", DisplayName: "Gold Miners", CurrentWeightPct: 20, TargetWeightPct: 25},
		},
	})
	if err != nil {
		t.Fatalf("CreateOpen: %v", err)
	}

	handler := Handler{
		Store: store,
		CanonicalAssetClass: func(value string) string {
			if value == "GOLD MINERS" {
				return "GOLD_MINERS"
			}
			return value
		},
	}
	request := httptest.NewRequest(http.MethodPost, "/api/portfolio-rebalances/1/complete", bytes.NewBufferString(`{"rows":[{"asset_class":"gold miners","recorded_move_value":120,"note":"done"}]}`))
	request = mux.SetURLVars(request, map[string]string{"id": "1"})
	response := httptest.NewRecorder()

	handler.Complete(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}

	loaded, err := store.LoadByID(context.Background(), plan.ID)
	if err != nil {
		t.Fatalf("LoadByID: %v", err)
	}
	if loaded.Status != "COMPLETED" {
		t.Fatalf("status = %q, want COMPLETED", loaded.Status)
	}
	if loaded.Rows[0].RecordedMoveValue != 120 || loaded.Rows[0].Note != "done" {
		t.Fatalf("row was not completed with canonical asset class: %#v", loaded.Rows[0])
	}
}
