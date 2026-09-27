package main

import (
	"fmt"
	"log"
	"sort"
	"strings"

	"trading-backend/internal/assetclass"
)

// Static asset-class registry and overlay defaults.
//
// Runtime asset-class identity must come from the asset_classes database table.
// These values are bootstrap/fallback data used to seed databases, migrate legacy
// rows, and supply presentation defaults when the DB is unavailable.

var q3ThrottleBucketFactors = map[string]float64{
	"full_q1":      1.0,
	"q1_defensive": 0.5,
	"q1_exempt":    0.1,
	"cash_reserve": 0,
}

func q3ThrottleFactorForSetting(setting OverlayAssetClassSetting) float64 {
	if setting.Q3ThrottleFactor != nil {
		return clampFloat(*setting.Q3ThrottleFactor, 0, 1)
	}
	if setting.OverlayEligible {
		if setting.Q3Beneficiary {
			return q3ThrottleBucketFactors["q1_defensive"]
		}
		return q3ThrottleBucketFactors["full_q1"]
	}
	switch setting.Key {
	case "ENERGY", "ENERGY_PRODUCERS", "ENERGY_COMMODITIES", "PHARMA", "PHARMA_BIOTECH", "HEALTHCARE", "HEALTHCARE_SERVICES", "BONDS", "FIXED_INCOME", "NATURAL_GAS", "PHYSICAL_GOLD", "PHYSICAL_SILVER", "DIRECT_COMMODITIES":
		return q3ThrottleBucketFactors["q1_exempt"]
	case "CASH", "CASH_RESERVE", "CASH_FLOATING", "MONEY_MARKET":
		return q3ThrottleBucketFactors["cash_reserve"]
	}
	return 0
}

func q4dLiquidityFactorForSetting(setting OverlayAssetClassSetting) float64 {
	if setting.Q4DLiquidityFactor != nil {
		return clampFloat(*setting.Q4DLiquidityFactor, 0, 1)
	}
	if setting.Key == "CASH" || setting.Key == "CASH_RESERVE" || setting.Key == "CASH_FLOATING" || setting.Key == "MONEY_MARKET" {
		return 0
	}
	return 1
}

var defaultAssetClassSettings = []AssetClass{
	{Code: "INSURANCE", AssetClassCode: "INSURANCE", DisplayName: "Insurance", ClassType: "ALLOCATION", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 95, Active: true},
	{Code: "STAPLES", AssetClassCode: "STAPLES", DisplayName: "Staples", ClassType: "ALLOCATION", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 110, Active: true},
	{Code: "GAMBLING", AssetClassCode: "GAMBLING", DisplayName: "Gambling", ClassType: "ALLOCATION", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 111, Active: true},
	{Code: "TECHNOLOGY", AssetClassCode: "TECHNOLOGY", DisplayName: "Technology", ClassType: "ALLOCATION", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 114, Active: true},
	{Code: "SEMICONDUCTORS", AssetClassCode: "SEMICONDUCTORS", DisplayName: "Semiconductors", ClassType: "ALLOCATION", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 116, Active: true},
	{Code: "INDUSTRIALS", AssetClassCode: "INDUSTRIALS", DisplayName: "Industrials", ClassType: "ALLOCATION", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 118, Active: true},
	{Code: "DEFENCE", AssetClassCode: "DEFENCE", DisplayName: "Defence", ClassType: "ALLOCATION", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 119, Active: true},
	{Code: "BONDS", AssetClassCode: "BONDS", DisplayName: "Bonds", ClassType: "ALLOCATION", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 150, Active: true},
	{Code: "BROAD_EQUITY", AssetClassCode: "BROAD_EQUITY", DisplayName: "Broad Equity", ClassType: "ALLOCATION", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1010, Active: true},
	{Code: "PHYSICAL_GOLD", AssetClassCode: "PHYSICAL_GOLD", DisplayName: "Physical Gold", ClassType: "ALLOCATION", ParentCode: "GOLD", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1020, Active: true},
	{Code: "GOLD_MINERS", AssetClassCode: "GOLD", DisplayName: "Gold Miners", ClassType: "ALLOCATION", ParentCode: "GOLD", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1025, Active: true},
	{Code: "PHYSICAL_SILVER", AssetClassCode: "PHYSICAL_SILVER", DisplayName: "Physical Silver", ClassType: "ALLOCATION", ParentCode: "SILVER", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1030, Active: true},
	{Code: "SILVER_MINERS", AssetClassCode: "SILVER", DisplayName: "Silver Miners", ClassType: "ALLOCATION", ParentCode: "SILVER", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1035, Active: true},
	{Code: "COPPER_MINERS", AssetClassCode: "COPPER", DisplayName: "Copper Miners", ClassType: "ALLOCATION", ParentCode: "COPPER", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1040, Active: true},
	{Code: "BASE_METALS_MINERS", AssetClassCode: "BASEMETALS", DisplayName: "Base Metals Miners", ClassType: "ALLOCATION", ParentCode: "BASEMETALS", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1045, Active: true},
	{Code: "LITHIUM_MINERS", AssetClassCode: "LITHIUM", DisplayName: "Lithium Miners", ClassType: "ALLOCATION", ParentCode: "LITHIUM", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1050, Active: true},
	{Code: "URANIUM_MINERS", AssetClassCode: "URANIUM", DisplayName: "Uranium Miners", ClassType: "ALLOCATION", ParentCode: "URANIUM", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1055, Active: true},
	{Code: "RARE_EARTHS_CRITICAL_MINERALS", AssetClassCode: "REE", DisplayName: "Rare Earths & Critical Minerals", ClassType: "ALLOCATION", ParentCode: "REE", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1060, Active: true},
	{Code: "IRON_ORE_MINERS", AssetClassCode: "IRON", DisplayName: "Iron Ore Miners", ClassType: "ALLOCATION", ParentCode: "IRON", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1065, Active: true},
	{Code: "DIVERSIFIED_MINERS", AssetClassCode: "MATERIALS", DisplayName: "Diversified Miners", ClassType: "ALLOCATION", ParentCode: "MATERIALS", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1070, Active: true},
	{Code: "MATERIALS_CHEMICALS", AssetClassCode: "MATERIALS_CHEMICALS", DisplayName: "Materials & Chemicals", ClassType: "ALLOCATION", ParentCode: "MATERIALS", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1075, Active: true},
	{Code: "FORESTRY_PAPER_PACKAGING", AssetClassCode: "FORESTRY_PAPER_PACKAGING", DisplayName: "Forestry, Paper & Packaging", ClassType: "ALLOCATION", ParentCode: "MATERIALS", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1080, Active: true},
	{Code: "STEEL_METALS_PROCESSING", AssetClassCode: "STEEL_METALS_PROCESSING", DisplayName: "Steel & Metals Processing", ClassType: "ALLOCATION", ParentCode: "MATERIALS", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1085, Active: true},
	{Code: "MINING_SERVICES", AssetClassCode: "MINING_SERVICES", DisplayName: "Mining Services", ClassType: "ALLOCATION", ParentCode: "MATERIALS", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1087, Active: true},
	{Code: "ENERGY_PRODUCERS", AssetClassCode: "ENERGY", DisplayName: "Energy Producers", ClassType: "ALLOCATION", ParentCode: "ENERGY", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1090, Active: true},
	{Code: "ENERGY_COMMODITIES", AssetClassCode: "ENERGY_COMMODITIES", DisplayName: "Energy Commodities", ClassType: "ALLOCATION", ParentCode: "ENERGY", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1095, Active: true},
	{Code: "AGRICULTURE_AGRIBUSINESS", AssetClassCode: "AGRICULTURE_AGRIBUSINESS", DisplayName: "Agriculture & Agribusiness", ClassType: "ALLOCATION", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1100, Active: true},
	{Code: "BANKS", AssetClassCode: "BANKS", DisplayName: "Banks", ClassType: "ALLOCATION", ParentCode: "FINANCIALS", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1105, Active: true},
	{Code: "CONSUMER_STAPLES", AssetClassCode: "CONSUMER_STAPLES", DisplayName: "Consumer Staples", ClassType: "ALLOCATION", ParentCode: "STAPLES", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1110, Active: true},
	{Code: "CONSUMER_DISCRETIONARY", AssetClassCode: "CONSUMER_DISCRETIONARY", DisplayName: "Consumer Discretionary", ClassType: "ALLOCATION", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1115, Active: true},
	{Code: "GAMING_GAMBLING", AssetClassCode: "GAMING_GAMBLING", DisplayName: "Gaming & Gambling", ClassType: "ALLOCATION", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1120, Active: true},
	{Code: "EDUCATION", AssetClassCode: "EDUCATION", DisplayName: "Education", ClassType: "ALLOCATION", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1125, Active: true},
	{Code: "MEDIA_PUBLISHING", AssetClassCode: "MEDIA_PUBLISHING", DisplayName: "Media & Publishing", ClassType: "ALLOCATION", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1130, Active: true},
	{Code: "TECHNOLOGY_PLATFORMS", AssetClassCode: "TECHNOLOGY_PLATFORMS", DisplayName: "Technology Platforms", ClassType: "ALLOCATION", ParentCode: "TECHNOLOGY", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1135, Active: true},
	{Code: "SOFTWARE_SAAS", AssetClassCode: "SOFTWARE_SAAS", DisplayName: "Software & SaaS", ClassType: "ALLOCATION", ParentCode: "TECHNOLOGY", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1140, Active: true},
	{Code: "CRYPTO_DIGITAL_ASSETS", AssetClassCode: "CRYPTO_DIGITAL_ASSETS", DisplayName: "Crypto & Digital Assets", ClassType: "ALLOCATION", ParentCode: "TECHNOLOGY", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1145, Active: true},
	{Code: "DATACENTRES", AssetClassCode: "DATACENTRES", DisplayName: "Datacentres", ClassType: "ALLOCATION", ParentCode: "TECHNOLOGY", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1150, Active: true},
	{Code: "TELECOMMUNICATIONS", AssetClassCode: "TELECOMMUNICATIONS", DisplayName: "Telecommunications", ClassType: "ALLOCATION", ParentCode: "TECHNOLOGY", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1155, Active: true},
	{Code: "CONSTRUCTION_ENGINEERING", AssetClassCode: "CONSTRUCTION_ENGINEERING", DisplayName: "Construction & Engineering", ClassType: "ALLOCATION", ParentCode: "INDUSTRIALS", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1160, Active: true},
	{Code: "TRANSPORT_LOGISTICS", AssetClassCode: "TRANSPORT_LOGISTICS", DisplayName: "Transport & Logistics", ClassType: "ALLOCATION", ParentCode: "INDUSTRIALS", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1165, Active: true},
	{Code: "CIVIL_AEROSPACE", AssetClassCode: "CIVIL_AEROSPACE", DisplayName: "Civil Aerospace", ClassType: "ALLOCATION", ParentCode: "INDUSTRIALS", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1170, Active: true},
	{Code: "INFRASTRUCTURE", AssetClassCode: "INFRASTRUCTURE", DisplayName: "Infrastructure", ClassType: "ALLOCATION", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1175, Active: true},
	{Code: "UTILITIES", AssetClassCode: "UTILITIES", DisplayName: "Utilities", ClassType: "ALLOCATION", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1180, Active: true},
	{Code: "REAL_ESTATE_REIT", AssetClassCode: "REAL_ESTATE_REIT", DisplayName: "Real Estate / REIT", ClassType: "ALLOCATION", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1185, Active: true},
	{Code: "HEALTHCARE_SERVICES", AssetClassCode: "HEALTHCARE_SERVICES", DisplayName: "Healthcare Services", ClassType: "ALLOCATION", ParentCode: "HEALTHCARE", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1190, Active: true},
	{Code: "MEDTECH", AssetClassCode: "MEDTECH", DisplayName: "Medtech", ClassType: "ALLOCATION", ParentCode: "HEALTHCARE", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1195, Active: true},
	{Code: "PHARMA_BIOTECH", AssetClassCode: "PHARMA_BIOTECH", DisplayName: "Pharma & Biotech", ClassType: "ALLOCATION", ParentCode: "PHARMA", AllowGrouping: true, AllowTargetWeight: true, DisplayOrder: 1200, Active: true},
	{Code: "UNASSIGNED", AssetClassCode: "UNASSIGNED", DisplayName: "Unassigned", ClassType: "SYSTEM_BUCKET", AllowGrouping: false, AllowTargetWeight: true, DisplayOrder: 9990, Active: true},
	{Code: "CASH", AssetClassCode: "CASH", DisplayName: "Cash/Reserve", ClassType: "SYSTEM_BUCKET", AllowGrouping: false, AllowTargetWeight: true, DisplayOrder: 10000, Active: true},
}

