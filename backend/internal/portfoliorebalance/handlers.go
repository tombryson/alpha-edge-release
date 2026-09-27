package portfoliorebalance

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/gorilla/mux"
)

type CreateRequest struct {
	Driver    string    `json:"driver"`
	Title     string    `json:"title"`
	Notes     string    `json:"notes"`
	MemoJobID string    `json:"memo_job_id"`
	Rows      []PlanRow `json:"rows"`
}

type PlanResponse struct {
	Plan *Plan `json:"plan"`
}

type CreatePlanFunc func(context.Context, CreateRequest) (*Plan, error)
type CanonicalAssetClassFunc func(string) string

type Handler struct {
	Store               Store
	CreatePlan          CreatePlanFunc
	CanonicalAssetClass CanonicalAssetClassFunc
}

func (h Handler) Current(w http.ResponseWriter, r *http.Request) {
	plan, err := h.Store.LoadCurrent(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writePlan(w, plan)
}

func (h Handler) Create(w http.ResponseWriter, r *http.Request) {
	var payload CreateRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	h.create(w, r, payload)
}

func (h Handler) CreateFromMemo(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Title     string    `json:"title"`
		Notes     string    `json:"notes"`
		MemoJobID string    `json:"memo_job_id"`
		Rows      []PlanRow `json:"rows"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	h.create(w, r, CreateRequest{
		Driver:    "MEMO",
		Title:     payload.Title,
		Notes:     payload.Notes,
		MemoJobID: payload.MemoJobID,
		Rows:      payload.Rows,
	})
}

func (h Handler) MarkPartial(w http.ResponseWriter, r *http.Request) {
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}
	if err := h.Store.MarkPartial(r.Context(), planID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	plan, err := h.Store.LoadCurrent(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writePlan(w, plan)
}

func (h Handler) Complete(w http.ResponseWriter, r *http.Request) {
	planID, ok := parsePlanID(w, r)
	if !ok {
		return
	}

	var payload struct {
		Rows []PlanRow `json:"rows"`
	}
	if r.Body != nil {
		body, _ := io.ReadAll(r.Body)
		if len(bytes.TrimSpace(body)) > 0 {
			if err := json.Unmarshal(body, &payload); err != nil {
				http.Error(w, "invalid json", http.StatusBadRequest)
				return
			}
		}
	}

	rows := make([]PlanRow, 0, len(payload.Rows))
	for _, item := range payload.Rows {
		assetClass := strings.ToUpper(strings.TrimSpace(item.AssetClass))
		if assetClass == "" {
			continue
		}
		if h.CanonicalAssetClass != nil {
			assetClass = h.CanonicalAssetClass(assetClass)
		}
		item.AssetClass = assetClass
		rows = append(rows, item)
	}

	if err := h.Store.Complete(r.Context(), planID, rows); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	plan, err := h.Store.LoadCurrent(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writePlan(w, plan)
}

func (h Handler) create(w http.ResponseWriter, r *http.Request, payload CreateRequest) {
	if h.CreatePlan == nil {
		http.Error(w, "portfolio rebalance creator not configured", http.StatusInternalServerError)
		return
	}
	plan, err := h.CreatePlan(r.Context(), payload)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writePlan(w, plan)
}

func parsePlanID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id := strings.TrimSpace(mux.Vars(r)["id"])
	if id == "" {
		http.Error(w, "missing plan id", http.StatusBadRequest)
		return 0, false
	}
	planID, err := strconv.ParseInt(id, 10, 64)
	if err != nil {
		http.Error(w, "invalid plan id", http.StatusBadRequest)
		return 0, false
	}
	return planID, true
}

func writePlan(w http.ResponseWriter, plan *Plan) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(PlanResponse{Plan: plan})
}
