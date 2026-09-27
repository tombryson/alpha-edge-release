package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"
)

const (
	cashMovementSourcePortfolioCashTransfer = "PORTFOLIO_CASH_TRANSFER"
	cashMovementSourceStockSale             = "STOCK_SALE"
	cashMovementSourceExternalCapital       = "EXTERNAL_CAPITAL"

	cashMovementStatusPending = "PENDING"

	decisionCashAllocation = "CASH_ALLOCATION"
)

type CashMovement struct {
	ID                  int64      `json:"id"`
	AssetClassCode      string     `json:"asset_class_code"`
	AmountDelta         float64    `json:"amount_delta"`
	PreviousCashReserve float64    `json:"previous_cash_reserve"`
	TargetCashReserve   float64    `json:"target_cash_reserve"`
	SourceType          string     `json:"source_type"`
	Note                string     `json:"note"`
	Status              string     `json:"status"`
	CreatedAt           time.Time  `json:"created_at"`
	ConfirmedAt         *time.Time `json:"confirmed_at,omitempty"`
	StatementID         *int64     `json:"statement_id,omitempty"`
}

type createCashMovementRequest struct {
	AssetClassCode    string  `json:"asset_class_code"`
	TargetCashReserve float64 `json:"target_cash_reserve"`
	SourceType        string  `json:"source_type"`
	Note              string  `json:"note"`
}

type createCashMovementResponse struct {
	Movement CashMovement             `json:"movement"`
	Config   OverlayAssetClassSetting `json:"asset_class_config"`
}

func normalizeCashMovementSource(value string) (string, bool) {
	normalized := strings.ToUpper(strings.TrimSpace(value))
	normalized = strings.NewReplacer("-", "_", " ", "_").Replace(normalized)

	switch normalized {
	case cashMovementSourcePortfolioCashTransfer, "PORTFOLIO_CASH":
		return cashMovementSourcePortfolioCashTransfer, true
	case cashMovementSourceStockSale, "SALE_PROCEEDS":
		return cashMovementSourceStockSale, true
	case cashMovementSourceExternalCapital, "NEW_CAPITAL":
		return cashMovementSourceExternalCapital, true
	default:
		return "", false
	}
}

func cashMovementSourceLabel(sourceType string) string {
	switch sourceType {
	case cashMovementSourcePortfolioCashTransfer:
		return "Portfolio cash transfer"
	case cashMovementSourceStockSale:
		return "Stock sale"
	case cashMovementSourceExternalCapital:
		return "New capital"
	default:
		return strings.Title(strings.ToLower(strings.ReplaceAll(sourceType, "_", " ")))
	}
}

func cashAmountLabel(value float64) string {
	if value < 0 {
		return fmt.Sprintf("-$%.0f", math.Abs(value))
	}
	return fmt.Sprintf("$%.0f", value)
}

func buildCashAllocationDecisionNotes(assetClassCode, displayName, sourceType string, previousCashReserve, targetCashReserve, amountDelta float64, note string) string {
	if displayName == "" {
		displayName = assetClassCode
	}

	parts := []string{
		"Asset class: " + displayName + " (" + assetClassCode + ")",
		"Source: " + cashMovementSourceLabel(sourceType),
		"Cash: " + cashAmountLabel(previousCashReserve) + " -> " + cashAmountLabel(targetCashReserve),
		"Delta: " + cashAmountLabel(amountDelta),
	}
	if note != "" {
		parts = append(parts, "Note: "+note)
	}
	return strings.Join(parts, " | ")
}

func createCashMovement(w http.ResponseWriter, r *http.Request) {
	var payload createCashMovementRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	assetClassCode := strings.ToUpper(strings.TrimSpace(payload.AssetClassCode))
	if assetClassCode == "" {
		http.Error(w, "asset_class_code is required", http.StatusBadRequest)
		return
	}
	targetCashReserve := math.Round(payload.TargetCashReserve)
	if targetCashReserve < 0 {
		http.Error(w, "target_cash_reserve cannot be negative", http.StatusBadRequest)
		return
	}
	sourceType, ok := normalizeCashMovementSource(payload.SourceType)
	if !ok {
		http.Error(w, "invalid source_type", http.StatusBadRequest)
		return
	}
	note := strings.TrimSpace(payload.Note)
	status := cashMovementStatusPending

	tx, err := db.Begin()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	var previousCashReserve float64
	var displayName string
	if err := tx.QueryRow(`
		SELECT COALESCE(cash_reserve, 0), COALESCE(display_name, '')
		FROM asset_class_config
		WHERE UPPER(TRIM(code)) = ?
	`, assetClassCode).Scan(&previousCashReserve, &displayName); err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "asset class not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	amountDelta := targetCashReserve - previousCashReserve
	if sourceType == cashMovementSourcePortfolioCashTransfer {
		// An explicit replacement allocation from existing broker cash supersedes
		// earlier expected funding; it does not confirm that those sales/deposits
		// happened. Preserve their cancelled records as audit evidence.
		if _, err := tx.Exec(`UPDATE cash_movements SET status = 'CANCELLED'
			WHERE UPPER(TRIM(asset_class_code)) = ? AND status IN ('PENDING', 'MISMATCH')
			AND source_type IN ('STOCK_SALE', 'EXTERNAL_CAPITAL')`, assetClassCode); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	result, err := tx.Exec(`
		INSERT INTO cash_movements (
			asset_class_code, amount_delta, previous_cash_reserve,
			target_cash_reserve, source_type, note, status, confirmed_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'CONFIRMED' THEN CURRENT_TIMESTAMP ELSE NULL END)
	`, assetClassCode, amountDelta, previousCashReserve, targetCashReserve, sourceType, note, status, status)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	movementID, err := result.LastInsertId()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if _, err := tx.Exec(`
		UPDATE asset_class_config
		SET cash_reserve = ?, updated_at = CURRENT_TIMESTAMP
		WHERE UPPER(TRIM(code)) = ?
	`, targetCashReserve, assetClassCode); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	decisionNotes := buildCashAllocationDecisionNotes(assetClassCode, displayName, sourceType, previousCashReserve, targetCashReserve, amountDelta, note)
	if _, err := tx.Exec(`
		INSERT INTO decisions (alert_id, decision, notes, position_pct_after)
		VALUES (NULL, ?, ?, NULL)
	`, decisionCashAllocation, decisionNotes); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	movement := CashMovement{
		ID:                  movementID,
		AssetClassCode:      assetClassCode,
		AmountDelta:         amountDelta,
		PreviousCashReserve: previousCashReserve,
		TargetCashReserve:   targetCashReserve,
		SourceType:          sourceType,
		Note:                note,
		Status:              status,
		CreatedAt:           time.Now(),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(createCashMovementResponse{
		Movement: movement,
		Config:   getOverlayAssetClassSetting(assetClassCode),
	})
}