func seedAssetClasses() {
	migrateAssetClassSchema()
	if _, err := db.Exec(`
		UPDATE asset_classes
		SET active = 0, updated_at = CURRENT_TIMESTAMP
		WHERE UPPER(COALESCE(class_type, '')) != 'CUSTOM'
		  AND UPPER(code) NOT LIKE 'CUSTOM_%'
	`); err != nil {
		log.Printf("[ASSET CLASSES] Failed to deactivate old asset-class rows: %v", err)
	}
	for _, sleeve := range defaultAssetClassSettings {
		if _, err := db.Exec(`
			INSERT INTO asset_classes (
				code, asset_class_code, display_name, class_type, parent_code,
				allow_grouping, allow_target_weight, analysis_eligible, instrument_scope,
				risk_bucket, display_order, active, updated_at
			)
			VALUES (?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
			ON CONFLICT(code) DO UPDATE SET
				asset_class_code = excluded.asset_class_code,
				display_name = excluded.display_name,
				class_type = excluded.class_type,
				parent_code = excluded.parent_code,
				allow_grouping = excluded.allow_grouping,
				allow_target_weight = excluded.allow_target_weight,
				analysis_eligible = excluded.analysis_eligible,
				instrument_scope = excluded.instrument_scope,
				risk_bucket = excluded.risk_bucket,
				display_order = excluded.display_order,
				active = excluded.active,
				updated_at = CURRENT_TIMESTAMP
		`,
			sleeve.Code,
			sleeve.AssetClassCode,
			sleeve.DisplayName,
			sleeve.ClassType,
			sleeve.ParentCode,
			sleeve.AllowGrouping,
			sleeve.AllowTargetWeight,
			defaultAnalysisEligibleForAssetClass(sleeve),
			defaultInstrumentScopeForAssetClass(sleeve),
			defaultRiskBucketForAssetClass(sleeve),
			sleeve.DisplayOrder,
			sleeve.Active,
		); err != nil {
			log.Printf("[ASSET CLASSES] Failed to seed %s: %v", sleeve.Code, err)
		}
	}
}

func migrateAssetClassSchema() {
	if !sqliteTableExists("asset_classes") {
		return
	}
	db.Exec(`ALTER TABLE asset_classes ADD COLUMN analysis_eligible BOOLEAN DEFAULT 1`)
	db.Exec(`ALTER TABLE asset_classes ADD COLUMN instrument_scope TEXT DEFAULT 'BOTH'`)
	db.Exec(`ALTER TABLE asset_classes ADD COLUMN risk_bucket TEXT DEFAULT ''`)
	db.Exec(`
		UPDATE asset_classes
		SET analysis_eligible = CASE
			WHEN UPPER(COALESCE(class_type, '')) = 'CUSTOM' THEN 0
			WHEN UPPER(COALESCE(class_type, '')) = 'SYSTEM_BUCKET' THEN 0
			ELSE COALESCE(analysis_eligible, 1)
		END,
		instrument_scope = COALESCE(NULLIF(instrument_scope, ''), 'BOTH'),
		risk_bucket = COALESCE(risk_bucket, '')
	`)
}

func defaultAnalysisEligibleForAssetClass(sleeve AssetClass) bool {
	classType := strings.ToUpper(strings.TrimSpace(sleeve.ClassType))
	if classType == "CUSTOM" || classType == "SYSTEM_BUCKET" {
		return false
	}
	return true
}

func defaultInstrumentScopeForAssetClass(sleeve AssetClass) string {
	if strings.EqualFold(strings.TrimSpace(sleeve.ClassType), "CUSTOM") {
		return "FUND"
	}
	return "BOTH"
}

func defaultRiskBucketForAssetClass(sleeve AssetClass) string {
	if strings.EqualFold(strings.TrimSpace(sleeve.Code), "CASH") {
		return "CASH"
	}
	return ""
}

func sqliteTableExists(name string) bool {
	var exists int
	err := db.QueryRow(`
		SELECT COUNT(1)
		FROM sqlite_master
		WHERE type = 'table' AND name = ?
	`, name).Scan(&exists)
	return err == nil && exists > 0
}

func sqliteTableColumnExists(tableName, columnName string) bool {
	rows, err := db.Query(fmt.Sprintf(`PRAGMA table_info(%s)`, tableName))
	if err != nil {
		return false
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name, dataType string
		var notNull int
		var defaultValue interface{}
		var pk int
		if err := rows.Scan(&cid, &name, &dataType, &notNull, &defaultValue, &pk); err != nil {
			continue
		}
		if strings.EqualFold(name, columnName) {
			return true
		}
	}
	return false
}

func migratePortfolioSleevesToAssetClasses() {
	db.Exec(`ALTER TABLE asset_classes ADD COLUMN class_type TEXT NOT NULL DEFAULT 'ALLOCATION'`)
	if !sqliteTableExists("portfolio_sleeves") {
		return
	}

	typeColumn := "sleeve_type"
	if sqliteTableColumnExists("portfolio_sleeves", "class_type") {
		typeColumn = "class_type"
	}

	query := fmt.Sprintf(`
		INSERT INTO asset_classes (
			code, asset_class_code, display_name, class_type, parent_code,
			allow_grouping, allow_target_weight, display_order, active, created_at, updated_at
		)
		SELECT
			code,
			asset_class_code,
			display_name,
			COALESCE(NULLIF(%s, ''), 'ALLOCATION'),
			parent_code,
			COALESCE(allow_grouping, 1),
			COALESCE(allow_target_weight, 1),
			COALESCE(display_order, 999),
			COALESCE(active, 1),
			COALESCE(created_at, CURRENT_TIMESTAMP),
			CURRENT_TIMESTAMP
		FROM portfolio_sleeves
		ON CONFLICT(code) DO UPDATE SET
			asset_class_code = excluded.asset_class_code,
			display_name = excluded.display_name,
			class_type = excluded.class_type,
			parent_code = excluded.parent_code,
			allow_grouping = excluded.allow_grouping,
			allow_target_weight = excluded.allow_target_weight,
			display_order = excluded.display_order,
			active = excluded.active,
			updated_at = CURRENT_TIMESTAMP
	`, typeColumn)

	if _, err := db.Exec(query); err != nil {
		log.Printf("[ASSET CLASSES] Failed to migrate portfolio_sleeves into asset_classes: %v", err)
		return
	}
	if _, err := db.Exec(`DROP TABLE portfolio_sleeves`); err != nil {
		log.Printf("[ASSET CLASSES] Failed to drop legacy portfolio_sleeves table: %v", err)
	}
}

