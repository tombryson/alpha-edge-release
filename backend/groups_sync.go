package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/mux"

	"trading-backend/internal/assetclass"
)

type StockGroupsPayload struct {
	Groups      []StockGroup           `json:"groups"`
	Assignments []StockGroupAssignment `json:"assignments"`
}

func loadAssetClasses() []AssetClass {
	rows, err := db.Query(`
		SELECT code, asset_class_code, display_name, class_type, COALESCE(parent_code, ''),
		       allow_grouping, allow_target_weight,
		       COALESCE(analysis_eligible, 1), COALESCE(instrument_scope, 'BOTH'), COALESCE(risk_bucket, ''),
		       display_order, active
		FROM asset_classes
		WHERE active = 1
		ORDER BY display_order, display_name
	`)
	if err != nil {
		log.Printf("[ASSET CLASSES] Failed to load asset classes: %v", err)
		return defaultAssetClassSettings
	}
	defer rows.Close()

	sleeves := make([]AssetClass, 0)
	for rows.Next() {
		var sleeve AssetClass
		if err := rows.Scan(
			&sleeve.Code,
			&sleeve.AssetClassCode,
			&sleeve.DisplayName,
			&sleeve.ClassType,
			&sleeve.ParentCode,
			&sleeve.AllowGrouping,
			&sleeve.AllowTargetWeight,
			&sleeve.AnalysisEligible,
			&sleeve.InstrumentScope,
			&sleeve.RiskBucket,
			&sleeve.DisplayOrder,
			&sleeve.Active,
		); err != nil {
			log.Printf("[ASSET CLASSES] Failed to scan asset class: %v", err)
			continue
		}
		sleeve.Quartile = sleeve.RiskBucket
		sleeves = append(sleeves, sleeve)
	}
	if len(sleeves) == 0 {
		return defaultAssetClassSettings
	}
	return sleeves
}

func toAssetClassDomain(sleeves []AssetClass) []assetclass.Class {
	classes := make([]assetclass.Class, 0, len(sleeves))
	for _, sleeve := range sleeves {
		classes = append(classes, assetclass.Class{
			Code:              sleeve.Code,
			AssetClassCode:    sleeve.AssetClassCode,
			DisplayName:       sleeve.DisplayName,
			ClassType:         sleeve.ClassType,
			ParentCode:        sleeve.ParentCode,
			AllowGrouping:     sleeve.AllowGrouping,
			AllowTargetWeight: sleeve.AllowTargetWeight,
			DisplayOrder:      sleeve.DisplayOrder,
			Active:            sleeve.Active,
		})
	}
	return classes
}

