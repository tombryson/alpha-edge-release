package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"unicode"

	"github.com/gorilla/mux"
)

type createCustomAssetClassRequest struct {
	DisplayName     string `json:"display_name"`
	Quartile        string `json:"quartile"`
	RiskBucket      string `json:"risk_bucket"`
	InstrumentScope string `json:"instrument_scope"`
}

func createCustomAssetClass(w http.ResponseWriter, r *http.Request) {
	var payload createCustomAssetClassRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "invalid JSON payload", http.StatusBadRequest)
		return
	}

	displayName := strings.TrimSpace(payload.DisplayName)
	if displayName == "" {
		http.Error(w, "display_name is required", http.StatusBadRequest)
		return
	}

	riskBucket := normalizeCustomClassToken(firstNonEmptyString(payload.RiskBucket, payload.Quartile))
	if riskBucket == "" {
		http.Error(w, "quartile is required", http.StatusBadRequest)
		return
	}

	instrumentScope := normalizeCustomClassToken(payload.InstrumentScope)
	if instrumentScope == "" {
		instrumentScope = "FUND"
	}

	code := customAssetClassCode(displayName)
	if code == "" {
		http.Error(w, "display_name must contain letters or numbers", http.StatusBadRequest)
		return
	}

	displayOrder := nextCustomAssetClassDisplayOrder()
	_, err := db.Exec(`
		INSERT INTO asset_classes (
			code, asset_class_code, display_name, class_type, parent_code,
			allow_grouping, allow_target_weight, analysis_eligible, instrument_scope,
			risk_bucket, display_order, active, updated_at
		)
		VALUES (?, ?, ?, 'CUSTOM', NULL, 1, 1, 0, ?, ?, ?, 1, CURRENT_TIMESTAMP)
	`, code, code, displayName, instrumentScope, riskBucket, displayOrder)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			http.Error(w, "custom asset class already exists", http.StatusConflict)
			return
		}
		http.Error(w, "failed to create custom asset class", http.StatusInternalServerError)
		return
	}

	created, ok := resolveAssetClassForCode(code, false)
	if !ok {
		created = AssetClass{
			Code:              code,
			AssetClassCode:    code,
			DisplayName:       displayName,
			ClassType:         "CUSTOM",
			AllowGrouping:     true,
			AllowTargetWeight: true,
			AnalysisEligible:  false,
			InstrumentScope:   instrumentScope,
			RiskBucket:        riskBucket,
			Quartile:          riskBucket,
			DisplayOrder:      displayOrder,
			Active:            true,
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(created)
}

func deleteCustomAssetClass(w http.ResponseWriter, r *http.Request) {
	rawCode := strings.TrimSpace(mux.Vars(r)["code"])
	if rawCode == "" {
		http.Error(w, "asset class code is required", http.StatusBadRequest)
		return
	}

	assetClass, ok := resolveCustomAssetClassForDelete(rawCode)
	if !ok {
		http.Error(w, "custom asset class not found", http.StatusNotFound)
		return
	}
	if strings.ToUpper(strings.TrimSpace(assetClass.ClassType)) != "CUSTOM" {
		http.Error(w, "only custom asset classes can be deleted", http.StatusBadRequest)
		return
	}

	references, err := customAssetClassReferenceCount(assetClass.Code)
	if err != nil {
		http.Error(w, "failed to check custom asset class references", http.StatusInternalServerError)
		return
	}
	if references > 0 {
		http.Error(w, "custom asset class is still in use", http.StatusConflict)
		return
	}

	if _, err := db.Exec(`
		DELETE FROM asset_classes
		WHERE code = ?
		  AND UPPER(COALESCE(class_type, '')) = 'CUSTOM'
	`, assetClass.Code); err != nil {
		http.Error(w, "failed to delete custom asset class", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"deleted": assetClass.Code,
	})
}

func customAssetClassCode(displayName string) string {
	token := normalizeCustomClassToken(displayName)
	if token == "" {
		return ""
	}
	if strings.HasPrefix(token, "CUSTOM_") {
		return token
	}
	return "CUSTOM_" + token
}

func normalizeCustomClassToken(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	var builder strings.Builder
	lastUnderscore := false
	for _, r := range strings.ToUpper(value) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			builder.WriteRune(r)
			lastUnderscore = false
			continue
		}
		if !lastUnderscore {
			builder.WriteByte('_')
			lastUnderscore = true
		}
	}
	return strings.Trim(builder.String(), "_")
}

func resolveCustomAssetClassForDelete(rawCode string) (AssetClass, bool) {
	token := normalizeCustomClassToken(rawCode)
	if token == "" {
		return AssetClass{}, false
	}
	targetCode := customAssetClassCode(token)
	targetCompact := compactAssetClassCode(targetCode)

	for _, assetClass := range loadAssetClasses() {
		if strings.ToUpper(strings.TrimSpace(assetClass.ClassType)) != "CUSTOM" {
			continue
		}
		code := normalizeCustomClassToken(assetClass.Code)
		assetCode := normalizeCustomClassToken(assetClass.AssetClassCode)
		nameCode := customAssetClassCode(assetClass.DisplayName)
		if code == targetCode ||
			assetCode == targetCode ||
			nameCode == targetCode ||
			compactAssetClassCode(code) == targetCompact ||
			compactAssetClassCode(assetCode) == targetCompact ||
			compactAssetClassCode(nameCode) == targetCompact {
			return assetClass, true
		}
	}
	return AssetClass{}, false
}

func compactAssetClassCode(code string) string {
	return strings.ReplaceAll(normalizeCustomClassToken(code), "_", "")
}

func customAssetClassReferenceCount(code string) (int, error) {
	compactCode := compactAssetClassCode(code)
	if compactCode == "" {
		return 0, nil
	}

	total := 0
	if sqliteTableExists("stock_groups") {
		count, err := countCompactAssetClassColumnReferences("stock_groups", "asset_class_code", compactCode)
		if err != nil {
			return 0, err
		}
		total += count
	}
	if sqliteTableExists("stock_analysis") {
		count, err := countCompactAssetClassColumnReferences("stock_analysis", "primary_asset_class", compactCode)
		if err != nil {
			return 0, err
		}
		total += count
	}
	if sqliteTableExists("etf_asset_class_mappings") {
		count, err := countCompactAssetClassColumnReferences("etf_asset_class_mappings", "asset_class", compactCode)
		if err != nil {
			return 0, err
		}
		total += count
	}
	return total, nil
}

func countCompactAssetClassColumnReferences(tableName, columnName, compactCode string) (int, error) {
	var count int
	err := db.QueryRow(`
		SELECT COUNT(*)
		FROM `+tableName+`
		WHERE UPPER(REPLACE(COALESCE(`+columnName+`, ''), '_', '')) = ?
	`, compactCode).Scan(&count)
	return count, err
}

func nextCustomAssetClassDisplayOrder() int {
	var displayOrder int
	if err := db.QueryRow(`
		SELECT COALESCE(MAX(display_order), 8999) + 1
		FROM asset_classes
		WHERE UPPER(COALESCE(class_type, '')) = 'CUSTOM'
	`).Scan(&displayOrder); err != nil || displayOrder < 9000 {
		return 9000
	}
	return displayOrder
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