func migrateETFAssetClassMappingsToStockAnalysis() {
	if !sqliteTableExists("etf_asset_class_mappings") {
		return
	}

	rows, err := db.Query(`
		SELECT ticker, asset_class, COALESCE(display_name, ''), COALESCE(active, 1)
		FROM etf_asset_class_mappings
	`)
	if err != nil {
		log.Printf("[ETF] Failed to read legacy ETF mapping table: %v", err)
		return
	}
	defer rows.Close()

	migrated := 0
	for rows.Next() {
		var ticker, rawAssetClass, displayName string
		var active bool
		if err := rows.Scan(&ticker, &rawAssetClass, &displayName, &active); err != nil {
			continue
		}
		ticker = canonicalSecurityTickerKey(ticker)
		if ticker == "" || !active {
			continue
		}
		assetClass, ok := resolvePortfolioAssignmentClass(rawAssetClass)
		if !ok || assetClass == "" {
			log.Printf("[ETF] Skipping non-conforming legacy ETF class %q for %s", rawAssetClass, ticker)
			continue
		}
		displayName = strings.TrimSpace(displayName)
		if displayName == "" {
			displayName = ticker
		}

		result, err := db.Exec(`
			UPDATE stock_analysis
			SET primary_asset_class = ?,
				security_type = 'ETF',
				name = COALESCE(NULLIF(name, ''), ?),
				updated_at = CURRENT_TIMESTAMP
			WHERE UPPER(TRIM(COALESCE(ticker, ''))) = ?
		`, assetClass, displayName, ticker)
		if err != nil {
			log.Printf("[ETF] Failed to migrate ETF class for %s: %v", ticker, err)
			continue
		}
		affected, _ := result.RowsAffected()
		if affected == 0 {
			if _, err := db.Exec(`
				INSERT INTO stock_analysis (ticker, name, primary_asset_class, security_type, updated_at)
				VALUES (?, ?, ?, 'ETF', CURRENT_TIMESTAMP)
			`, ticker, displayName, assetClass); err != nil {
				log.Printf("[ETF] Failed to insert migrated ETF analysis row for %s: %v", ticker, err)
				continue
			}
		}
		migrated++
	}
	if err := rows.Err(); err != nil {
		log.Printf("[ETF] Legacy ETF mapping scan failed: %v", err)
		return
	}
	if _, err := db.Exec(`DROP TABLE etf_asset_class_mappings`); err != nil {
		log.Printf("[ETF] Failed to drop legacy etf_asset_class_mappings table: %v", err)
		return
	}
	log.Printf("[ETF] Migrated %d legacy ETF class assignments into stock_analysis", migrated)
}