func getAssetClasses(w http.ResponseWriter, r *http.Request) {
	sleeves := loadAssetClasses()

	// Annotate with mandate status so the picker can say which classes actually
	// draw capital. A failure here degrades to "no mandate known" rather than
	// failing the request: the class list is needed whether or not a shape exists.
	if mandate, hasShape, err := loadMandateClasses(); err != nil {
		log.Printf("[MANDATE] Could not annotate asset classes with mandate status: %v", err)
	} else if hasShape {
		for i := range sleeves {
			if funded, ok := mandate[normalizePrimaryAssetClass(sleeves[i].Code)]; ok {
				sleeves[i].InMandate = true
				sleeves[i].MandateWeightPct = funded.WeightPct
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sleeves)
}

func isRecognizedPortfolioGroupingSleeve(assetClassCode string) bool {
	_, ok := resolvePortfolioGroupingAssetClassCode(assetClassCode)
	return ok
}

func resolvePortfolioGroupingAssetClassCode(assetClassCode string) (string, bool) {
	return resolvePortfolioGroupingAssetClassCodeFromAssetClasses(assetClassCode, loadAssetClasses())
}

func resolvePortfolioGroupingAssetClassCodeFromAssetClasses(assetClassCode string, sleeves []AssetClass) (string, bool) {
	return assetclass.ResolveGroupingClassCode(assetClassCode, toAssetClassDomain(sleeves))
}

func resolvePortfolioAssignmentClass(assetClassCode string) (string, bool) {
	return resolvePortfolioAssignmentClassFromAssetClasses(assetClassCode, loadAssetClasses())
}

func resolvePortfolioAssignmentClassFromAssetClasses(assetClassCode string, sleeves []AssetClass) (string, bool) {
	return assetclass.ResolveAssignmentClass(assetClassCode, toAssetClassDomain(sleeves))
}

func resolveAssetClassForCode(assetClassCode string, requireTargetWeight bool) (AssetClass, bool) {
	sleeves := loadAssetClasses()
	resolved, ok := assetclass.ResolveClassForCode(assetClassCode, toAssetClassDomain(sleeves), requireTargetWeight)
	if !ok {
		return AssetClass{}, false
	}
	for _, sleeve := range sleeves {
		if normalizePrimaryAssetClass(sleeve.Code) == normalizePrimaryAssetClass(resolved.Code) {
			return sleeve, true
		}
	}
	return AssetClass{}, false
}

func (s AssetClass) IsSystemBucket() bool {
	return assetclass.Class{ClassType: s.ClassType}.IsSystemBucket()
}

func getStockGroups(w http.ResponseWriter, r *http.Request) {
	// Fetch all groups
	groupRows, err := db.Query(`
		SELECT id, name, COALESCE(asset_class_code, ''), collapsed, display_order, parent_id, created_at, updated_at
		FROM stock_groups
		ORDER BY display_order ASC
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer groupRows.Close()

	// Initialize with empty slices to ensure JSON returns [] instead of null
	groups := make([]StockGroup, 0)
	for groupRows.Next() {
		var g StockGroup
		err := groupRows.Scan(&g.ID, &g.Name, &g.AssetClassCode, &g.Collapsed, &g.DisplayOrder, &g.ParentID, &g.CreatedAt, &g.UpdatedAt)
		if err != nil {
			continue
		}
		groups = append(groups, g)
	}

	// Fetch all assignments
	assignmentRows, err := db.Query(`
		SELECT company_name, group_id, assigned_at
		FROM stock_group_assignments
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer assignmentRows.Close()

	// Initialize with empty slice to ensure JSON returns [] instead of null
	assignments := make([]StockGroupAssignment, 0)
	for assignmentRows.Next() {
		var a StockGroupAssignment
		err := assignmentRows.Scan(&a.CompanyName, &a.GroupID, &a.AssignedAt)
		if err != nil {
			continue
		}
		assignments = append(assignments, a)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(StockGroupsPayload{
		Groups:      groups,
		Assignments: assignments,
	})
}

func saveStockGroups(w http.ResponseWriter, r *http.Request) {
	var payload StockGroupsPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	type validatedGroup struct {
		Group          StockGroup
		AssetClassCode string
	}
	childGroupIDs := make(map[string]struct{}, len(payload.Groups))
	for _, group := range payload.Groups {
		if group.ParentID == nil {
			continue
		}
		parentID := strings.TrimSpace(*group.ParentID)
		if parentID != "" {
			childGroupIDs[parentID] = struct{}{}
		}
	}

	validatedGroups := make([]validatedGroup, 0, len(payload.Groups))
	validGroupIDs := make(map[string]struct{}, len(payload.Groups))
	for _, group := range payload.Groups {
		id := strings.TrimSpace(group.ID)
		if id == "" {
			http.Error(w, "group id is required", http.StatusBadRequest)
			return
		}
		group.Name = strings.TrimSpace(group.Name)
		if group.Name == "" {
			http.Error(w, "group name is required", http.StatusBadRequest)
			return
		}

		resolvedCode := ""
		if _, isDisplayParent := childGroupIDs[id]; !isDisplayParent {
			code, ok := resolveStockGroupAssetClassCode(group.Name, group.AssetClassCode)
			if !ok {
				http.Error(w, fmt.Sprintf("invalid asset_class_code for group %s", group.Name), http.StatusBadRequest)
				return
			}
			resolvedCode = code
		}
		group.ID = id
		validatedGroups = append(validatedGroups, validatedGroup{
			Group:          group,
			AssetClassCode: resolvedCode,
		})
		validGroupIDs[id] = struct{}{}
	}

	validAssignments := make([]StockGroupAssignment, 0, len(payload.Assignments))
	for _, assignment := range payload.Assignments {
		companyName := strings.TrimSpace(assignment.CompanyName)
		groupID := strings.TrimSpace(assignment.GroupID)
		if companyName == "" || groupID == "" {
			continue
		}
		if _, ok := validGroupIDs[groupID]; !ok {
			continue
		}
		assignment.CompanyName = companyName
		assignment.GroupID = groupID
		validAssignments = append(validAssignments, assignment)
	}

	// Start transaction
	tx, err := db.Begin()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	// Clear existing groups and assignments
	if _, err := tx.Exec("DELETE FROM stock_group_assignments"); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if _, err := tx.Exec("DELETE FROM stock_groups"); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Insert groups
	for _, item := range validatedGroups {
		group := item.Group
		_, err := tx.Exec(`
				INSERT INTO stock_groups (id, name, asset_class_code, collapsed, display_order, parent_id, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			`, group.ID, group.Name, item.AssetClassCode, group.Collapsed, group.DisplayOrder, group.ParentID, time.Now(), time.Now())
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	// Insert assignments
	for _, assignment := range validAssignments {
		_, err := tx.Exec(`
			INSERT INTO stock_group_assignments (company_name, group_id, assigned_at)
			VALUES (?, ?, ?)
		`, assignment.CompanyName, assignment.GroupID, time.Now())
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	// Commit transaction
	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Groups saved successfully"})
}

func deleteStockGroup(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	groupID := vars["id"]

	_, err := db.Exec("DELETE FROM stock_groups WHERE id = ?", groupID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"message": "Group deleted"})
}

func getRegimeAssignments(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode([]RegimeAssignment{})
}

// Sync Changes Endpoints

type SyncChange struct {
	ID           int      `json:"id"`
	SyncID       int      `json:"sync_id"`
	ChangeType   string   `json:"change_type"`
	Ticker       string   `json:"ticker"`
	CompanyName  string   `json:"company_name"`
	OldQuantity  *float64 `json:"old_quantity,omitempty"`
	NewQuantity  *float64 `json:"new_quantity,omitempty"`
	OldValue     *float64 `json:"old_value,omitempty"`
	NewValue     *float64 `json:"new_value,omitempty"`
	Acknowledged bool     `json:"acknowledged"`
	CreatedAt    string   `json:"created_at"`
}

type SyncHistory struct {
	ID           int    `json:"id"`
	SyncType     string `json:"sync_type"`
	SyncStatus   string `json:"sync_status"`
	TotalChanges int    `json:"total_changes"`
	AddedCount   int    `json:"added_count"`
	UpdatedCount int    `json:"updated_count"`
	RemovedCount int    `json:"removed_count"`
	ErrorMessage string `json:"error_message,omitempty"`
	SyncedAt     string `json:"synced_at"`
}

// Get unacknowledged sync changes (for modal display)
func getSyncChanges(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`
		SELECT id, sync_id, change_type, ticker, company_name,
		       old_quantity, new_quantity, old_value, new_value,
		       acknowledged, created_at
		FROM sync_changes
		WHERE acknowledged = 0
		ORDER BY created_at DESC
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var changes []SyncChange
	for rows.Next() {
		var c SyncChange
		err := rows.Scan(&c.ID, &c.SyncID, &c.ChangeType, &c.Ticker, &c.CompanyName,
			&c.OldQuantity, &c.NewQuantity, &c.OldValue, &c.NewValue,
			&c.Acknowledged, &c.CreatedAt)
		if err != nil {
			log.Printf("[ALPHA EDGE] Error scanning sync change: %v", err)
			continue
		}
		changes = append(changes, c)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(changes)
}

// Acknowledge sync changes (mark as seen)
func acknowledgeSyncChanges(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		ChangeIDs []int `json:"change_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if len(payload.ChangeIDs) == 0 {
		// Acknowledge all
		_, err := db.Exec(`UPDATE sync_changes SET acknowledged = 1`)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	} else {
		// Acknowledge specific changes
		for _, id := range payload.ChangeIDs {
			db.Exec(`UPDATE sync_changes SET acknowledged = 1 WHERE id = ?`, id)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Changes acknowledged"})
}

// Get sync history (recent syncs)
func getSyncHistory(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`
		SELECT id, sync_type, sync_status, total_changes,
		       added_count, updated_count, removed_count,
		       error_message, synced_at
		FROM sync_history
		ORDER BY synced_at DESC
		LIMIT 10
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var history []SyncHistory
	for rows.Next() {
		var h SyncHistory
		var errorMsg *string
		err := rows.Scan(&h.ID, &h.SyncType, &h.SyncStatus, &h.TotalChanges,
			&h.AddedCount, &h.UpdatedCount, &h.RemovedCount,
			&errorMsg, &h.SyncedAt)
		if err != nil {
			continue
		}
		if errorMsg != nil {
			h.ErrorMessage = *errorMsg
		}
		history = append(history, h)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(history)
}

// Sync TradingView Data - Fetch from external API and update analyst price targets
func syncTradingViewData(w http.ResponseWriter, r *http.Request) {
	log.Printf("[ALPHA EDGE] Starting TradingView data sync...")

	// Fetch data from TradingView API
	resp, err := http.Get("https://tradingview-apiservice.fly.dev/webhook")
	if err != nil {
		log.Printf("[ALPHA EDGE] Error fetching TradingView data: %v", err)
		http.Error(w, fmt.Sprintf("Failed to fetch TradingView data: %v", err), http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("[ALPHA EDGE] TradingView API returned status: %d", resp.StatusCode)
		http.Error(w, fmt.Sprintf("TradingView API error: %d", resp.StatusCode), http.StatusBadGateway)
		return
	}

	// Parse the JSON array
	var signals []struct {
		Ticker             string   `json:"ticker"`
		Signal             string   `json:"signal"`
		SignalStrength     int      `json:"signalStrength"`
		AnalystPriceTarget *float64 `json:"analyst_price_target"`
		DateUpdated        string   `json:"date_updated"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&signals); err != nil {
		log.Printf("[ALPHA EDGE] Error parsing TradingView data: %v", err)
		http.Error(w, fmt.Sprintf("Failed to parse TradingView data: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("[ALPHA EDGE] Fetched %d signals from TradingView API", len(signals))

	// Track results
	updated := 0
	skipped := 0
	errors := 0

	// Process each signal
	for _, signal := range signals {
		// Only process if analyst_price_target is present
		if signal.AnalystPriceTarget == nil {
			skipped++
			continue
		}

		// Extract ticker from format like "ASX_DLY:DRO" -> "DRO"
		ticker := signal.Ticker

		// Handle different separator formats: "ASX_DLY:" or "ASX:"
		if colonIdx := strings.Index(ticker, ":"); colonIdx != -1 {
			ticker = ticker[colonIdx+1:]
		}

		// Look up company name from company_mappings
		var companyName string
		err := db.QueryRow(`
			SELECT company_name FROM company_mappings
			WHERE ticker = ?
			LIMIT 1
		`, ticker).Scan(&companyName)

		if err != nil {
			// No mapping found - skip this entry
			log.Printf("[ALPHA EDGE] Skipping %s - no company mapping found", signal.Ticker)
			skipped++
			continue
		}

		// Update analyst_pt in stock_analysis table
		result, err := db.Exec(`
			UPDATE stock_analysis
			SET analyst_pt = ?, updated_at = CURRENT_TIMESTAMP
			WHERE name = ?
		`, *signal.AnalystPriceTarget, companyName)

		if err != nil {
			log.Printf("[ALPHA EDGE] Error updating %s (%s): %v", ticker, companyName, err)
			errors++
			continue
		}

		rowsAffected, _ := result.RowsAffected()
		if rowsAffected > 0 {
			log.Printf("[ALPHA EDGE] Updated %s (%s): analyst_pt = %.2f", ticker, companyName, *signal.AnalystPriceTarget)
			updated++
		} else {
			// Try to insert if no existing record
			_, err := db.Exec(`
				INSERT INTO stock_analysis (ticker, name, analyst_pt, updated_at, created_at)
				VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
			`, ticker, companyName, *signal.AnalystPriceTarget)

			if err != nil {
				log.Printf("[ALPHA EDGE] Error inserting %s (%s): %v", ticker, companyName, err)
				errors++
			} else {
				log.Printf("[ALPHA EDGE] Inserted %s (%s): analyst_pt = %.2f", ticker, companyName, *signal.AnalystPriceTarget)
				updated++
			}
		}
	}

	log.Printf("[ALPHA EDGE] Sync complete: %d updated, %d skipped, %d errors", updated, skipped, errors)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "TradingView data sync complete",
		"updated": updated,
		"skipped": skipped,
		"errors":  errors,
		"total":   len(signals),
	})
}

// ==================== REGIME MANAGEMENT ====================

// GET /api/regimes - List all regimes
// ── Regime Returns ──────────────────────────────────────────────────────────
