package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
)

type ETFAllocationPolicy struct {
	SuggestedExposurePct float64 `json:"suggested_exposure_pct"`
	DefaultCoreRatioPct  float64 `json:"default_core_ratio_pct"`
	MomentumInfluencePct float64 `json:"momentum_influence_pct"`
	MomentumSource       string  `json:"momentum_source"`
	MinimumExposurePct   float64 `json:"minimum_exposure_pct"`  // Deprecated compatibility alias.
	CoreSleeveRatioPct   float64 `json:"core_sleeve_ratio_pct"` // Deprecated compatibility alias.
}

type ETFAssetClassMappingResponse struct {
	Ticker      string `json:"ticker"`
	AssetClass  string `json:"asset_class"`
	DisplayName string `json:"display_name"`
	Active      bool   `json:"active"`
}

type ETFAssetClassMappingUpdateRequest struct {
	AssetClass  *string `json:"asset_class"`
	DisplayName *string `json:"display_name"`
	Active      *bool   `json:"active"`
}

type ETFAllocationLedgerSummary struct {
	PortfolioValue             float64 `json:"portfolio_value"`
	SuggestedETFValue          float64 `json:"suggested_etf_value"`
	SuggestedExposurePct       float64 `json:"suggested_exposure_pct"`
	ActualExposurePct          float64 `json:"actual_exposure_pct"`
	MomentumAdjustmentValue    float64 `json:"momentum_adjustment_value"`
	RecommendedTargetValue     float64 `json:"recommended_target_value"`
	EffectiveTargetValue       float64 `json:"effective_target_value"`
	RemainingToSuggestionValue float64 `json:"remaining_to_suggestion_value"`
	MinimumETFValue            float64 `json:"minimum_etf_value"`
	ActualETFValue             float64 `json:"actual_etf_value"`
	CoreTargetValue            float64 `json:"core_target_value"`
	TacticalTargetValue        float64 `json:"tactical_target_value"`
	FinalTargetValue           float64 `json:"final_target_value"`
	RemainingToMinimumValue    float64 `json:"remaining_to_minimum_value"`
	RemainingToTargetValue     float64 `json:"remaining_to_target_value"`
	HasApprovedShape           bool    `json:"has_approved_shape"`
}

type ETFAllocationClassSummary struct {
	AssetClass              string  `json:"asset_class"`
	AssetClassName          string  `json:"asset_class_name"`
	ClassTargetValue        float64 `json:"class_target_value"`
	CoreTicker              string  `json:"core_ticker"`
	CoreSelectionSource     string  `json:"core_selection_source"`
	CoreRatioPct            float64 `json:"core_ratio_pct"`
	MomentumInfluencePct    float64 `json:"momentum_influence_pct"`
	CoreBaseValue           float64 `json:"core_base_value"`
	MomentumAdjustmentValue float64 `json:"momentum_adjustment_value"`
	RecommendedTargetValue  float64 `json:"recommended_target_value"`
	EffectiveTargetValue    float64 `json:"effective_target_value"`
	EffectiveTargetRatioPct float64 `json:"effective_target_ratio_pct"`
	ActualETFValue          float64 `json:"actual_etf_value"`
	TargetDeltaValue        float64 `json:"target_delta_value"`
	StockCapacityValue      float64 `json:"stock_capacity_value"`
}

type ETFAllocationLedgerRow struct {
	ManagementMode          string  `json:"management_mode"`
	Ticker                  string  `json:"ticker"`
	DisplayName             string  `json:"display_name"`
	AssetClass              string  `json:"asset_class"`
	AssetClassName          string  `json:"asset_class_name"`
	MomentumWeightPct       float64 `json:"momentum_weight_pct"`
	IsCore                  bool    `json:"is_core"`
	CoreSelectionSource     string  `json:"core_selection_source"`
	CoreRatioPct            float64 `json:"core_ratio_pct"`
	MomentumInfluencePct    float64 `json:"momentum_influence_pct"`
	ClassTargetValue        float64 `json:"class_target_value"`
	MomentumAdjustmentValue float64 `json:"momentum_adjustment_value"`
	RecommendedTargetValue  float64 `json:"recommended_target_value"`
	EffectiveTargetValue    float64 `json:"effective_target_value"`
	TargetDeltaValue        float64 `json:"target_delta_value"`
	BookTargetPct           float64 `json:"book_target_pct"`
	TargetWeightPct         float64 `json:"target_weight_pct"`
	ActualValue             float64 `json:"actual_value"`
	CoreTargetValue         float64 `json:"core_target_value"`
	TacticalTargetValue     float64 `json:"tactical_target_value"`
	FinalTargetValue        float64 `json:"final_target_value"`
	CoreActualValue         float64 `json:"core_actual_value"`
	TacticalActualValue     float64 `json:"tactical_actual_value"`
	ExcessValue             float64 `json:"excess_value"`
	RemainingValue          float64 `json:"remaining_value"`
	TacticalStatus          string  `json:"tactical_status"`
	// AssetClassUnassignable: the fund's class is not an assignable sleeve, so no
	// class target exists to size it against. Distinct from a target of zero.
	AssetClassUnassignable bool `json:"asset_class_unassignable"`
	// ClassNotInShape: the class is assignable and the fund may even be Core for
	// it, but the approved portfolio shape carries no weight on that class — so
	// the class target is $0 and nothing under it can be sized. The commonest
	// reason a target is missing, and the least visible.
	ClassNotInShape bool   `json:"class_not_in_shape"`
	Status          string `json:"status"`
}

// ETFAllocationCandidate is a fund carrying an asset class that has neither been
// selected to express it nor bought. It has no target and no capital, so it is
// not a ledger row — it is watchlist material, returned separately so the two are
// impossible to confuse. See DOCS/decisions/ETF_MODEL_PROPOSAL.md §4.
type ETFAllocationCandidate struct {
	Ticker            string  `json:"ticker"`
	DisplayName       string  `json:"display_name"`
	AssetClass        string  `json:"asset_class"`
	AssetClassName    string  `json:"asset_class_name"`
	MomentumWeightPct float64 `json:"momentum_weight_pct"`
}

type ETFAllocationLedgerResponse struct {
	AsOf    time.Time                   `json:"as_of"`
	Policy  ETFAllocationPolicy         `json:"policy"`
	Summary ETFAllocationLedgerSummary  `json:"summary"`
	Classes []ETFAllocationClassSummary `json:"classes"`
	Rows    []ETFAllocationLedgerRow    `json:"rows"`
	// Candidates never overlaps Rows.
	Candidates []ETFAllocationCandidate `json:"candidates"`
}

type ETFCorePolicyUpdateRequest struct {
	CoreTicker           *string  `json:"core_ticker"`
	CoreRatioPct         *float64 `json:"core_ratio_pct"`
	MomentumInfluencePct *float64 `json:"momentum_influence_pct"`
}

type etfCorePolicyDBRow struct {
	AssetClass           string
	CoreSecurityID       sql.NullInt64
	CoreTicker           string
	CoreRatioPct         float64
	MomentumInfluencePct float64
}

type etfAllocationDBRow struct {
	Ticker            string
	AllocationPercent float64
	BaseWeight        float64
	TacticalStatus    string
}