var defaultOverlayAssetClassSettings = []OverlayAssetClassSetting{
	{Key: "CASH", DisplayName: "Cash/Reserve", OverlayEligible: false, DisplayOrder: 10000, Q3Rating: "Cash", Q3Logic: "Cash and reserve balances sit outside the Q1 overlay and fund the rebalance workflow.", Active: true},
	{Key: "MATERIALS", DisplayName: "Materials", OverlayEligible: true, DisplayOrder: 10, Q3SellPriority: intPtr(2), Q3Rating: "Bad", Q3Logic: "Broad materials remain equity-sensitive in drawdowns even when the underlying commodities are mixed.", Active: true},
	{Key: "GOLD", DisplayName: "Gold", OverlayEligible: true, DisplayOrder: 20, Q3SellPriority: intPtr(3), Q3Rating: "Mixed", Q3Logic: "Gold miners retain inflation leverage but still carry equity beta, so they are not the same as physical gold.", Active: true},
	{Key: "SILVER", DisplayName: "Silver", OverlayEligible: true, DisplayOrder: 30, Q3SellPriority: intPtr(3), Q3Rating: "Mixed", Q3Logic: "Silver miners blend monetary upside with industrial cyclicality, which makes them noisier through drawdowns.", Active: true},
	{Key: "COPPER", DisplayName: "Copper", OverlayEligible: true, DisplayOrder: 40, Q3SellPriority: intPtr(3), Q3Rating: "Mixed", Q3Logic: "Copper can hold on supply stress, but copper equities still behave like cyclical risk assets in weaker markets.", Active: true},
	{Key: "BASEMETALS", DisplayName: "Base Metals", OverlayEligible: true, DisplayOrder: 50, Q3SellPriority: intPtr(3), Q3Rating: "Mixed", Q3Logic: "Base-metals names need case-by-case judgement because commodity support and equity beta often fight each other.", Active: true},
	{Key: "LITHIUM", DisplayName: "Lithium", OverlayEligible: true, DisplayOrder: 55, Q3SellPriority: intPtr(2), Q3Rating: "Bad", Q3Logic: "Lithium remains tied to EV growth expectations and tends to behave poorly when risk appetite and growth assumptions compress.", Active: true},
	{Key: "URANIUM", DisplayName: "Uranium", OverlayEligible: true, DisplayOrder: 60, Q3SellPriority: intPtr(3), Q3Rating: "Mixed", Q3Logic: "Uranium has a strong long-term thesis, but listed uranium equities can still sell off with the broader equity book.", Active: true},
	{Key: "REE", DisplayName: "Rare Earths", OverlayEligible: true, DisplayOrder: 70, Q3SellPriority: intPtr(2), Q3Rating: "Bad", Q3Logic: "Rare earths and critical-mineral explorers are often illiquid and highly equity-correlated when markets de-risk.", Active: true},
	{Key: "IRON", DisplayName: "Iron", OverlayEligible: true, DisplayOrder: 80, Q3SellPriority: intPtr(2), Q3Rating: "Bad", Q3Logic: "Iron ore is heavily tied to cyclical demand, especially construction and China-sensitive growth expectations.", Active: true},
	{Key: "ALUMINIUM", DisplayName: "Aluminium", OverlayEligible: true, DisplayOrder: 90, Q3SellPriority: intPtr(3), Q3Rating: "Mixed", Q3Logic: "Aluminium can benefit from supply issues, but listed names still share the same broad equity drawdown risk.", Active: true},
	{Key: "INSURANCE", DisplayName: "Insurance", OverlayEligible: true, DisplayOrder: 95, Q3SellPriority: intPtr(5), Q3Beneficiary: true, Q3Rating: "Strong", Q3Logic: "Premium repricing and higher portfolio yields make insurance one of the cleanest stagflation beneficiaries.", Stage2TargetPct: float64Ptr(25), Active: true},
	{Key: "FINANCIALS", DisplayName: "Financials", OverlayEligible: true, DisplayOrder: 100, Q3SellPriority: intPtr(3), Q3Rating: "Mixed", Q3Logic: "Banks and broader financials can benefit from rates, but credit stress and provisioning offset that support.", Active: true},
	{Key: "STAPLES", DisplayName: "Staples", OverlayEligible: true, DisplayOrder: 110, Q3SellPriority: intPtr(5), Q3Beneficiary: true, Q3Rating: "Strong", Q3Logic: "Staples have inelastic demand and better price pass-through than most of the equity book.", Stage2TargetPct: float64Ptr(15), Active: true},
	{Key: "GAMBLING", DisplayName: "Gambling", OverlayEligible: true, DisplayOrder: 111, Q3SellPriority: intPtr(5), Q3Beneficiary: true, Q3Rating: "Good", Q3Logic: "Gambling behaves more defensively than most discretionary sectors and can stay resilient in stress.", Stage2TargetPct: float64Ptr(10), Active: true},
	{Key: "GAMING", DisplayName: "Gaming", OverlayEligible: true, DisplayOrder: 112, Q3SellPriority: intPtr(2), Q3Rating: "Bad", Q3Logic: "Gaming is more exposed to discretionary spending and should not be treated the same as gambling content.", Active: true},
	{Key: "TECHNOLOGY", DisplayName: "Technology", OverlayEligible: true, DisplayOrder: 114, Q3SellPriority: intPtr(1), Q3Rating: "Worst", Q3Logic: "Technology remains the most rate-sensitive, long-duration part of the equity book.", Active: true},
	{Key: "SEMICONDUCTORS", DisplayName: "Semiconductors", OverlayEligible: true, DisplayOrder: 116, Q3SellPriority: intPtr(2), Q3Rating: "Bad", Q3Logic: "Semiconductors still carry cyclical demand and valuation compression risk in tougher regimes.", Active: true},
	{Key: "INDUSTRIALS", DisplayName: "Industrials", OverlayEligible: true, DisplayOrder: 118, Q3SellPriority: intPtr(2), Q3Rating: "Bad", Q3Logic: "Industrials face weaker demand, capex deferrals, and margin pressure when the market moves defensive.", Active: true},
	{Key: "DEFENCE", DisplayName: "Defence", OverlayEligible: true, DisplayOrder: 119, Q3SellPriority: intPtr(5), Q3Beneficiary: true, Q3Rating: "Good", Q3Logic: "Defence demand is supported by long-duration government budgets and a less cyclical demand backdrop.", Stage2TargetPct: float64Ptr(5), Active: true},
	{Key: "EQUITY", DisplayName: "Equity", OverlayEligible: true, DisplayOrder: 120, Q3SellPriority: intPtr(3), Q3Rating: "Mixed", Q3Logic: "Generic equity exposure should be treated as overlay-sensitive unless it is reclassified into a more specific sleeve.", Active: true},
	{Key: "ENERGY", DisplayName: "Energy", OverlayEligible: false, DisplayOrder: 130, Q3Rating: "Best", Q3Logic: "Energy producers benefit directly from the inflationary shock and sit outside the Q1 throttle.", Stage2TargetPct: float64Ptr(15), Active: true},
	{Key: "PHARMA", DisplayName: "Pharma", OverlayEligible: false, DisplayOrder: 140, RegimeIndependent: true, Q3Rating: "Regime-Independent", Q3Logic: "Commercial pharma is driven by clinical demand and approvals, not by the Q1 overlay.", Active: true},
	{Key: "HEALTHCARE", DisplayName: "Healthcare", OverlayEligible: false, DisplayOrder: 145, RegimeIndependent: true, Q3Rating: "Holds", Q3Logic: "Healthcare services and devices are less cyclical than the broad equity book and can hold through stress.", Stage2TargetPct: float64Ptr(5), Active: true},
	{Key: "BONDS", DisplayName: "Bonds", OverlayEligible: false, DisplayOrder: 150, Q3Rating: "Mixed", Q3Logic: "Nominal fixed income is not a clean Q3 beneficiary, but it remains outside the Q1 overlay when explicitly held.", Active: true},
	{Key: "ETF", DisplayName: "ETF Sleeve", OverlayEligible: false, DisplayOrder: 160, Active: true},
	{Key: "MISC", DisplayName: "Misc", OverlayEligible: true, DisplayOrder: 170, Q3SellPriority: intPtr(3), Active: true},
	{Key: "UNASSIGNED", DisplayName: "Unassigned", OverlayEligible: false, DisplayOrder: 999, Active: true},
	{Key: "FIXED_INCOME", DisplayName: "Fixed Income", OverlayEligible: false, DisplayOrder: 1005, Q3Rating: "Mixed", Q3Logic: "Fixed income is a portfolio target class rather than Q1 overlay equity exposure.", Active: true},
	{Key: "BROAD_EQUITY", DisplayName: "Broad Equity", OverlayEligible: true, DisplayOrder: 1010, Q3SellPriority: intPtr(3), Q3Rating: "Mixed", Q3Logic: "Broad equity exposure remains overlay-sensitive unless it is assigned to a more specific sleeve.", Active: true},
	{Key: "PHYSICAL_GOLD", DisplayName: "Physical Gold", OverlayEligible: false, DisplayOrder: 1020, Q3Rating: "Regime-Independent", Q3Logic: "Physical gold is treated separately from listed gold miners and sits outside Q1 equity reductions.", Active: true},
	{Key: "GOLD_MINERS", DisplayName: "Gold Miners", OverlayEligible: true, DisplayOrder: 1025, Q3SellPriority: intPtr(3), Q3Rating: "Mixed", Q3Logic: "Listed gold miners carry equity beta even when bullion is defensive.", Active: true},
	{Key: "PHYSICAL_SILVER", DisplayName: "Physical Silver", OverlayEligible: false, DisplayOrder: 1030, Q3Rating: "Regime-Independent", Q3Logic: "Physical silver is treated separately from listed silver miners.", Active: true},
	{Key: "SILVER_MINERS", DisplayName: "Silver Miners", OverlayEligible: true, DisplayOrder: 1035, Q3SellPriority: intPtr(3), Q3Rating: "Mixed", Q3Logic: "Listed silver miners retain equity and cyclicality risk.", Active: true},
	{Key: "COPPER_MINERS", DisplayName: "Copper Miners", OverlayEligible: true, DisplayOrder: 1040, Q3SellPriority: intPtr(3), Q3Rating: "Mixed", Q3Logic: "Copper miners are cyclical listed equities and should not be conflated with physical copper exposure.", Active: true},
	{Key: "BASE_METALS_MINERS", DisplayName: "Base Metals Miners", OverlayEligible: true, DisplayOrder: 1045, Q3SellPriority: intPtr(3), Q3Rating: "Mixed", Q3Logic: "Base-metals miners need case-by-case treatment because commodity support and equity beta can conflict.", Active: true},
	{Key: "LITHIUM_MINERS", DisplayName: "Lithium Miners", OverlayEligible: true, DisplayOrder: 1050, Q3SellPriority: intPtr(2), Q3Rating: "Bad", Q3Logic: "Lithium miners remain exposed to EV demand expectations and risk appetite.", Active: true},
	{Key: "URANIUM_MINERS", DisplayName: "Uranium Miners", OverlayEligible: true, DisplayOrder: 1055, Q3SellPriority: intPtr(3), Q3Rating: "Mixed", Q3Logic: "Uranium miners have a strong long-term thesis but still carry listed-equity drawdown risk.", Active: true},
	{Key: "RARE_EARTHS_CRITICAL_MINERALS", DisplayName: "Rare Earths & Critical Minerals", OverlayEligible: true, DisplayOrder: 1060, Q3SellPriority: intPtr(2), Q3Rating: "Bad", Q3Logic: "Critical-mineral equities are often illiquid and highly equity-correlated when markets de-risk.", Active: true},
	{Key: "IRON_ORE_MINERS", DisplayName: "Iron Ore Miners", OverlayEligible: true, DisplayOrder: 1065, Q3SellPriority: intPtr(2), Q3Rating: "Bad", Q3Logic: "Iron ore miners are exposed to cyclical demand and China-sensitive growth expectations.", Active: true},
	{Key: "DIVERSIFIED_MINERS", DisplayName: "Diversified Miners", OverlayEligible: true, DisplayOrder: 1070, Q3SellPriority: intPtr(3), Q3Rating: "Mixed", Q3Logic: "Diversified miners blend multiple commodity drivers with listed-equity beta.", Active: true},
	{Key: "MATERIALS_CHEMICALS", DisplayName: "Materials & Chemicals", OverlayEligible: true, DisplayOrder: 1075, Q3SellPriority: intPtr(2), Q3Rating: "Bad", Q3Logic: "Materials and chemicals are generally cyclical and overlay-sensitive.", Active: true},
	{Key: "FORESTRY_PAPER_PACKAGING", DisplayName: "Forestry, Paper & Packaging", OverlayEligible: true, DisplayOrder: 1080, Q3SellPriority: intPtr(3), Q3Rating: "Mixed", Q3Logic: "Packaging and forestry names mix industrial cyclicality with defensive end demand.", Active: true},
	{Key: "STEEL_METALS_PROCESSING", DisplayName: "Steel & Metals Processing", OverlayEligible: true, DisplayOrder: 1085, Q3SellPriority: intPtr(2), Q3Rating: "Bad", Q3Logic: "Steel and metals processing are cyclical and margin-sensitive.", Active: true},
	{Key: "MINING_SERVICES", DisplayName: "Mining Services", OverlayEligible: true, DisplayOrder: 1087, Q3SellPriority: intPtr(2), Q3Rating: "Bad", Q3Logic: "Mining services are tied to mining activity, capex cycles, contract utilisation, and listed-equity risk.", Active: true},
	{Key: "ENERGY_PRODUCERS", DisplayName: "Energy Producers", OverlayEligible: false, DisplayOrder: 1090, Q3Rating: "Best", Q3Logic: "Energy producers benefit directly from inflationary shocks and are treated outside the Q1 throttle.", Active: true},
	{Key: "ENERGY_COMMODITIES", DisplayName: "Energy Commodities", OverlayEligible: false, DisplayOrder: 1095, Q3Rating: "Best", Q3Logic: "Direct energy commodity exposure is treated separately from Q1 overlay equities.", Active: true},
	{Key: "AGRICULTURE_AGRIBUSINESS", DisplayName: "Agriculture & Agribusiness", OverlayEligible: true, DisplayOrder: 1100, Q3SellPriority: intPtr(4), Q3Rating: "Good", Q3Logic: "Agriculture can have inflation pass-through but still needs listed-equity treatment.", Active: true},
	{Key: "BANKS", DisplayName: "Banks", OverlayEligible: true, DisplayOrder: 1105, Q3SellPriority: intPtr(3), Q3Rating: "Mixed", Q3Logic: "Banks can benefit from rates but are exposed to credit stress and provisioning.", Active: true},
	{Key: "CONSUMER_STAPLES", DisplayName: "Consumer Staples", OverlayEligible: true, DisplayOrder: 1110, Q3SellPriority: intPtr(5), Q3Beneficiary: true, Q3Rating: "Strong", Q3Logic: "Staples have inelastic demand and better price pass-through than most equities.", Active: true},
	{Key: "CONSUMER_DISCRETIONARY", DisplayName: "Consumer Discretionary", OverlayEligible: true, DisplayOrder: 1115, Q3SellPriority: intPtr(2), Q3Rating: "Bad", Q3Logic: "Discretionary consumption is vulnerable when rates, inflation, or growth pressure households.", Active: true},
	{Key: "GAMING_GAMBLING", DisplayName: "Gaming & Gambling", OverlayEligible: true, DisplayOrder: 1120, Q3SellPriority: intPtr(4), Q3Beneficiary: true, Q3Rating: "Good", Q3Logic: "Gaming and gambling exposure can be more resilient than discretionary retail but still needs equity-risk treatment.", Active: true},
	{Key: "EDUCATION", DisplayName: "Education", OverlayEligible: true, DisplayOrder: 1125, Q3SellPriority: intPtr(3), Q3Rating: "Mixed", Q3Logic: "Education demand can be resilient but listed names still carry equity beta.", Active: true},
	{Key: "MEDIA_PUBLISHING", DisplayName: "Media & Publishing", OverlayEligible: true, DisplayOrder: 1130, Q3SellPriority: intPtr(2), Q3Rating: "Bad", Q3Logic: "Advertising and publishing exposure is cyclical.", Active: true},
	{Key: "TECHNOLOGY_PLATFORMS", DisplayName: "Technology Platforms", OverlayEligible: true, DisplayOrder: 1135, Q3SellPriority: intPtr(1), Q3Rating: "Worst", Q3Logic: "Technology platforms remain rate-sensitive, long-duration equity exposure.", Active: true},
	{Key: "SOFTWARE_SAAS", DisplayName: "Software & SaaS", OverlayEligible: true, DisplayOrder: 1140, Q3SellPriority: intPtr(1), Q3Rating: "Worst", Q3Logic: "Software and SaaS valuations are sensitive to rates and growth compression.", Active: true},
	{Key: "CRYPTO_DIGITAL_ASSETS", DisplayName: "Crypto & Digital Assets", OverlayEligible: true, DisplayOrder: 1145, Q3SellPriority: intPtr(1), Q3Rating: "Worst", Q3Logic: "Crypto and digital-asset exposure is high-beta risk exposure.", Active: true},
	{Key: "DATACENTRES", DisplayName: "Datacentres", OverlayEligible: true, DisplayOrder: 1150, Q3SellPriority: intPtr(2), Q3Rating: "Mixed", Q3Logic: "Datacentres have structural demand but are not the same as broad infrastructure.", Active: true},
	{Key: "TELECOMMUNICATIONS", DisplayName: "Telecommunications", OverlayEligible: true, DisplayOrder: 1155, Q3SellPriority: intPtr(4), Q3Rating: "Good", Q3Logic: "Telecommunications can be defensive but remains listed-equity exposure.", Active: true},
	{Key: "CONSTRUCTION_ENGINEERING", DisplayName: "Construction & Engineering", OverlayEligible: true, DisplayOrder: 1160, Q3SellPriority: intPtr(2), Q3Rating: "Bad", Q3Logic: "Construction and engineering are cyclical and capex-sensitive.", Active: true},
	{Key: "TRANSPORT_LOGISTICS", DisplayName: "Transport & Logistics", OverlayEligible: true, DisplayOrder: 1165, Q3SellPriority: intPtr(2), Q3Rating: "Bad", Q3Logic: "Transport and logistics exposure is cyclical and demand-sensitive.", Active: true},
	{Key: "CIVIL_AEROSPACE", DisplayName: "Civil Aerospace", OverlayEligible: true, DisplayOrder: 1170, Q3SellPriority: intPtr(3), Q3Rating: "Mixed", Q3Logic: "Civil aerospace has long-cycle demand but remains cyclical listed-equity exposure.", Active: true},
	{Key: "INFRASTRUCTURE", DisplayName: "Infrastructure", OverlayEligible: false, DisplayOrder: 1175, Q3Rating: "Holds", Q3Logic: "Infrastructure is separated from cyclical industrials and handled as a portfolio allocation sleeve.", Active: true},
	{Key: "UTILITIES", DisplayName: "Utilities", OverlayEligible: false, DisplayOrder: 1180, Q3Rating: "Holds", Q3Logic: "Utilities are treated as defensive portfolio exposure outside the Q1 overlay.", Active: true},
	{Key: "REAL_ESTATE_REIT", DisplayName: "Real Estate / REIT", OverlayEligible: true, DisplayOrder: 1185, Q3SellPriority: intPtr(2), Q3Rating: "Bad", Q3Logic: "Real estate and REIT exposure is rate-sensitive.", Active: true},
	{Key: "HEALTHCARE_SERVICES", DisplayName: "Healthcare Services", OverlayEligible: false, DisplayOrder: 1190, Q3Rating: "Holds", Q3Logic: "Healthcare services are less cyclical and sit outside the Q1 throttle when explicitly classified.", Active: true},
	{Key: "MEDTECH", DisplayName: "Medtech", OverlayEligible: false, DisplayOrder: 1195, Q3Rating: "Holds", Q3Logic: "Medtech is separated from broad healthcare and handled as defensive healthcare exposure.", Active: true},
	{Key: "PHARMA_BIOTECH", DisplayName: "Pharma & Biotech", OverlayEligible: false, DisplayOrder: 1200, Q3Rating: "Regime-Independent", Q3Logic: "Pharma and biotech are driven by clinical demand and approvals rather than the Q1 overlay.", Active: true},
}

type assetClassTaxonomyDefault struct {
	Kind              string
	ParentCode        string
	IsPortfolioSleeve bool
	IsSystemBucket    bool
	AllowGrouping     bool
	AllowTargetWeight bool
}

func taxonomyDefaultsForAssetClass(code string) assetClassTaxonomyDefault {
	code = strings.ToUpper(strings.TrimSpace(code))
	meta := assetClassTaxonomyDefault{
		Kind: "ASSET_CLASS",
	}

	for _, assetClass := range loadAssetClasses() {
		if normalizePrimaryAssetClass(assetClass.Code) != code {
			continue
		}
		meta.ParentCode = normalizePrimaryAssetClass(assetClass.ParentCode)
		meta.AllowGrouping = assetClass.AllowGrouping
		meta.AllowTargetWeight = assetClass.AllowTargetWeight
		meta.IsPortfolioSleeve = assetClass.AllowTargetWeight
		if assetClass.IsSystemBucket() {
			meta.Kind = "SYSTEM_BUCKET"
			meta.IsSystemBucket = true
			meta.IsPortfolioSleeve = false
		}
		return meta
	}

	for _, assetClass := range defaultAssetClassSettings {
		if normalizePrimaryAssetClass(assetClass.Code) != code {
			continue
		}
		meta.ParentCode = normalizePrimaryAssetClass(assetClass.ParentCode)
		meta.AllowGrouping = assetClass.AllowGrouping
		meta.AllowTargetWeight = assetClass.AllowTargetWeight
		meta.IsPortfolioSleeve = assetClass.AllowTargetWeight
		if assetClass.IsSystemBucket() {
			meta.Kind = "SYSTEM_BUCKET"
			meta.IsSystemBucket = true
			meta.IsPortfolioSleeve = false
		}
		return meta
	}

	if code == "ETF" {
		meta.Kind = "SECURITY_TYPE"
		meta.IsPortfolioSleeve = false
		meta.AllowGrouping = false
		meta.AllowTargetWeight = false
	}

	return meta
}

func applyTaxonomyDefaults(setting OverlayAssetClassSetting) OverlayAssetClassSetting {
	meta := taxonomyDefaultsForAssetClass(setting.Key)
	alertLabel, alertColor := alertStackPresentationForAssetClass(setting.Key, setting.DisplayName)
	if strings.TrimSpace(setting.Kind) == "" {
		setting.Kind = meta.Kind
	}
	if strings.TrimSpace(setting.ParentCode) == "" {
		setting.ParentCode = meta.ParentCode
	}
	setting.IsPortfolioSleeve = setting.IsPortfolioSleeve || meta.IsPortfolioSleeve
	setting.IsSystemBucket = setting.IsSystemBucket || meta.IsSystemBucket
	setting.AllowGrouping = setting.AllowGrouping || meta.AllowGrouping
	setting.AllowTargetWeight = setting.AllowTargetWeight || meta.AllowTargetWeight
	if strings.TrimSpace(setting.AlertLabel) == "" {
		setting.AlertLabel = alertLabel
	}
	if strings.TrimSpace(setting.AlertColor) == "" {
		setting.AlertColor = alertColor
	}
	return setting
}

func defaultOverlayAssetClassSettingsWithTaxonomy() []OverlayAssetClassSetting {
	settings := make([]OverlayAssetClassSetting, 0, len(defaultOverlayAssetClassSettings))
	for _, setting := range defaultOverlayAssetClassSettings {
		settings = append(settings, applyTaxonomyDefaults(setting))
	}
	return settings
}

var primaryAssetClassPriority = []string{
	"PHYSICAL_GOLD",
	"PHYSICAL_SILVER",
	"FIXED_INCOME",
	"GOLD",
	"GOLD_MINERS",
	"SILVER",
	"SILVER_MINERS",
	"COPPER",
	"COPPER_MINERS",
	"BASEMETALS",
	"BASE_METALS_MINERS",
	"LITHIUM",
	"LITHIUM_MINERS",
	"URANIUM",
	"URANIUM_MINERS",
	"MATERIALS",
	"DIVERSIFIED_MINERS",
	"MATERIALS_CHEMICALS",
	"REE",
	"RARE_EARTHS_CRITICAL_MINERALS",
	"IRON",
	"IRON_ORE_MINERS",
	"ALUMINIUM",
	"STEEL_METALS_PROCESSING",
	"FORESTRY_PAPER_PACKAGING",
	"MINING_SERVICES",
	"INSURANCE",
	"FINANCIALS",
	"BANKS",
	"STAPLES",
	"CONSUMER_STAPLES",
	"CONSUMER_DISCRETIONARY",
	"GAMBLING",
	"GAMING_GAMBLING",
	"GAMING",
	"TECHNOLOGY",
	"TECHNOLOGY_PLATFORMS",
	"SOFTWARE_SAAS",
	"SEMICONDUCTORS",
	"CRYPTO_DIGITAL_ASSETS",
	"DATACENTRES",
	"TELECOMMUNICATIONS",
	"INDUSTRIALS",
	"CONSTRUCTION_ENGINEERING",
	"TRANSPORT_LOGISTICS",
	"CIVIL_AEROSPACE",
	"DEFENCE",
	"INFRASTRUCTURE",
	"UTILITIES",
	"REAL_ESTATE_REIT",
	"HEALTHCARE",
	"HEALTHCARE_SERVICES",
	"MEDTECH",
	"ENERGY",
	"ENERGY_PRODUCERS",
	"ENERGY_COMMODITIES",
	"PHARMA",
	"PHARMA_BIOTECH",
	"AGRICULTURE_AGRIBUSINESS",
	"EDUCATION",
	"MEDIA_PUBLISHING",
	"MISC",
	"BONDS",
	"CASH",
	"ETF",
	"EQUITY",
	"BROAD_EQUITY",
}

var defaultStage2PlaybookTargetsByMode = map[string]map[string]float64{
	"DEFENSIVE": {
		"INSURANCE": 25,
		"STAPLES":   20,
		"ENERGY":    20,
		"GAMBLING":  15,
	},
	"RERISK": {
		"MATERIALS":  25,
		"GOLD":       20,
		"SILVER":     15,
		"COPPER":     15,
		"TECHNOLOGY": 15,
	},
}