type etfMappingDBRow struct {
	Ticker      string
	AssetClass  string
	DisplayName string
	Active      bool
	// Unassignable marks a stored class that is not an assignable sleeve — a
	// container class, or one that has been deactivated. The fund keeps the
	// class it was given; it just cannot carry a target under it.
	Unassignable bool
}

func getETFPolicy(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(loadETFAllocationPolicy())
}

func getETFAssetClassMappings(w http.ResponseWriter, r *http.Request) {
	mappings, err := loadETFAssetClassMappings(false)
	if err != nil {
		log.Printf("[ETF] Failed to load ETF mappings: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	response := make([]ETFAssetClassMappingResponse, 0, len(mappings))
	for _, mapping := range mappings {
		response = append(response, ETFAssetClassMappingResponse{
			Ticker:      mapping.Ticker,
			AssetClass:  mapping.AssetClass,
			DisplayName: mapping.DisplayName,
			Active:      mapping.Active,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func updateETFAssetClassMapping(w http.ResponseWriter, r *http.Request) {
	ticker := canonicalSecurityTickerKey(mux.Vars(r)["ticker"])
	if ticker == "" {
		http.Error(w, "ticker is required", http.StatusBadRequest)
		return
	}

	var payload ETFAssetClassMappingUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	active := true
	if payload.Active != nil {
		active = *payload.Active
	}
	rawAssetClass := ""
	if payload.AssetClass != nil {
		rawAssetClass = strings.TrimSpace(*payload.AssetClass)
	}
	displayName := ""
	if payload.DisplayName != nil {
		displayName = strings.TrimSpace(*payload.DisplayName)
	}

	if rawAssetClass == "" || !active {
		if _, err := db.Exec(fmt.Sprintf(`
			UPDATE stock_analysis
			SET primary_asset_class = NULL,
				asset_class_source = NULL,
				asset_class_set_at = NULL,
				security_type = 'ETF',
				updated_at = CURRENT_TIMESTAMP
			WHERE %s = ?
		`, stockAnalysisTickerKeySQL("ticker")), ticker); err != nil {
			log.Printf("[ETF] Failed to clear ETF asset class for %s: %v", ticker, err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(ETFAssetClassMappingResponse{
			Ticker: ticker,
			Active: false,
		})
		return
	}

	assetClass, ok := resolvePortfolioAssignmentClass(rawAssetClass)
	if !ok || assetClass == "" {
		http.Error(w, fmt.Sprintf("invalid asset_class %s", rawAssetClass), http.StatusBadRequest)
		return
	}

	updateArgs := []interface{}{assetClass, ticker}
	nameClause := ""
	if displayName != "" {
		nameClause = "name = ?,"
		updateArgs = []interface{}{assetClass, displayName, ticker}
	}
	result, err := db.Exec(fmt.Sprintf(`
		UPDATE stock_analysis
		SET primary_asset_class = ?,
			security_type = 'ETF',
			%s
			updated_at = CURRENT_TIMESTAMP
		WHERE %s = ?
	`, nameClause, stockAnalysisTickerKeySQL("ticker")), updateArgs...)
	if err != nil {
		log.Printf("[ETF] Failed to update ETF mapping for %s: %v", ticker, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		if displayName == "" {
			displayName = ticker
		}
		if _, err := db.Exec(`
			INSERT INTO stock_analysis (ticker, name, primary_asset_class, security_type, updated_at)
			VALUES (?, ?, ?, 'ETF', CURRENT_TIMESTAMP)
		`, ticker, displayName, assetClass); err != nil {
			log.Printf("[ETF] Failed to insert ETF analysis row for %s: %v", ticker, err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	// Mapping a fund to a class through this endpoint is a deliberate decision,
	// so it outranks anything the group sync would later derive.
	stampAssetClassSourceByTicker(ticker, AssetClassSourceManual)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ETFAssetClassMappingResponse{
		Ticker:      ticker,
		AssetClass:  assetClass,
		DisplayName: displayName,
		Active:      true,
	})
}

func getETFAllocationLedger(w http.ResponseWriter, r *http.Request) {
	ledger, err := buildETFAllocationLedger(r.Context())
	if err != nil {
		log.Printf("[ETF] Failed to build ETF allocation ledger: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ledger)
}

func loadETFAllocationPolicy() ETFAllocationPolicy {
	return loadETFAllocationPolicyFrom(db)
}

func loadETFAllocationPolicyFrom(reader fundingReader) ETFAllocationPolicy {
	suggestedPct := loadFloatSettingFrom(reader, "etf_suggested_exposure_pct", loadFloatSettingFrom(reader, "etf_min_exposure_pct", 25))
	coreRatioPct := loadFloatSettingFrom(reader, "etf_default_core_ratio_pct", loadFloatSettingFrom(reader, "etf_core_sleeve_ratio_pct", 25))
	momentumInfluencePct := loadFloatSettingFrom(reader, "etf_momentum_influence_pct", 50)
	momentumSource := strings.ToUpper(strings.TrimSpace(loadStringSettingFrom(reader, "etf_momentum_source", "LEGACY_COMPATIBILITY")))
	if momentumSource == "INTERNAL_LATEST_COMPLETE" {
		momentumSource = "INTERNAL_PUBLISHED"
	}
	if momentumSource != "INTERNAL_PUBLISHED" {
		momentumSource = "LEGACY_COMPATIBILITY"
	}
	policy := ETFAllocationPolicy{
		SuggestedExposurePct: suggestedPct,
		DefaultCoreRatioPct:  coreRatioPct,
		MomentumInfluencePct: momentumInfluencePct,
		MomentumSource:       momentumSource,
		MinimumExposurePct:   suggestedPct,
		CoreSleeveRatioPct:   coreRatioPct,
	}
	if policy.SuggestedExposurePct < 0 {
		policy.SuggestedExposurePct = 0
	}
	if policy.SuggestedExposurePct > 100 {
		policy.SuggestedExposurePct = 100
	}
	if policy.DefaultCoreRatioPct < 0 {
		policy.DefaultCoreRatioPct = 0
	}
	if policy.DefaultCoreRatioPct > 100 {
		policy.DefaultCoreRatioPct = 100
	}
	if policy.MomentumInfluencePct < 0 {
		policy.MomentumInfluencePct = 0
	}
	if policy.MomentumInfluencePct > 100 {
		policy.MomentumInfluencePct = 100
	}
	policy.MinimumExposurePct = policy.SuggestedExposurePct
	policy.CoreSleeveRatioPct = policy.DefaultCoreRatioPct
	return policy
}

func loadStringSetting(key, fallback string) string {
	return loadStringSettingFrom(db, key, fallback)
}

func loadStringSettingFrom(reader fundingReader, key, fallback string) string {
	var value string
	if err := reader.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&value); err != nil {
		return fallback
	}
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func loadFloatSetting(key string, fallback float64) float64 {
	return loadFloatSettingFrom(db, key, fallback)
}

func loadFloatSettingFrom(reader fundingReader, key string, fallback float64) float64 {
	raw := loadStringSettingFrom(reader, key, "")
	if raw == "" {
		return fallback
	}
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
		return fallback
	}
	return value
}

func ensureETFCorePolicySchema() error {
	if databaseSchemaManaged() {
		return nil
	}
	if err := ensureETFManagementSchema(); err != nil {
		return err
	}
	statements := []string{
		`CREATE TABLE IF NOT EXISTS asset_class_etf_policies (
			asset_class TEXT PRIMARY KEY,
			core_security_id INTEGER,
			core_ticker TEXT NOT NULL DEFAULT '',
			core_ratio_pct REAL NOT NULL DEFAULT 25,
			momentum_influence_pct REAL NOT NULL DEFAULT 50,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY(core_security_id) REFERENCES security_identities(id) ON DELETE SET NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_asset_class_etf_policies_security
			ON asset_class_etf_policies(core_security_id)`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			return err
		}
	}
	return nil
}

func loadETFCorePolicies() (map[string]etfCorePolicyDBRow, error) {
	return loadETFCorePoliciesFrom(db)
}

func loadETFCorePoliciesFrom(reader fundingReader) (map[string]etfCorePolicyDBRow, error) {
	rows, err := reader.Query(`
		SELECT policies.asset_class, policies.core_security_id,
		       COALESCE(NULLIF(identities.ticker, ''), policies.core_ticker, ''),
		       core_ratio_pct, momentum_influence_pct
		FROM asset_class_etf_policies policies
		LEFT JOIN security_identities identities ON identities.id = policies.core_security_id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	policies := map[string]etfCorePolicyDBRow{}
	for rows.Next() {
		var policy etfCorePolicyDBRow
		if err := rows.Scan(
			&policy.AssetClass,
			&policy.CoreSecurityID,
			&policy.CoreTicker,
			&policy.CoreRatioPct,
			&policy.MomentumInfluencePct,
		); err != nil {
			return nil, err
		}
		policy.AssetClass = normalizePrimaryAssetClass(policy.AssetClass)
		policy.CoreTicker = canonicalSecurityTickerKey(policy.CoreTicker)
		policy.CoreRatioPct = math.Max(0, math.Min(100, policy.CoreRatioPct))
		policy.MomentumInfluencePct = math.Max(0, math.Min(100, policy.MomentumInfluencePct))
		policies[policy.AssetClass] = policy
	}
	return policies, rows.Err()
}

func updateETFCorePolicy(w http.ResponseWriter, r *http.Request) {
	assetClass, ok := resolvePortfolioAssignmentClass(mux.Vars(r)["assetClass"])
	if !ok || assetClass == "" {
		http.Error(w, "invalid asset class", http.StatusBadRequest)
		return
	}
	assetClass = normalizePrimaryAssetClass(assetClass)

	var payload ETFCorePolicyUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	current := etfCorePolicyDBRow{
		AssetClass:           assetClass,
		CoreRatioPct:         loadETFAllocationPolicy().DefaultCoreRatioPct,
		MomentumInfluencePct: loadETFAllocationPolicy().MomentumInfluencePct,
	}
	if policies, err := loadETFCorePolicies(); err == nil {
		if existing, found := policies[assetClass]; found {
			current = existing
		}
	}

	if payload.CoreRatioPct != nil {
		current.CoreRatioPct = math.Max(0, math.Min(100, *payload.CoreRatioPct))
	}
	if payload.MomentumInfluencePct != nil {
		current.MomentumInfluencePct = math.Max(0, math.Min(100, *payload.MomentumInfluencePct))
	}
	if payload.CoreTicker != nil {
		current.CoreTicker = canonicalSecurityTickerKey(*payload.CoreTicker)
		current.CoreSecurityID = sql.NullInt64{}
		if current.CoreTicker != "" {
			var securityID sql.NullInt64
			var mappedClass string
			err := db.QueryRow(fmt.Sprintf(`
				SELECT security_id, COALESCE(primary_asset_class, '')
				FROM stock_analysis
				WHERE %s = ?
				  AND UPPER(COALESCE(security_type, '')) = 'ETF'
				ORDER BY updated_at DESC, id DESC
				LIMIT 1
			`, stockAnalysisTickerKeySQL("ticker")), current.CoreTicker).Scan(&securityID, &mappedClass)
			if err != nil {
				http.Error(w, "core ETF is not configured in Analysis", http.StatusBadRequest)
				return
			}
			if normalizePrimaryAssetClass(mappedClass) != assetClass {
				http.Error(w, "core ETF must be assigned to this asset class", http.StatusBadRequest)
				return
			}
			current.CoreSecurityID = securityID
		}
	}

	_, err := db.Exec(`
		INSERT INTO asset_class_etf_policies (
			asset_class, core_security_id, core_ticker, core_ratio_pct,
			momentum_influence_pct, updated_at
		) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(asset_class) DO UPDATE SET
			core_security_id = excluded.core_security_id,
			core_ticker = excluded.core_ticker,
			core_ratio_pct = excluded.core_ratio_pct,
			momentum_influence_pct = excluded.momentum_influence_pct,
			updated_at = CURRENT_TIMESTAMP
	`, assetClass, current.CoreSecurityID, current.CoreTicker, current.CoreRatioPct, current.MomentumInfluencePct)
	if err != nil {
		log.Printf("[ETF] Failed to update Core ETF policy for %s: %v", assetClass, err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	ledger, err := buildETFAllocationLedger(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ledger)
}

func calculateCoreMomentumTarget(baseValue, modelWeight, neutralWeight, influencePct float64, hasModelWeight bool) (float64, float64) {
	if baseValue <= 0 || !hasModelWeight || neutralWeight <= 0 {
		return 0, math.Max(baseValue, 0)
	}
	relativeWeight := modelWeight / neutralWeight
	relativeWeight = math.Max(0.5, math.Min(1.5, relativeWeight))
	influence := math.Max(0, math.Min(100, influencePct)) / 100
	adjustment := baseValue * (relativeWeight - 1) * influence
	return adjustment, math.Max(baseValue+adjustment, 0)
}

func resolveConfiguredCoreTicker(
	assetClass string,
	configured etfCorePolicyDBRow,
	found bool,
	mappings map[string]etfMappingDBRow,
) (string, string) {
	if !found || configured.CoreTicker == "" {
		return "", ""
	}
	mapped, exists := mappings[configured.CoreTicker]
	if !exists || !mapped.Active || mapped.AssetClass != assetClass {
		return "", ""
	}
	return configured.CoreTicker, "CONFIGURED"
}

func loadETFAssetClassMappings(activeOnly bool) ([]etfMappingDBRow, error) {
	return loadETFAssetClassMappingsFrom(db, activeOnly)
}

func loadETFAssetClassMappingsFrom(reader fundingReader, activeOnly bool) ([]etfMappingDBRow, error) {
	query := `
		SELECT COALESCE(ticker, ''), COALESCE(primary_asset_class, ''), COALESCE(name, '')
		FROM stock_analysis
		WHERE UPPER(COALESCE(security_type, '')) = 'ETF'
		  AND TRIM(COALESCE(ticker, '')) != ''
	`
	if activeOnly {
		query += ` AND TRIM(COALESCE(primary_asset_class, '')) != ''`
	}
	query += `
		ORDER BY
			CASE WHEN TRIM(COALESCE(primary_asset_class, '')) = '' THEN 1 ELSE 0 END,
			updated_at DESC,
			id DESC
	`

	rows, err := reader.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	mappings := []etfMappingDBRow{}
	seen := map[string]bool{}
	for rows.Next() {
		var mapping etfMappingDBRow
		if err := rows.Scan(&mapping.Ticker, &mapping.AssetClass, &mapping.DisplayName); err != nil {
			return nil, err
		}
		mapping.Ticker = canonicalSecurityTickerKey(mapping.Ticker)
		if mapping.Ticker == "" || seen[mapping.Ticker] {
			continue
		}
		seen[mapping.Ticker] = true
		mapping.AssetClass = normalizePrimaryAssetClass(mapping.AssetClass)
		mapping.Active = mapping.AssetClass != ""
		if activeOnly && !mapping.Active {
			continue
		}
		if mapping.Active {
			// The stored class is what the rest of the app shows, so re-resolution
			// may only canonicalise it — never relocate the fund and never make it
			// disappear. A class that does not resolve to an assignable sleeve is
			// kept verbatim and flagged, so the monitor agrees with Positions and
			// the reason a target is missing stays visible.
			if resolved, ok := resolvePortfolioAssignmentClass(mapping.AssetClass); ok && resolved != "" {
				mapping.AssetClass = resolved
			} else {
				mapping.Unassignable = true
			}
		}
		mappings = append(mappings, mapping)
	}
	return mappings, rows.Err()
}

func loadETFAllocationRows() ([]etfAllocationDBRow, error) {
	return loadETFAllocationRowsFrom(db)
}

func loadETFAllocationRowsFrom(reader fundingReader) ([]etfAllocationDBRow, error) {
	rows, err := reader.Query(`
		SELECT ticker, allocation_percent, base_weight, COALESCE(tactical_status, 'BUY')
		FROM etf_allocations
		ORDER BY allocation_percent DESC, ticker ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	allocations := []etfAllocationDBRow{}
	for rows.Next() {
		var allocation etfAllocationDBRow
		if err := rows.Scan(&allocation.Ticker, &allocation.AllocationPercent, &allocation.BaseWeight, &allocation.TacticalStatus); err != nil {
			return nil, err
		}
		allocation.Ticker = strings.ToUpper(strings.TrimSpace(allocation.Ticker))
		allocation.TacticalStatus = strings.ToUpper(strings.TrimSpace(allocation.TacticalStatus))
		if allocation.TacticalStatus == "" {
			allocation.TacticalStatus = "BUY"
		}
		if allocation.AllocationPercent < 0 {
			allocation.AllocationPercent = 0
		}
		if allocation.BaseWeight < 0 {
			allocation.BaseWeight = 0
		}
		allocations = append(allocations, allocation)
	}
	return allocations, rows.Err()
}

func loadETFAllocationRowsForSource(source string) ([]etfAllocationDBRow, error) {
	return loadETFAllocationRowsForSourceFrom(db, source)
}

func loadETFAllocationRowsForSourceFrom(reader fundingReader, source string) ([]etfAllocationDBRow, error) {
	legacyRows, err := loadETFAllocationRowsFrom(reader)
	if err != nil {
		return nil, err
	}
	if source != "INTERNAL_PUBLISHED" {
		return legacyRows, nil
	}

	tacticalByTicker := make(map[string]string, len(legacyRows))
	for _, row := range legacyRows {
		tacticalByTicker[row.Ticker] = row.TacticalStatus
	}

	var runID int64
	if err := reader.QueryRow(`
		SELECT id
		FROM etf_momentum_runs
		WHERE status = 'COMPLETE'
		  AND published_at IS NOT NULL
		ORDER BY published_at DESC, id DESC
		LIMIT 1
	`).Scan(&runID); err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("internal ETF momentum is selected but no published complete run exists")
		}
		return nil, err
	}

	rows, err := reader.Query(`
		SELECT display_ticker, COALESCE(final_weight_pct, 0)
		FROM etf_momentum_run_rows
		WHERE run_id = ?
		ORDER BY COALESCE(final_weight_pct, 0) DESC, display_ticker ASC
	`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	allocations := []etfAllocationDBRow{}
	for rows.Next() {
		var ticker string
		var weight float64
		if err := rows.Scan(&ticker, &weight); err != nil {
			return nil, err
		}
		ticker = canonicalSecurityTickerKey(ticker)
		if ticker == "" {
			continue
		}
		tacticalStatus := tacticalByTicker[ticker]
		if tacticalStatus == "" {
			tacticalStatus = "BUY"
		}
		allocations = append(allocations, etfAllocationDBRow{
			Ticker:            ticker,
			AllocationPercent: math.Max(weight, 0),
			BaseWeight:        math.Max(weight, 0),
			TacticalStatus:    tacticalStatus,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(allocations) == 0 {
		return nil, fmt.Errorf("internal ETF momentum run %d has no allocation rows", runID)
	}
	return allocations, nil
}

func etfMomentumModelTickerSet(source string, allocations []etfAllocationDBRow) map[string]bool {
	tickers := map[string]bool{}
	if source == "INTERNAL_PUBLISHED" {
		for _, allocation := range allocations {
			ticker := canonicalSecurityTickerKey(allocation.Ticker)
			if ticker != "" {
				tickers[ticker] = true
			}
		}
		return tickers
	}

	// Alert setup and Core selection can add operational ETFs to the
	// compatibility table. They do not become PineScript universe members.
	for _, member := range etfMomentumLegacyUniverse {
		ticker := canonicalSecurityTickerKey(member.DisplayTicker)
		if ticker != "" {
			tickers[ticker] = true
		}
	}
	return tickers
}

func loadETFActualValues() (map[string]float64, error) {
	actuals := map[string]float64{}
	var statementID int
	err := db.QueryRow(`
		SELECT id FROM account_statements
		ORDER BY statement_date DESC, id DESC
		LIMIT 1
	`).Scan(&statementID)
	if err == sql.ErrNoRows {
		return actuals, nil
	}
	if err != nil {
		return nil, err
	}

	rows, err := db.Query(fmt.Sprintf(`
		SELECT UPPER(cm.ticker), SUM(sh.value_aud)
		FROM statement_holdings sh
		JOIN company_mappings cm ON sh.details = cm.company_name
		WHERE sh.statement_id = ?
			AND TRIM(COALESCE(cm.ticker, '')) != ''
			AND (
				EXISTS (
					SELECT 1 FROM etf_allocations ea
					WHERE UPPER(TRIM(ea.ticker)) = UPPER(TRIM(cm.ticker))
				)
				OR EXISTS (
					SELECT 1 FROM stock_analysis sa
					WHERE UPPER(COALESCE(sa.security_type, '')) = 'ETF'
						AND (
							(sh.security_id IS NOT NULL AND sa.security_id = sh.security_id)
							OR %s = UPPER(TRIM(cm.ticker))
						)
				)
			)
		GROUP BY UPPER(cm.ticker)
	`, stockAnalysisTickerKeySQL("sa.ticker")), statementID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var ticker string
		var value float64
		if err := rows.Scan(&ticker, &value); err != nil {
			return nil, err
		}
		actuals[strings.ToUpper(strings.TrimSpace(ticker))] = value
	}
	return actuals, rows.Err()
}

func assetClassDisplayNameByCode() map[string]string {
	rows, err := db.Query(`
		SELECT code, display_name
		FROM asset_classes
		WHERE active = 1
	`)
	if err != nil {
		return map[string]string{}
	}
	defer rows.Close()

	names := map[string]string{}
	for rows.Next() {
		var code, displayName string
		if err := rows.Scan(&code, &displayName); err != nil {
			continue
		}
		names[normalizePrimaryAssetClass(code)] = strings.TrimSpace(displayName)
	}
	return names
}

func buildETFAllocationLedger(ctx context.Context) (ETFAllocationLedgerResponse, error) {
	portfolioCtx, err := buildOverlayPortfolioContext(ctx)
	if err != nil {
		return ETFAllocationLedgerResponse{}, err
	}
	return buildETFAllocationLedgerFrom(db, portfolioCtx)
}

func buildETFAllocationLedgerFrom(reader deploymentReader, portfolioCtx *overlayPortfolioContext) (ETFAllocationLedgerResponse, error) {
	policy := loadETFAllocationPolicyFrom(reader)
	totalValue := portfolioCtx.StatementTotalValue

	approvedWeightByClass, err := deploymentApprovedWeights(reader)
	if err != nil {
		return ETFAllocationLedgerResponse{}, err
	}
	hasApprovedShape := len(approvedWeightByClass) > 0

	allocations, err := loadETFAllocationRowsForSourceFrom(reader, policy.MomentumSource)
	if err != nil {
		return ETFAllocationLedgerResponse{}, err
	}
	mappings, err := loadETFAssetClassMappingsFrom(reader, true)
	if err != nil {
		return ETFAllocationLedgerResponse{}, err
	}
	actualValues := portfolioCtx.ETFActualByTicker
	displayNames := assetClassDisplayNameByCode()
	corePolicies, err := loadETFCorePoliciesFrom(reader)
	if err != nil {
		return ETFAllocationLedgerResponse{}, err
	}

	mappingByTicker := map[string]etfMappingDBRow{}
	candidatesByClass := map[string][]string{}
	for _, mapping := range mappings {
		mappingByTicker[mapping.Ticker] = mapping
		if mapping.Active {
			candidatesByClass[mapping.AssetClass] = append(candidatesByClass[mapping.AssetClass], mapping.Ticker)
		}
	}
	coreTickerByClass := map[string]string{}
	coreSourceByClass := map[string]string{}
	coreRatioByClass := map[string]float64{}
	momentumInfluenceByClass := map[string]float64{}
	for assetClass := range candidatesByClass {
		coreRatioByClass[assetClass] = policy.DefaultCoreRatioPct
		momentumInfluenceByClass[assetClass] = policy.MomentumInfluencePct
		if configured, found := corePolicies[assetClass]; found {
			coreRatioByClass[assetClass] = configured.CoreRatioPct
			momentumInfluenceByClass[assetClass] = configured.MomentumInfluencePct
			coreTickerByClass[assetClass], coreSourceByClass[assetClass] = resolveConfiguredCoreTicker(
				assetClass,
				configured,
				found,
				mappingByTicker,
			)
		}
	}

	// Membership has two doors, and both are deliberate.
	//
	//	a mapping record   the fund was selected to express its class. Today that
	//	                   record is asset_class_etf_policies.core_ticker; when the
	//	                   (class, fund) mapping table lands it is that instead.
	//	holding capital    the fund holds money on the latest statement. Money in
	//	                   the book cannot be invisible, even with no stated intent
	//	                   behind it, so it earns a row AND a gap-report entry.
	//
	// Notably NOT a door: stock_analysis.primary_asset_class on its own. That
	// column is analysis metadata written for every ETF ever researched — sold-out
	// funds, never-held funds, placeholder classes — so admitting on it alone puts
	// the whole research universe in the ledger. A classed fund that is neither
	// selected nor held is a candidate, not a row.
	//
	// Also not a door: a legacy TradingView weight in etf_allocations. That is a
	// model output, not a portfolio decision.
	//
	// Per DOCS/decisions/ETF_MODEL_PROPOSAL.md §2.
	seenTicker := map[string]bool{}
	for _, coreTicker := range coreTickerByClass {
		if coreTicker != "" {
			seenTicker[coreTicker] = true
		}
	}
	for ticker, value := range actualValues {
		if value > 0 {
			seenTicker[ticker] = true
		}
	}

	tickers := make([]string, 0, len(seenTicker))
	for ticker := range seenTicker {
		tickers = append(tickers, ticker)
	}
	sort.Strings(tickers)

	allocationByTicker := map[string]etfAllocationDBRow{}
	for _, allocation := range allocations {
		allocationByTicker[allocation.Ticker] = allocation
	}
	managementModes, err := applyETFManagementStates(reader, allocationByTicker)
	if err != nil {
		return ETFAllocationLedgerResponse{}, err
	}

	totalModelWeight := 0.0
	modelMemberCount := 0
	modelTickers := etfMomentumModelTickerSet(policy.MomentumSource, allocations)
	for _, allocation := range allocations {
		if !modelTickers[allocation.Ticker] {
			continue
		}
		weight := allocation.AllocationPercent
		if weight <= 0 {
			weight = allocation.BaseWeight
		}
		totalModelWeight += math.Max(weight, 0)
		modelMemberCount++
	}
	neutralModelWeight := 0.0
	if modelMemberCount > 0 && totalModelWeight > 0 {
		neutralModelWeight = totalModelWeight / float64(modelMemberCount)
	}

	coreBaseByTicker := map[string]float64{}
	momentumAdjustmentByTicker := map[string]float64{}
	recommendedTargetByTicker := map[string]float64{}
	effectiveTargetByTicker := map[string]float64{}
	effectiveTargetRatioByClass := map[string]float64{}
	classTargetByCode := map[string]float64{}
	for assetClass, weightPct := range approvedWeightByClass {
		classTargetByCode[assetClass] = totalValue * (weightPct / 100)
	}
	for assetClass, coreTicker := range coreTickerByClass {
		classTarget := classTargetByCode[assetClass]
		if coreTicker == "" {
			continue
		}
		allocation, hasAllocation := allocationByTicker[coreTicker]
		hasModelAllocation := hasAllocation && modelTickers[coreTicker]
		modelWeight := allocation.AllocationPercent
		if modelWeight <= 0 {
			modelWeight = allocation.BaseWeight
		}
		adjustmentRatio, recommendedRatio := calculateCoreMomentumTarget(
			coreRatioByClass[assetClass],
			math.Max(modelWeight, 0),
			neutralModelWeight,
			momentumInfluenceByClass[assetClass],
			hasModelAllocation,
		)
		recommendedRatio = math.Min(recommendedRatio, 100)
		adjustmentRatio = recommendedRatio - coreRatioByClass[assetClass]
		effectiveRatio := recommendedRatio
		if strings.EqualFold(allocation.TacticalStatus, "SELL") {
			effectiveRatio = 0
		}
		effectiveTargetRatioByClass[assetClass] = effectiveRatio

		baseValue := 0.0
		adjustment := 0.0
		recommended := 0.0
		effective := 0.0
		if hasApprovedShape && classTarget > 0 {
			baseValue = classTarget * (coreRatioByClass[assetClass] / 100)
			adjustment = classTarget * (adjustmentRatio / 100)
			recommended = classTarget * (recommendedRatio / 100)
			effective = classTarget * (effectiveRatio / 100)
		}
		coreBaseByTicker[coreTicker] = baseValue
		momentumAdjustmentByTicker[coreTicker] = adjustment
		recommendedTargetByTicker[coreTicker] = recommended
		effectiveTargetByTicker[coreTicker] = effective
	}

	rows := make([]ETFAllocationLedgerRow, 0, len(tickers))
	actualETFValue := 0.0
	coreTargetTotal := 0.0
	momentumAdjustmentTotal := 0.0
	recommendedTargetTotal := 0.0
	effectiveTargetTotal := 0.0
	classActualByCode := map[string]float64{}
	for _, ticker := range tickers {
		allocation := allocationByTicker[ticker]
		mapping, hasMapping := mappingByTicker[ticker]
		assetClass := "UNASSIGNED"
		displayName := ticker
		if hasMapping {
			assetClass = mapping.AssetClass
			if strings.TrimSpace(mapping.DisplayName) != "" {
				displayName = mapping.DisplayName
			}
		}
		assetClassName := displayNames[assetClass]
		if assetClassName == "" {
			assetClassName = assetClass
		}
		actualValue := actualValues[ticker]
		coreTarget := coreBaseByTicker[ticker]
		momentumAdjustment := momentumAdjustmentByTicker[ticker]
		recommendedTarget := recommendedTargetByTicker[ticker]
		targetValue := effectiveTargetByTicker[ticker]
		isCore := coreTickerByClass[assetClass] == ticker && ticker != ""
		// Defensive restatement of the membership rule above: selected, or holding
		// capital. A selected fund at zero keeps its row — the class is expressed
		// in intent and currently unexpressed in fact, which is the state most
		// worth seeing.
		if !isCore && actualValue <= 0 {
			continue
		}

		status := "WATCH"
		if isCore && allocation.TacticalStatus == "SELL" {
			status = "SELL"
		} else if isCore && targetValue > 0 {
			status = "BUY"
		}

		coreActual := math.Min(actualValue, coreTarget)
		positiveAdjustment := math.Max(momentumAdjustment, 0)
		tacticalActual := math.Min(math.Max(actualValue-coreTarget, 0), positiveAdjustment)
		excessValue := math.Max(actualValue-targetValue, 0)
		remaining := math.Max(targetValue-actualValue, 0)

		bookTargetPct := 0.0
		if totalValue > 0 {
			bookTargetPct = (targetValue / totalValue) * 100
		}

		rows = append(rows, ETFAllocationLedgerRow{
			ManagementMode:          firstNonEmpty(managementModes[ticker], "etf_tms"),
			Ticker:                  ticker,
			DisplayName:             displayName,
			AssetClass:              assetClass,
			AssetClassName:          assetClassName,
			MomentumWeightPct:       allocation.AllocationPercent,
			IsCore:                  isCore,
			CoreSelectionSource:     coreSourceByClass[assetClass],
			CoreRatioPct:            coreRatioByClass[assetClass],
			MomentumInfluencePct:    momentumInfluenceByClass[assetClass],
			ClassTargetValue:        classTargetByCode[assetClass],
			MomentumAdjustmentValue: momentumAdjustment,
			RecommendedTargetValue:  recommendedTarget,
			EffectiveTargetValue:    targetValue,
			TargetDeltaValue:        targetValue - actualValue,
			BookTargetPct:           bookTargetPct,
			TargetWeightPct:         0,
			ActualValue:             actualValue,
			CoreTargetValue:         coreTarget,
			TacticalTargetValue:     positiveAdjustment,
			FinalTargetValue:        targetValue,
			CoreActualValue:         coreActual,
			TacticalActualValue:     tacticalActual,
			ExcessValue:             excessValue,
			RemainingValue:          remaining,
			TacticalStatus:          allocation.TacticalStatus,
			AssetClassUnassignable:  mapping.Unassignable,
			ClassNotInShape:         hasApprovedShape && assetClass != "UNASSIGNED" && approvedWeightByClass[assetClass] <= 0,
			Status:                  status,
		})
		actualETFValue += actualValue
		classActualByCode[assetClass] += actualValue
		coreTargetTotal += coreTarget
		momentumAdjustmentTotal += momentumAdjustment
		recommendedTargetTotal += recommendedTarget
		effectiveTargetTotal += targetValue
	}

	suggestedETFValue := totalValue * (policy.SuggestedExposurePct / 100)
	denominator := math.Max(effectiveTargetTotal, suggestedETFValue)
	for i := range rows {
		if denominator > 0 {
			rows[i].TargetWeightPct = (rows[i].FinalTargetValue / denominator) * 100
		}
	}

	sort.Slice(rows, func(i, j int) bool {
		if math.Abs(rows[i].TargetWeightPct-rows[j].TargetWeightPct) > 0.0001 {
			return rows[i].TargetWeightPct > rows[j].TargetWeightPct
		}
		return rows[i].Ticker < rows[j].Ticker
	})

	classKeys := map[string]bool{}
	for assetClass := range classTargetByCode {
		classKeys[assetClass] = true
	}
	for assetClass := range candidatesByClass {
		classKeys[assetClass] = true
	}
	for assetClass := range classActualByCode {
		if assetClass != "UNASSIGNED" {
			classKeys[assetClass] = true
		}
	}
	classes := make([]ETFAllocationClassSummary, 0, len(classKeys))
	for assetClass := range classKeys {
		coreTicker := coreTickerByClass[assetClass]
		baseValue := coreBaseByTicker[coreTicker]
		adjustment := momentumAdjustmentByTicker[coreTicker]
		recommended := recommendedTargetByTicker[coreTicker]
		effective := effectiveTargetByTicker[coreTicker]
		classTarget := classTargetByCode[assetClass]
		name := displayNames[assetClass]
		if name == "" {
			name = assetClass
		}
		classes = append(classes, ETFAllocationClassSummary{
			AssetClass:              assetClass,
			AssetClassName:          name,
			ClassTargetValue:        classTarget,
			CoreTicker:              coreTicker,
			CoreSelectionSource:     coreSourceByClass[assetClass],
			CoreRatioPct:            coreRatioByClass[assetClass],
			MomentumInfluencePct:    momentumInfluenceByClass[assetClass],
			CoreBaseValue:           baseValue,
			MomentumAdjustmentValue: adjustment,
			RecommendedTargetValue:  recommended,
			EffectiveTargetValue:    effective,
			EffectiveTargetRatioPct: effectiveTargetRatioByClass[assetClass],
			ActualETFValue:          classActualByCode[assetClass],
			TargetDeltaValue:        effective - classActualByCode[assetClass],
			StockCapacityValue:      directStockBudget(classTarget, effective, classActualByCode[assetClass]),
		})
	}
	sort.Slice(classes, func(i, j int) bool {
		if math.Abs(classes[i].ClassTargetValue-classes[j].ClassTargetValue) > 0.01 {
			return classes[i].ClassTargetValue > classes[j].ClassTargetValue
		}
		return classes[i].AssetClassName < classes[j].AssetClassName
	})

	actualExposurePct := 0.0
	if totalValue > 0 {
		actualExposurePct = actualETFValue / totalValue * 100
	}

	// Unselected, unheld funds remain candidates. Their rank does not select a
	// Core; automatic momentum sizing applies only after explicit Core selection.
	candidates := []ETFAllocationCandidate{}
	for ticker, mapping := range mappingByTicker {
		if seenTicker[ticker] || !mapping.Active {
			continue
		}
		assetClassName := displayNames[mapping.AssetClass]
		if assetClassName == "" {
			assetClassName = mapping.AssetClass
		}
		displayName := mapping.DisplayName
		if strings.TrimSpace(displayName) == "" {
			displayName = ticker
		}
		candidates = append(candidates, ETFAllocationCandidate{
			Ticker:            ticker,
			DisplayName:       displayName,
			AssetClass:        mapping.AssetClass,
			AssetClassName:    assetClassName,
			MomentumWeightPct: allocationByTicker[ticker].AllocationPercent,
		})
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].MomentumWeightPct != candidates[j].MomentumWeightPct {
			return candidates[i].MomentumWeightPct > candidates[j].MomentumWeightPct
		}
		return candidates[i].Ticker < candidates[j].Ticker
	})

	return ETFAllocationLedgerResponse{
		AsOf:   time.Now().UTC(),
		Policy: policy,
		Summary: ETFAllocationLedgerSummary{
			PortfolioValue:             totalValue,
			SuggestedETFValue:          suggestedETFValue,
			SuggestedExposurePct:       policy.SuggestedExposurePct,
			ActualExposurePct:          actualExposurePct,
			MomentumAdjustmentValue:    momentumAdjustmentTotal,
			RecommendedTargetValue:     recommendedTargetTotal,
			EffectiveTargetValue:       effectiveTargetTotal,
			RemainingToSuggestionValue: math.Max(suggestedETFValue-actualETFValue, 0),
			MinimumETFValue:            suggestedETFValue,
			ActualETFValue:             actualETFValue,
			CoreTargetValue:            coreTargetTotal,
			TacticalTargetValue:        math.Max(momentumAdjustmentTotal, 0),
			FinalTargetValue:           effectiveTargetTotal,
			RemainingToMinimumValue:    math.Max(suggestedETFValue-actualETFValue, 0),
			RemainingToTargetValue:     math.Max(effectiveTargetTotal-actualETFValue, 0),
			HasApprovedShape:           hasApprovedShape,
		},
		Classes:    classes,
		Rows:       rows,
		Candidates: candidates,
	}, nil
}

// getETFAllocations returns current ETF portfolio allocations
func getETFAllocations(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`
		SELECT ticker, allocation_percent, base_weight, tactical_status, last_updated
		FROM etf_allocations
		ORDER BY allocation_percent DESC
	`)
	if err != nil {
		log.Printf("[API] Failed to query ETF allocations: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type ETFAllocation struct {
		Ticker            string    `json:"ticker"`
		AllocationPercent float64   `json:"allocation_percent"`
		BaseWeight        float64   `json:"base_weight"`
		TacticalStatus    string    `json:"tactical_status"`
		LastUpdated       time.Time `json:"last_updated"`
	}

	var allocations []ETFAllocation
	for rows.Next() {
		var allocation ETFAllocation
		var tacticalStatus sql.NullString
		if err := rows.Scan(&allocation.Ticker, &allocation.AllocationPercent, &allocation.BaseWeight, &tacticalStatus, &allocation.LastUpdated); err != nil {
			log.Printf("[API] Failed to scan ETF allocation: %v", err)
			continue
		}
		if tacticalStatus.Valid {
			allocation.TacticalStatus = tacticalStatus.String
		}
		allocations = append(allocations, allocation)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(allocations)
}

// rebalanceETFAllocations normalizes allocation_percent among BUY ETFs using base_weight ratios.
// SELL ETFs are set to 0%. This is a manual user action taken after selling a position.
func rebalanceETFAllocations(w http.ResponseWriter, r *http.Request) {
	// Fetch all ETF allocations
	rows, err := db.Query(`SELECT ticker, base_weight, tactical_status FROM etf_allocations`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type etfRow struct {
		ticker         string
		baseWeight     float64
		tacticalStatus string
	}

	var etfs []etfRow
	for rows.Next() {
		var e etfRow
		var ts sql.NullString
		if err := rows.Scan(&e.ticker, &e.baseWeight, &ts); err != nil {
			continue
		}
		if ts.Valid {
			e.tacticalStatus = ts.String
		} else {
			e.tacticalStatus = "BUY" // default
		}
		etfs = append(etfs, e)
	}
	rows.Close()

	// Sum base_weights of active (BUY) ETFs
	var totalActiveWeight float64
	for _, e := range etfs {
		if e.tacticalStatus != "SELL" && e.baseWeight > 0 {
			totalActiveWeight += e.baseWeight
		}
	}

	if totalActiveWeight == 0 {
		http.Error(w, "no active ETFs with base weights to rebalance", http.StatusBadRequest)
		return
	}

	// Update each ETF: normalize BUY ETFs, zero out SELL ETFs
	tx, err := db.Begin()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	for _, e := range etfs {
		var newAlloc float64
		if e.tacticalStatus != "SELL" && e.baseWeight > 0 {
			newAlloc = (e.baseWeight / totalActiveWeight) * 100.0
		}
		_, err := tx.Exec(`
			UPDATE etf_allocations
			SET allocation_percent = ?, last_updated = CURRENT_TIMESTAMP
			WHERE ticker = ?
		`, newAlloc, e.ticker)
		if err != nil {
			tx.Rollback()
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		log.Printf("[ETF REBALANCE] %s: %.2f%% (tactical: %s)", e.ticker, newAlloc, e.tacticalStatus)
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	log.Printf("[ETF REBALANCE] Manual rebalance completed across %d ETFs (active weight: %.2f%%)", len(etfs), totalActiveWeight)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message":      "Rebalance complete",
		"active_etfs":  len(etfs),
		"total_weight": totalActiveWeight,
	})
}

// getETFActualAllocations returns actual portfolio allocations for each ETF ticker
func getETFActualAllocations(w http.ResponseWriter, r *http.Request) {
	// Get the latest statement ID
	var statementID int
	err := db.QueryRow(`
		SELECT id FROM account_statements
		ORDER BY statement_date DESC, id DESC
		LIMIT 1
	`).Scan(&statementID)

	if err != nil {
		log.Printf("[API] Failed to get latest statement: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Query actual allocations from holdings mapped to tickers that exist in the ETF allocation table.
	rows, err := db.Query(`
		SELECT
			cm.ticker as etf_ticker,
			SUM(sh.value_aud) as total_value
		FROM statement_holdings sh
		JOIN company_mappings cm ON sh.details = cm.company_name
		JOIN etf_allocations ea ON cm.ticker = ea.ticker
		WHERE sh.statement_id = ?
			AND cm.ticker IS NOT NULL
		GROUP BY cm.ticker
		ORDER BY total_value DESC
	`, statementID)

	if err != nil {
		log.Printf("[API] Failed to query ETF actual allocations: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type ActualAllocation struct {
		Ticker     string  `json:"ticker"`
		TotalValue float64 `json:"total_value"`
	}

	var allocations []ActualAllocation
	for rows.Next() {
		var allocation ActualAllocation
		if err := rows.Scan(&allocation.Ticker, &allocation.TotalValue); err != nil {
			log.Printf("[API] Failed to scan actual allocation: %v", err)
			continue
		}
		allocations = append(allocations, allocation)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(allocations)
}

// handlePositionUpdate implements differentiated sell logic and position management
func handlePositionUpdate(ticker, signal, source string, cdfStopStateValue ...string) {
	defer syncManagedETFTacticalState(ticker)
	source = normalizeAlertScript(source)
	cdfStopState := ""
	if len(cdfStopStateValue) > 0 {
		cdfStopState = normalizeCDFStopState(cdfStopStateValue[0])
	}

	if signal == "BUY" || signal == "BREAKOUT" {
		// BUY or BREAKOUT signal - set position to BUY and record entry date
		// BREAKOUT from CDF creates position, BREAKOUT from TMS indicates breakout on existing position
		_, err := db.Exec(`
			INSERT INTO security_positions (ticker, position_state, entry_date, last_updated)
			VALUES (?, 'BUY', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
			ON CONFLICT(ticker) DO UPDATE SET
				position_state = CASE
					WHEN manual_override = 1 THEN position_state
					ELSE 'BUY'
				END,
				entry_date = CASE
					WHEN manual_override = 1 THEN entry_date
					WHEN position_state = 'SELL' THEN CURRENT_TIMESTAMP
					ELSE entry_date
				END,
				stopped_waiting_reentry = 0,
				last_updated = CURRENT_TIMESTAMP
		`, ticker)

		if err != nil {
			log.Printf("[ALPHA EDGE] Failed to update position for %s: %v", ticker, err)
		} else {
			log.Printf("[ALPHA EDGE] Updated position: %s -> BUY (source: %s, signal: %s)", ticker, source, signal)
		}
		// Sync tactical_status in etf_allocations if this ticker is in the ETF sleeve
		if source == "cdf" || source == "etf_tms" {
			db.Exec(`UPDATE etf_allocations SET tactical_status = 'BUY', last_updated = CURRENT_TIMESTAMP WHERE ticker = ?`, ticker)
		}
	} else if signal == "SELL_50" {
		if source == "tms" {
			_, err := db.Exec(`
				INSERT INTO security_positions (ticker, position_state, stopped_waiting_reentry, last_updated)
				VALUES (?, 'SELL', 1, CURRENT_TIMESTAMP)
				ON CONFLICT(ticker) DO UPDATE SET
					position_state = CASE
						WHEN manual_override = 1 THEN position_state
						ELSE 'SELL'
					END,
					stopped_waiting_reentry = CASE
						WHEN manual_override = 1 THEN stopped_waiting_reentry
						ELSE 1
					END,
					last_updated = CURRENT_TIMESTAMP
			`, ticker)

			if err != nil {
				log.Printf("[ALPHA EDGE] Failed to update position for %s: %v", ticker, err)
			} else {
				log.Printf("[ALPHA EDGE] TMS STOP hit in CDF BUY: %s -> SELL_50 (waiting for re-entry)", ticker)
			}
		}
	} else if signal == "SELL" {
		// Differentiated SELL logic based on source
		if source == "cdf" {
			// CDF sell = trend/deployment filter has turned bearish, update position state to SELL
			_, err := db.Exec(`
				INSERT INTO security_positions (ticker, position_state, last_updated)
				VALUES (?, 'SELL', CURRENT_TIMESTAMP)
				ON CONFLICT(ticker) DO UPDATE SET
					position_state = CASE
						WHEN manual_override = 1 THEN position_state
						ELSE 'SELL'
					END,
					last_updated = CURRENT_TIMESTAMP
			`, ticker)
			if err != nil {
				log.Printf("[ALPHA EDGE] Failed to update CDF position for %s: %v", ticker, err)
			} else {
				log.Printf("[ALPHA EDGE] CDF SELL: %s -> SELL", ticker)
			}
			// Also sync tactical_status in etf_allocations if this ticker is in the ETF sleeve
			db.Exec(`UPDATE etf_allocations SET tactical_status = 'SELL', last_updated = CURRENT_TIMESTAMP WHERE ticker = ?`, ticker)
		} else if source == "etf_tms" {
			// ETF TMS sell = zone has turned bearish, update position state to SELL
			_, err := db.Exec(`
				INSERT INTO security_positions (ticker, position_state, last_updated)
				VALUES (?, 'SELL', CURRENT_TIMESTAMP)
				ON CONFLICT(ticker) DO UPDATE SET
					position_state = CASE
						WHEN manual_override = 1 THEN position_state
						ELSE 'SELL'
					END,
					last_updated = CURRENT_TIMESTAMP
			`, ticker)
			if err != nil {
				log.Printf("[ALPHA EDGE] Failed to update ETF TMS position for %s: %v", ticker, err)
			} else {
				log.Printf("[ALPHA EDGE] ETF TMS SELL: %s -> SELL", ticker)
			}
			// Also sync tactical_status in etf_allocations
			db.Exec(`UPDATE etf_allocations SET tactical_status = 'SELL', last_updated = CURRENT_TIMESTAMP WHERE ticker = ?`, ticker)
		} else if source == "tms" {
			// TMS stop with explicit embedded CDF SELL = full exit; do not wait for re-entry.
			// Missing CDF state keeps legacy waiting behaviour until all live scripts emit cdf_state.
			waitForReentry := cdfStopState != "SELL"
			waitFlag := 0
			if waitForReentry {
				waitFlag = 1
			}
			_, err := db.Exec(`
				INSERT INTO security_positions (ticker, position_state, stopped_waiting_reentry, last_updated)
				VALUES (?, 'SELL', ?, CURRENT_TIMESTAMP)
				ON CONFLICT(ticker) DO UPDATE SET
					position_state = CASE
						WHEN manual_override = 1 THEN position_state
						ELSE 'SELL'
					END,
					stopped_waiting_reentry = CASE
						WHEN manual_override = 1 THEN stopped_waiting_reentry
						ELSE ?
					END,
					last_updated = CURRENT_TIMESTAMP
			`, ticker, waitFlag, waitFlag)

			if err != nil {
				log.Printf("[ALPHA EDGE] Failed to update position for %s: %v", ticker, err)
			} else {
				log.Printf("[ALPHA EDGE] TMS STOP hit: %s -> SELL (100%% exit, waiting for re-entry: %t)", ticker, waitForReentry)
			}
		} else if source == "q4d" || source == "q3d" || source == "ctf" {
			// Regime SELL = macro bearish, reduce allocation but don't force exit
			log.Printf("[ALPHA EDGE] REGIME SELL signal for %s - macro bearish, consider reducing allocation", ticker)
			// Don't automatically change position state for regime signals
			// User can manually adjust or rely on the asset-class overlay workflow
		}
	}
}