var materialResourceAssetClassCodes = map[string]struct{}{
	"GOLD_MINERS":                   {},
	"PHYSICAL_GOLD":                 {},
	"SILVER_MINERS":                 {},
	"PHYSICAL_SILVER":               {},
	"COPPER_MINERS":                 {},
	"BASE_METALS_MINERS":            {},
	"LITHIUM_MINERS":                {},
	"URANIUM_MINERS":                {},
	"RARE_EARTHS_CRITICAL_MINERALS": {},
	"IRON_ORE_MINERS":               {},
	"DIVERSIFIED_MINERS":            {},
	"MATERIALS_CHEMICALS":           {},
	"FORESTRY_PAPER_PACKAGING":      {},
	"STEEL_METALS_PROCESSING":       {},
	"MINING_SERVICES":               {},
}

func seedAssetClassConfig() {
	for _, setting := range defaultOverlayAssetClassSettings {
		q3ThrottleFactor := q3ThrottleFactorForSetting(setting)
		q4dLiquidityFactor := q4dLiquidityFactorForSetting(setting)
		alertLabel, alertColor := alertStackPresentationForAssetClass(setting.Key, setting.DisplayName)
		_, err := db.Exec(`
			INSERT INTO asset_class_config (
				code, display_name, alert_label, alert_color, overlay_eligible, display_order, q3_sell_priority,
				q1_category, q3_beneficiary, regime_independent, q3_throttle_factor, q4d_liquidity_factor,
				q3_rating, q3_logic, stage2_target_pct, cash_reserve, active, updated_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
			ON CONFLICT(code) DO UPDATE SET
				display_name = COALESCE(NULLIF(asset_class_config.display_name, ''), excluded.display_name),
				alert_label = COALESCE(NULLIF(asset_class_config.alert_label, ''), excluded.alert_label),
				alert_color = COALESCE(NULLIF(asset_class_config.alert_color, ''), excluded.alert_color),
				overlay_eligible = COALESCE(asset_class_config.overlay_eligible, excluded.overlay_eligible),
				display_order = COALESCE(asset_class_config.display_order, excluded.display_order),
				q3_sell_priority = COALESCE(asset_class_config.q3_sell_priority, excluded.q3_sell_priority),
				q1_category = COALESCE(asset_class_config.q1_category, excluded.q1_category),
				q3_beneficiary = COALESCE(asset_class_config.q3_beneficiary, excluded.q3_beneficiary),
				regime_independent = COALESCE(asset_class_config.regime_independent, excluded.regime_independent),
				q3_throttle_factor = COALESCE(asset_class_config.q3_throttle_factor, excluded.q3_throttle_factor),
				q4d_liquidity_factor = COALESCE(asset_class_config.q4d_liquidity_factor, excluded.q4d_liquidity_factor),
				q3_rating = COALESCE(asset_class_config.q3_rating, excluded.q3_rating),
				q3_logic = COALESCE(asset_class_config.q3_logic, excluded.q3_logic),
				active = COALESCE(asset_class_config.active, excluded.active),
				updated_at = CURRENT_TIMESTAMP
		`,
			setting.Key,
			setting.DisplayName,
			alertLabel,
			alertColor,
			setting.OverlayEligible,
			setting.DisplayOrder,
			setting.Q3SellPriority,
			setting.Q1Category,
			setting.Q3Beneficiary,
			setting.RegimeIndependent,
			q3ThrottleFactor,
			q4dLiquidityFactor,
			setting.Q3Rating,
			setting.Q3Logic,
			setting.Stage2TargetPct,
			setting.CashReserve,
			setting.Active,
		)
		if err != nil {
			log.Printf("[ASSET CLASS CONFIG] Failed to seed %s: %v", setting.Key, err)
		}
	}
}

func alertStackPresentationForAssetClass(code, displayName string) (string, string) {
	normalized := normalizePrimaryAssetClass(code)
	switch normalized {
	case "MATERIALS":
		return "Materials", "#9ca3af"
	case "GOLD", "GOLD_MINERS", "PHYSICAL_GOLD":
		return "Gold", "#d4a017"
	case "SILVER", "SILVER_MINERS", "PHYSICAL_SILVER":
		return "Silver", "#9ca3af"
	case "COPPER", "COPPER_MINERS":
		return "Copper", "#b87333"
	case "BASEMETALS", "BASE_METALS_MINERS":
		return "Base Metals", "#c28b2c"
	case "STEEL_METALS_PROCESSING":
		return "Steel", "#94a3b8"
	case "MINING_SERVICES":
		return "Mining Services", "#f59e0b"
	case "MATERIALS_CHEMICALS":
		return "Chemicals", "#2dd4bf"
	case "DIVERSIFIED_MINERS":
		return "Diversified Miners", "#a16207"
	case "FORESTRY_PAPER_PACKAGING":
		return "Forestry", "#65a30d"
	case "LITHIUM", "LITHIUM_MINERS":
		return "Lithium", "#a3e635"
	case "URANIUM", "URANIUM_MINERS":
		return "Uranium", "#84cc16"
	case "REE", "RARE_EARTHS_CRITICAL_MINERALS":
		return "Rare Earths", "#22c55e"
	case "IRON", "IRON_ORE_MINERS":
		return "Iron", "#b45309"
	case "ENERGY", "ENERGY_PRODUCERS":
		return "Energy", "#f97316"
	case "ENERGY_COMMODITIES":
		return "Commodities", "#fb923c"
	case "PHARMA", "PHARMA_BIOTECH":
		return "Pharma", "#10b981"
	case "HEALTHCARE", "HEALTHCARE_SERVICES":
		return "Healthcare", "#14b8a6"
	case "MEDTECH":
		return "Medtech", "#2dd4bf"
	case "TECHNOLOGY":
		return "Technology", "#38bdf8"
	case "TECHNOLOGY_PLATFORMS":
		return "Platforms", "#38bdf8"
	case "SOFTWARE_SAAS":
		return "Software", "#0ea5e9"
	case "DATACENTRES":
		return "Datacentres", "#60a5fa"
	case "CRYPTO_DIGITAL_ASSETS":
		return "Crypto", "#8b5cf6"
	case "SEMICONDUCTORS":
		return "Semis", "#60a5fa"
	case "FINANCIALS":
		return "Financials", "#22d3ee"
	case "BANKS":
		return "Banks", "#22d3ee"
	case "INSURANCE":
		return "Insurance", "#06b6d4"
	case "STAPLES", "CONSUMER_STAPLES":
		return "Staples", "#84cc16"
	case "CONSUMER_DISCRETIONARY":
		return "Consumer", "#f59e0b"
	case "GAMBLING", "GAMING_GAMBLING":
		return "Gambling", "#d946ef"
	case "GAMING":
		return "Gaming", "#c084fc"
	case "INDUSTRIALS":
		return "Industrials", "#9ca3af"
	case "DEFENCE":
		return "Defence", "#ef4444"
	case "CIVIL_AEROSPACE":
		return "Aerospace", "#60a5fa"
	case "CONSTRUCTION_ENGINEERING":
		return "Construction", "#f97316"
	case "TRANSPORT_LOGISTICS":
		return "Transport", "#f59e0b"
	case "INFRASTRUCTURE":
		return "Infrastructure", "#64748b"
	case "UTILITIES":
		return "Utilities", "#06b6d4"
	case "TELECOMMUNICATIONS":
		return "Telecoms", "#22d3ee"
	case "AGRICULTURE_AGRIBUSINESS":
		return "Agriculture", "#84cc16"
	case "EDUCATION":
		return "Education", "#a78bfa"
	case "MEDIA_PUBLISHING":
		return "Media", "#f472b6"
	case "REAL_ESTATE_REIT":
		return "REITs", "#a78bfa"
	case "BONDS", "FIXED_INCOME":
		return "Bonds", "#a78bfa"
	case "BROAD_EQUITY", "EQUITY":
		return "Equity", "#94a3b8"
	case "ETF":
		return "ETF", "#94a3b8"
	case "CASH":
		return "Cash", "#9ca3af"
	case "MISC":
		return "Misc", "#9ca3af"
	case "UNASSIGNED":
		return "Unassigned", "#9ca3af"
	}
	label := strings.TrimSpace(displayName)
	if label == "" {
		label = strings.Title(strings.ToLower(strings.ReplaceAll(normalized, "_", " ")))
	}
	return label, "#9ca3af"
}

// normalizePrimaryAssetClass is the legacy alias boundary for inbound payloads and old rows.
// Do not use it as the list of valid asset classes; validate resolved values against asset_classes.

func normalizePrimaryAssetClass(regimeTicker string) string {
	return assetclass.Normalize(regimeTicker)
}

func migrateAlertStackPresentationDefaults() {
	const migrationKey = "asset_class_alert_stack_presentation_v2"
	var existing string
	if err := db.QueryRow(`SELECT value FROM app_settings WHERE key = ?`, migrationKey).Scan(&existing); err == nil && strings.TrimSpace(existing) != "" {
		return
	}

	for _, setting := range defaultOverlayAssetClassSettings {
		alertLabel, alertColor := alertStackPresentationForAssetClass(setting.Key, setting.DisplayName)
		if _, err := db.Exec(`
			UPDATE asset_class_config
			SET alert_label = ?,
			    alert_color = ?,
			    updated_at = CURRENT_TIMESTAMP
			WHERE code = ?
		`, alertLabel, alertColor, setting.Key); err != nil {
			log.Printf("[ASSET CLASS CONFIG] Failed to migrate alert-stack presentation for %s: %v", setting.Key, err)
		}
	}

	if _, err := db.Exec(`
		INSERT INTO app_settings(key, value, updated_at)
		VALUES (?, 'complete', CURRENT_TIMESTAMP)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
	`, migrationKey); err != nil {
		log.Printf("[ASSET CLASS CONFIG] Failed to record alert-stack presentation migration: %v", err)
	}
}

func backfillAssetClassConfigMetadata() {
	for _, setting := range defaultOverlayAssetClassSettings {
		if strings.TrimSpace(setting.Q3Rating) == "" &&
			strings.TrimSpace(setting.Q3Logic) == "" &&
			setting.Stage2TargetPct == nil &&
			setting.Q3ThrottleFactor == nil &&
			setting.Q4DLiquidityFactor == nil {
			continue
		}
		q3ThrottleFactor := q3ThrottleFactorForSetting(setting)
		q4dLiquidityFactor := q4dLiquidityFactorForSetting(setting)

		if _, err := db.Exec(`
			UPDATE asset_class_config
			SET
				q3_rating = CASE
					WHEN COALESCE(NULLIF(TRIM(q3_rating), ''), '') = '' THEN ?
					ELSE q3_rating
				END,
				q3_logic = CASE
					WHEN COALESCE(NULLIF(TRIM(q3_logic), ''), '') = '' THEN ?
					ELSE q3_logic
				END,
				stage2_target_pct = COALESCE(stage2_target_pct, ?),
				q3_throttle_factor = COALESCE(q3_throttle_factor, ?),
				q4d_liquidity_factor = COALESCE(q4d_liquidity_factor, ?),
				updated_at = CURRENT_TIMESTAMP
			WHERE code = ?
		`, setting.Q3Rating, setting.Q3Logic, setting.Stage2TargetPct, q3ThrottleFactor, q4dLiquidityFactor, setting.Key); err != nil {
			log.Printf("[ASSET CLASS CONFIG] Failed to backfill metadata for %s: %v", setting.Key, err)
		}
	}
}

func migrateAssetClassTaxonomyDefaults() {
	const migrationKey = "asset_class_taxonomy_defaults_v1"
	var existing string
	if err := db.QueryRow(`SELECT value FROM app_settings WHERE key = ?`, migrationKey).Scan(&existing); err == nil && strings.TrimSpace(existing) != "" {
		return
	}

	for _, setting := range defaultOverlayAssetClassSettings {
		meta := taxonomyDefaultsForAssetClass(setting.Key)
		alertLabel, alertColor := alertStackPresentationForAssetClass(setting.Key, setting.DisplayName)
		if _, err := db.Exec(`
			UPDATE asset_class_config
			SET kind = ?,
			    parent_code = NULLIF(?, ''),
			    is_portfolio_sleeve = ?,
			    is_system_bucket = ?,
			    allow_grouping = ?,
			    allow_target_weight = ?,
			    alert_label = COALESCE(NULLIF(alert_label, ''), ?),
			    alert_color = COALESCE(NULLIF(alert_color, ''), ?),
			    updated_at = CURRENT_TIMESTAMP
			WHERE code = ?
		`,
			meta.Kind,
			meta.ParentCode,
			meta.IsPortfolioSleeve,
			meta.IsSystemBucket,
			meta.AllowGrouping,
			meta.AllowTargetWeight,
			alertLabel,
			alertColor,
			setting.Key,
		); err != nil {
			log.Printf("[ASSET CLASS CONFIG] Failed to migrate taxonomy for %s: %v", setting.Key, err)
		}
	}

	if _, err := db.Exec(`
		INSERT INTO app_settings(key, value, updated_at)
		VALUES (?, 'complete', CURRENT_TIMESTAMP)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
	`, migrationKey); err != nil {
		log.Printf("[ASSET CLASS CONFIG] Failed to record taxonomy migration: %v", err)
	}
}

func migrateQ3ThrottleDefaults() {
	if _, err := db.Exec(`
		UPDATE asset_class_config
		SET q3_throttle_factor = 0.5,
		    updated_at = CURRENT_TIMESTAMP
		WHERE COALESCE(q3_beneficiary, 0) = 1
		  AND (q3_throttle_factor IS NULL OR ABS(q3_throttle_factor - 0.25) < 0.0001)
	`); err != nil {
		log.Printf("[ASSET CLASS CONFIG] Failed to migrate Q1-Defensive Q3 throttle defaults: %v", err)
	}

	if _, err := db.Exec(`
		UPDATE asset_class_config
		SET q3_throttle_factor = 0.1,
		    updated_at = CURRENT_TIMESTAMP
		WHERE code IN ('ENERGY', 'PHARMA', 'HEALTHCARE', 'BONDS', 'NATURAL_GAS', 'PHYSICAL_GOLD', 'PHYSICAL_SILVER', 'DIRECT_COMMODITIES')
		  AND q3_throttle_factor IS NULL
	`); err != nil {
		log.Printf("[ASSET CLASS CONFIG] Failed to backfill Q1-Exempt Q3 liquidity haircut defaults: %v", err)
	}

	if _, err := db.Exec(`
		UPDATE asset_class_config
		SET q3_throttle_factor = 0,
		    updated_at = CURRENT_TIMESTAMP
		WHERE code IN ('CASH', 'CASH_RESERVE', 'CASH_FLOATING', 'MONEY_MARKET')
		  AND q3_throttle_factor IS NULL
	`); err != nil {
		log.Printf("[ASSET CLASS CONFIG] Failed to backfill cash Q3 throttle defaults: %v", err)
	}
}

func displayNameForAssetClass(assetClassCode string) string {
	return displayNameForAssetClassFromAssetClasses(assetClassCode, loadAssetClasses())
}

func displayNameForAssetClassFromAssetClasses(assetClassCode string, sleeves []AssetClass) string {
	normalized := normalizePrimaryAssetClass(assetClassCode)
	for _, sleeve := range sleeves {
		if normalizePrimaryAssetClass(sleeve.Code) == normalized && strings.TrimSpace(sleeve.DisplayName) != "" {
			return strings.TrimSpace(sleeve.DisplayName)
		}
	}
	if normalized == "" || normalized == "UNASSIGNED" {
		return ""
	}
	return strings.Title(strings.ToLower(strings.ReplaceAll(normalized, "_", " ")))
}

func resolveStockGroupAssetClassCode(groupName, assetClassCode string) (string, bool) {
	return resolveStockGroupAssetClassCodeFromAssetClasses(groupName, assetClassCode, loadAssetClasses())
}

func resolveStockGroupAssetClassCodeFromAssetClasses(groupName, assetClassCode string, sleeves []AssetClass) (string, bool) {
	if sleeveCode, ok := resolvePortfolioGroupingAssetClassCodeFromAssetClasses(assetClassCode, sleeves); ok && sleeveCode != "" {
		return sleeveCode, true
	}
	if sleeveCode, ok := resolvePortfolioGroupingAssetClassCodeFromAssetClasses(groupName, sleeves); ok && sleeveCode != "" {
		return sleeveCode, true
	}
	return "", false
}

type stockGroupMigrationRow struct {
	ID             string
	Name           string
	AssetClassCode string
	ParentID       string
}

func migrateStockGroupAssetClassCodes() {
	sleeves := loadAssetClasses()
	rows, err := db.Query(`
		SELECT id, name, COALESCE(asset_class_code, ''), COALESCE(parent_id, '')
		FROM stock_groups
	`)
	if err != nil {
		log.Printf("[ASSET CLASS] Failed to inspect stock group asset-class codes: %v", err)
		return
	}
	defer rows.Close()

	groups := make([]stockGroupMigrationRow, 0)
	for rows.Next() {
		var row stockGroupMigrationRow
		if err := rows.Scan(&row.ID, &row.Name, &row.AssetClassCode, &row.ParentID); err != nil {
			log.Printf("[ASSET CLASS] Failed to scan stock group for asset-class migration: %v", err)
			return
		}
		groups = append(groups, row)
	}
	if err := rows.Err(); err != nil {
		log.Printf("[ASSET CLASS] Failed while reading stock groups for asset-class migration: %v", err)
		return
	}

	updated := 0
	cleared := 0
	deleted := 0
	childIDsByParent := make(map[string][]string)
	for _, group := range groups {
		parentID := strings.TrimSpace(group.ParentID)
		if parentID != "" {
			childIDsByParent[parentID] = append(childIDsByParent[parentID], group.ID)
		}
	}
	groupsByID := make(map[string]stockGroupMigrationRow, len(groups))
	for _, group := range groups {
		groupsByID[group.ID] = group
	}
	for _, group := range groups {
		if childIDs := childIDsByParent[group.ID]; len(childIDs) > 0 {
			displayName := strings.TrimSpace(group.Name)
			if inferred := inferDisplayParentGroupName(group, childIDs, groupsByID, sleeves); inferred != "" {
				displayName = inferred
			}
			if displayName == "" {
				displayName = "Group"
			}
			if strings.TrimSpace(group.AssetClassCode) != "" || displayName != strings.TrimSpace(group.Name) {
				if _, err := db.Exec(`UPDATE stock_groups SET asset_class_code = '', name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, displayName, group.ID); err != nil {
					log.Printf("[ASSET CLASS] Failed to normalise display parent group %s: %v", group.ID, err)
					continue
				}
				cleared++
			}
			continue
		}

		if sleeveCode, ok := resolveStockGroupAssetClassCodeFromAssetClasses(group.Name, group.AssetClassCode, sleeves); ok {
			displayName := displayNameForAssetClassFromAssetClasses(sleeveCode, sleeves)
			groupName := strings.TrimSpace(group.Name)
			if groupName == "" {
				groupName = displayName
			}
			if sleeveCode == strings.TrimSpace(group.AssetClassCode) && groupName == strings.TrimSpace(group.Name) {
				continue
			}
			if _, err := db.Exec(`UPDATE stock_groups SET asset_class_code = ?, name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, sleeveCode, groupName, group.ID); err != nil {
				log.Printf("[ASSET CLASS] Failed to normalise stock group asset class %s: %v", group.ID, err)
				continue
			}
			updated++
			continue
		}

		if _, err := db.Exec(`DELETE FROM stock_group_assignments WHERE group_id = ?`, group.ID); err != nil {
			log.Printf("[ASSET CLASS] Failed to clear assignments for invalid stock group %s: %v", group.ID, err)
			continue
		}
		if _, err := db.Exec(`DELETE FROM stock_groups WHERE id = ?`, group.ID); err != nil {
			log.Printf("[ASSET CLASS] Failed to delete invalid stock group %s: %v", group.ID, err)
			continue
		}
		deleted++
	}
	if updated > 0 || cleared > 0 || deleted > 0 {
		log.Printf("[ASSET CLASS] Stock group asset-class code migration complete: %d updated, %d cleared, %d deleted", updated, cleared, deleted)
	}
}

func inferDisplayParentGroupName(parent stockGroupMigrationRow, childIDs []string, groupsByID map[string]stockGroupMigrationRow, sleeves []AssetClass) string {
	childCodes := make([]string, 0, len(childIDs))
	for _, childID := range childIDs {
		child, ok := groupsByID[childID]
		if !ok {
			continue
		}
		if sleeveCode, ok := resolveStockGroupAssetClassCodeFromAssetClasses(child.Name, child.AssetClassCode, sleeves); ok {
			childCodes = append(childCodes, sleeveCode)
		}
	}
	if len(childCodes) == 0 {
		return strings.TrimSpace(parent.Name)
	}

	allResources := true
	for _, code := range childCodes {
		if _, ok := materialResourceAssetClassCodes[normalizePrimaryAssetClass(code)]; !ok {
			allResources = false
			break
		}
	}
	if allResources {
		return "Materials"
	}

	parentCounts := make(map[string]int)
	displayByParent := make(map[string]string)
	for _, code := range childCodes {
		for _, sleeve := range sleeves {
			if normalizePrimaryAssetClass(sleeve.Code) != normalizePrimaryAssetClass(code) {
				continue
			}
			parentCode := normalizePrimaryAssetClass(sleeve.ParentCode)
			if parentCode == "" {
				continue
			}
			parentCounts[parentCode]++
			displayByParent[parentCode] = displayNameForAssetClassFromAssetClasses(parentCode, sleeves)
			break
		}
	}
	for parentCode, count := range parentCounts {
		if count == len(childCodes) {
			if displayByParent[parentCode] != "" {
				return displayByParent[parentCode]
			}
			return strings.Title(strings.ToLower(strings.ReplaceAll(parentCode, "_", " ")))
		}
	}

	return strings.TrimSpace(parent.Name)
}

func migrateStockAnalysisPrimaryAssetClasses() {
	rows, err := db.Query(`
		SELECT id, COALESCE(primary_asset_class, '')
		FROM stock_analysis
		WHERE TRIM(COALESCE(primary_asset_class, '')) != ''
	`)
	if err != nil {
		log.Printf("[ASSET CLASS] Failed to inspect stock analysis asset-class assignments: %v", err)
		return
	}
	defer rows.Close()

	type analysisRow struct {
		ID                int
		PrimaryAssetClass string
	}
	items := make([]analysisRow, 0)
	for rows.Next() {
		var item analysisRow
		if err := rows.Scan(&item.ID, &item.PrimaryAssetClass); err != nil {
			log.Printf("[ASSET CLASS] Failed to scan stock analysis asset-class assignment: %v", err)
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		log.Printf("[ASSET CLASS] Failed while reading stock analysis asset-class assignments: %v", err)
		return
	}

	updated := 0
	cleared := 0
	for _, item := range items {
		resolved, ok := resolvePortfolioAssignmentClass(item.PrimaryAssetClass)
		if !ok || resolved == "" {
			if _, err := db.Exec(`UPDATE stock_analysis SET primary_asset_class = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, item.ID); err != nil {
				log.Printf("[ASSET CLASS] Failed to clear non-conforming stock analysis assignment %d: %v", item.ID, err)
				continue
			}
			cleared++
			continue
		}
		if resolved == strings.TrimSpace(item.PrimaryAssetClass) {
			continue
		}
		if _, err := db.Exec(`UPDATE stock_analysis SET primary_asset_class = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, resolved, item.ID); err != nil {
			log.Printf("[ASSET CLASS] Failed to normalise stock analysis assignment %d: %v", item.ID, err)
			continue
		}
		updated++
	}
	if updated > 0 || cleared > 0 {
		log.Printf("[ASSET CLASS] Stock analysis asset-class migration complete: %d updated, %d cleared", updated, cleared)
	}
}

func getOverlayAssetClassSettings() []OverlayAssetClassSetting {
	rows, err := db.Query(`
		SELECT code, display_name, COALESCE(alert_label, ''), COALESCE(alert_color, ''),
		       COALESCE(kind, 'ASSET_CLASS'), COALESCE(parent_code, ''),
		       COALESCE(is_portfolio_sleeve, 0), COALESCE(is_system_bucket, 0),
		       COALESCE(allow_grouping, 1), COALESCE(allow_target_weight, 1),
		       overlay_eligible, display_order, q3_sell_priority,
		       q3_throttle_factor, q4d_liquidity_factor,
		       q1_category, q3_beneficiary, regime_independent, q3_rating, q3_logic,
		       stage2_target_pct, COALESCE(sector, ''), COALESCE(cash_reserve, 0),
		       COALESCE(stock_allocation_ratio, 0.75), active
		FROM asset_class_config
		WHERE active = 1
		ORDER BY display_order, code
	`)
	if err != nil {
		log.Printf("[ASSET CLASS CONFIG] Failed to load config, using defaults: %v", err)
		return defaultOverlayAssetClassSettingsWithTaxonomy()
	}
	defer rows.Close()

	settings := []OverlayAssetClassSetting{}
	for rows.Next() {
		var setting OverlayAssetClassSetting
		if err := rows.Scan(
			&setting.Key,
			&setting.DisplayName,
			&setting.AlertLabel,
			&setting.AlertColor,
			&setting.Kind,
			&setting.ParentCode,
			&setting.IsPortfolioSleeve,
			&setting.IsSystemBucket,
			&setting.AllowGrouping,
			&setting.AllowTargetWeight,
			&setting.OverlayEligible,
			&setting.DisplayOrder,
			&setting.Q3SellPriority,
			&setting.Q3ThrottleFactor,
			&setting.Q4DLiquidityFactor,
			&setting.Q1Category,
			&setting.Q3Beneficiary,
			&setting.RegimeIndependent,
			&setting.Q3Rating,
			&setting.Q3Logic,
			&setting.Stage2TargetPct,
			&setting.Sector,
			&setting.CashReserve,
			&setting.StockAllocationRatio,
			&setting.Active,
		); err != nil {
			log.Printf("[ASSET CLASS CONFIG] Failed to scan row: %v", err)
			continue
		}
		settings = append(settings, setting)
	}

	if len(settings) == 0 {
		return defaultOverlayAssetClassSettingsWithTaxonomy()
	}

	return settings
}

func getOverlayAssetClassSetting(assetClass string) OverlayAssetClassSetting {
	assetClass = strings.ToUpper(strings.TrimSpace(assetClass))
	for _, setting := range getOverlayAssetClassSettings() {
		if setting.Key == assetClass {
			return setting
		}
	}

	displayName := strings.Title(strings.ToLower(strings.ReplaceAll(assetClass, "_", " ")))
	if displayName == "" {
		displayName = "Unassigned"
	}

	return applyTaxonomyDefaults(OverlayAssetClassSetting{
		Key:                assetClass,
		DisplayName:        displayName,
		Kind:               "ASSET_CLASS",
		AllowGrouping:      false,
		AllowTargetWeight:  false,
		OverlayEligible:    false,
		DisplayOrder:       999,
		Q3SellPriority:     intPtr(3),
		Q3ThrottleFactor:   float64Ptr(0),
		Q4DLiquidityFactor: float64Ptr(1),
		CashReserve:        0,
		Active:             true,
	})
}

func normalizeSecurityType(value string) string {
	normalized := strings.ToUpper(strings.TrimSpace(value))
	switch normalized {
	case "ETF", "FUND":
		return "ETF"
	case "CVR", "CONTINGENT_VALUE_RIGHT", "CONTINGENT_VALUE_RIGHTS", "CONTINGENT VALUE RIGHT", "CONTINGENT VALUE RIGHTS":
		return "CVR"
	case "NON_ALLOCATING", "NON-ALLOCATING", "NON ALLOCATING":
		return "NON_ALLOCATING"
	default:
		return "STOCK"
	}
}

func isNonAllocatingSecurityType(value string) bool {
	normalized := normalizeSecurityType(value)
	return normalized == "CVR" || normalized == "NON_ALLOCATING"
}

func isNonAllocatingInstrumentName(name string) bool {
	compact := strings.ToUpper(strings.TrimSpace(name))
	return strings.Contains(compact, "CONTINGENT VALUE RIGHT") ||
		strings.Contains(compact, "CONTINGENT VALUE RIGHTS")
}

func resolveSecurityTypeForAnalysis(name string, securityType *string) string {
	if securityType != nil {
		return normalizeSecurityType(*securityType)
	}
	if isNonAllocatingInstrumentName(name) {
		return "CVR"
	}
	return ""
}

func isRecognizedPrimaryAssetClass(assetClass string) bool {
	normalized := strings.ToUpper(strings.TrimSpace(assetClass))
	if normalized == "" {
		return false
	}
	for _, setting := range getOverlayAssetClassSettings() {
		if setting.Key == normalized {
			return true
		}
	}
	return false
}

func choosePrimaryAssetClass(candidates []string) string {
	if len(candidates) == 0 {
		return "UNASSIGNED"
	}

	seen := map[string]struct{}{}
	unique := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		normalized := normalizePrimaryAssetClass(candidate)
		if normalized == "" {
			continue
		}
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		unique = append(unique, normalized)
	}

	if len(unique) == 0 {
		return "UNASSIGNED"
	}

	for _, preferred := range primaryAssetClassPriority {
		for _, candidate := range unique {
			if candidate == preferred {
				return candidate
			}
		}
	}

	sort.Strings(unique)
	return unique[0]
}
