package main

import (
	"context"
	"sort"
	"strings"
	"time"
)

type overlayAnalysisRow struct {
	Ticker              string
	Name                string
	Allocation          float64
	PrimaryAssetClass   string
	SecurityType        string
	OverlaySellPriority int
}

type overlayHoldingRow struct {
	Ticker        string
	Name          string
	InvestedValue float64
	TacticalCash  float64
}

type overlayPortfolioContext struct {
	StatementTotalValue      float64
	StatementCash            float64
	StatementDate            time.Time
	StatementCreatedAt       time.Time
	PortfolioCashBucketValue float64
	CashComponents           []PortfolioCashComponent
	TotalTacticalCashValue   float64
	ClassSummaries           map[string]*PortfolioOverlayAssetClassSummary
	StrategicWeightByClass   map[string]float64
	DirectStockWeightByClass map[string]float64
	ETFActualByTicker        map[string]float64
	AssetClassKeys           map[string]struct{}
}

// loadOverlaySignalStateReadOnly returns the persisted overlay signal state
// with NO side effects: no row initialisation and no self-baseline repair.
// Used by the read-only summary endpoint so that polling can never mutate
// workflow state. All mutation paths (webhooks, stage handlers, explicit
// POST /api/portfolio-overlay/sync) still go through
// syncOverlaySignalStateAndEvent / loadOrInitOverlaySignalState.
func buildOverlayPortfolioContext(ctx context.Context) (*overlayPortfolioContext, error) {
	return buildOverlayPortfolioContextFrom(ctx, db)
}

func buildOverlayPortfolioContextFrom(ctx context.Context, reader deploymentReader) (*overlayPortfolioContext, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	sleeves := loadAssetClasses()
	settings := getOverlayAssetClassSettings()
	getSetting := func(assetClass string) OverlayAssetClassSetting {
		normalized := strings.ToUpper(strings.TrimSpace(assetClass))
		for _, setting := range settings {
			if setting.Key == normalized {
				return setting
			}
		}
		displayName := strings.Title(strings.ToLower(strings.ReplaceAll(normalized, "_", " ")))
		if displayName == "" {
			displayName = "Unassigned"
		}
		return applyTaxonomyDefaults(OverlayAssetClassSetting{
			Key:                normalized,
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

	var statementTotalValue float64
	var statementCash float64
	var statementDate time.Time
	var statementCreatedAt time.Time
	groupDerivedByCompany := loadGroupDerivedAssetClasses(ctx)

	err := reader.QueryRowContext(ctx, `
		SELECT total_value_aud, cash_aud, statement_date, created_at
		FROM account_statements
		ORDER BY statement_date DESC, id DESC
		LIMIT 1
	`).Scan(&statementTotalValue, &statementCash, &statementDate, &statementCreatedAt)
	if err != nil {
		return nil, err
	}

	etfTickers := map[string]bool{}
	etfRows, err := reader.QueryContext(ctx, `SELECT ticker FROM etf_allocations`)
	if err != nil {
		return nil, err
	}
	for etfRows.Next() {
		var ticker string
		if err := etfRows.Scan(&ticker); err != nil {
			etfRows.Close()
			return nil, err
		}
		etfTickers[canonicalSecurityTickerKey(ticker)] = true
	}
	err = etfRows.Err()
	etfRows.Close()
	if err != nil {
		return nil, err
	}

	analysisRows, err := reader.QueryContext(ctx, `
		SELECT COALESCE(ticker, ''), name, allocation, COALESCE(primary_asset_class, ''), COALESCE(security_type, ''), COALESCE(overlay_sell_priority, 3)
		FROM stock_analysis
	`)
	if err != nil {
		return nil, err
	}

	analysisByTicker := make(map[string]overlayAnalysisRow)
	analysisByName := make(map[string]overlayAnalysisRow)
	strategicWeightByClass := make(map[string]float64)
	directStockWeightByClass := make(map[string]float64)
	etfActualByTicker := make(map[string]float64)

	for analysisRows.Next() {
		var row overlayAnalysisRow
		if err := analysisRows.Scan(&row.Ticker, &row.Name, &row.Allocation, &row.PrimaryAssetClass, &row.SecurityType, &row.OverlaySellPriority); err != nil {
			analysisRows.Close()
			return nil, err
		}

		canonicalTicker := canonicalSecurityTickerKey(row.Ticker)
		if strings.EqualFold(row.SecurityType, "ETF") && canonicalTicker != "" {
			etfTickers[canonicalTicker] = true
		}
		if canonicalTicker != "" {
			analysisByTicker[canonicalTicker] = row
		}
		if row.Name != "" {
			analysisByName[row.Name] = row
		}

		if row.Allocation <= 0 || canonicalTicker == "" || isNonAllocatingSecurityType(row.SecurityType) || isNonAllocatingInstrumentName(row.Name) {
			continue
		}

		groupAssetClass := groupDerivedByCompany[strings.TrimSpace(row.Name)]
		if groupAssetClass == "" {
			groupAssetClass = groupDerivedByCompany[canonicalCompanyNameKey(row.Name)]
		}
		assetClass := resolveAuthoritativeAssetClassFromAssetClasses(groupAssetClass, row.PrimaryAssetClass, canonicalTicker, row.Name, sleeves)
		strategicWeightByClass[assetClass] += row.Allocation
		if !etfTickers[canonicalTicker] {
			directStockWeightByClass[assetClass] += row.Allocation
		}
	}
	if err := analysisRows.Err(); err != nil {
		analysisRows.Close()
		return nil, err
	}
	analysisRows.Close()

	holdingRows, err := reader.QueryContext(ctx, `
		SELECT
			COALESCE(NULLIF(TRIM(h.ticker), ''), NULLIF(TRIM(m.ticker), ''), ''),
			h.company_name,
			h.value_aud,
			h.cash_reserve
		FROM holdings h
		LEFT JOIN company_mappings m ON h.company_name = m.company_name
		WHERE h.is_active = 1
	`)
	if err != nil {
		return nil, err
	}

	classSummaries := make(map[string]*PortfolioOverlayAssetClassSummary)
	totalTacticalCashValue := 0.0
	portfolioCashBucketValue := statementCash
	cashComponents := []PortfolioCashComponent{}
	if statementCash > 0.01 {
		cashComponents = append(cashComponents, PortfolioCashComponent{
			Key:          "BROKER_CASH",
			DisplayName:  "Broker Cash",
			Value:        statementCash,
			DisplayOrder: 1,
		})
	}

	getClassSummary := func(assetClass string) *PortfolioOverlayAssetClassSummary {
		assetClass = choosePrimaryAssetClass([]string{assetClass})
		if existing, ok := classSummaries[assetClass]; ok {
			return existing
		}
		setting := getSetting(assetClass)
		summary := &PortfolioOverlayAssetClassSummary{
			AssetClass:         setting.Key,
			DisplayName:        setting.DisplayName,
			OverlayEligible:    setting.OverlayEligible,
			DisplayOrder:       setting.DisplayOrder,
			Q3ThrottleFactor:   float64Ptr(q3ThrottleFactorForSetting(setting)),
			Q4DLiquidityFactor: float64Ptr(q4dLiquidityFactorForSetting(setting)),
			SellCandidates:     []PortfolioOverlaySellCandidate{},
		}
		classSummaries[assetClass] = summary
		return summary
	}

	for holdingRows.Next() {
		var row overlayHoldingRow
		if err := holdingRows.Scan(&row.Ticker, &row.Name, &row.InvestedValue, &row.TacticalCash); err != nil {
			holdingRows.Close()
			return nil, err
		}

		canonicalTicker := canonicalSecurityTickerKey(row.Ticker)
		if isCashEquivalentTicker(canonicalTicker) {
			portfolioCashBucketValue += row.InvestedValue
			cashComponents = append(cashComponents, PortfolioCashComponent{
				Key:          canonicalTicker,
				DisplayName:  row.Name,
				Ticker:       canonicalTicker,
				Value:        row.InvestedValue,
				DisplayOrder: 10 + len(cashComponents),
			})
			continue
		}

		analysis := analysisByTicker[canonicalTicker]
		if analysis.Name == "" {
			analysis = analysisByName[row.Name]
		}
		if isNonAllocatingSecurityType(analysis.SecurityType) || isNonAllocatingInstrumentName(row.Name) {
			continue
		}

		groupAssetClass := groupDerivedByCompany[strings.TrimSpace(row.Name)]
		if groupAssetClass == "" {
			groupAssetClass = groupDerivedByCompany[canonicalCompanyNameKey(row.Name)]
		}
		assetClass := resolveAuthoritativeAssetClassFromAssetClasses(groupAssetClass, analysis.PrimaryAssetClass, canonicalTicker, row.Name, sleeves)
		summary := getClassSummary(assetClass)
		setting := getSetting(assetClass)
		summary.ActualInvestedValue += row.InvestedValue
		if etfTickers[canonicalTicker] && canonicalTicker != "" {
			etfActualByTicker[canonicalTicker] += row.InvestedValue
		}
		summary.TacticalCashValue += row.TacticalCash
		totalTacticalCashValue += row.TacticalCash

		positionExposurePct := 0.0
		if row.InvestedValue+row.TacticalCash > 0 {
			positionExposurePct = (row.InvestedValue / (row.InvestedValue + row.TacticalCash)) * 100
		}

		sellPriority := analysis.OverlaySellPriority
		if sellPriority <= 0 && setting.Q3SellPriority != nil {
			sellPriority = *setting.Q3SellPriority
		}
		if sellPriority <= 0 {
			sellPriority = 3
		}

		portfolioWeightPct := 0.0
		if statementTotalValue > 0 {
			portfolioWeightPct = (row.InvestedValue / statementTotalValue) * 100
		}

		if row.InvestedValue > 0 {
			summary.SellCandidates = append(summary.SellCandidates, PortfolioOverlaySellCandidate{
				Ticker:              canonicalTicker,
				Name:                row.Name,
				PositionValue:       row.InvestedValue,
				PortfolioWeightPct:  portfolioWeightPct,
				PositionExposurePct: positionExposurePct,
				OverlaySellPriority: sellPriority,
				AllocationPct:       analysis.Allocation,
			})
		}
	}
	if err := holdingRows.Err(); err != nil {
		holdingRows.Close()
		return nil, err
	}
	holdingRows.Close()

	assetClassKeys := map[string]struct{}{}
	for assetClass := range classSummaries {
		assetClassKeys[assetClass] = struct{}{}
	}
	for assetClass := range strategicWeightByClass {
		assetClassKeys[assetClass] = struct{}{}
	}

	for assetClass := range assetClassKeys {
		summary := getClassSummary(assetClass)
		summary.TotalClassCapitalValue = summary.ActualInvestedValue + summary.TacticalCashValue
		if statementTotalValue > 0 {
			summary.ActualInvestedPct = (summary.ActualInvestedValue / statementTotalValue) * 100
			summary.TacticalCashPct = (summary.TacticalCashValue / statementTotalValue) * 100
			summary.TotalClassCapitalPct = (summary.TotalClassCapitalValue / statementTotalValue) * 100
		}
		sort.Slice(summary.SellCandidates, func(i, j int) bool {
			left := summary.SellCandidates[i]
			right := summary.SellCandidates[j]
			if left.OverlaySellPriority != right.OverlaySellPriority {
				return left.OverlaySellPriority < right.OverlaySellPriority
			}
			return left.PositionValue > right.PositionValue
		})
		if len(summary.SellCandidates) > 5 {
			summary.SellCandidates = summary.SellCandidates[:5]
		}
	}

	return &overlayPortfolioContext{
		StatementTotalValue:      statementTotalValue,
		StatementCash:            statementCash,
		StatementDate:            statementDate,
		StatementCreatedAt:       statementCreatedAt,
		PortfolioCashBucketValue: portfolioCashBucketValue,
		CashComponents:           cashComponents,
		TotalTacticalCashValue:   totalTacticalCashValue,
		ClassSummaries:           classSummaries,
		StrategicWeightByClass:   strategicWeightByClass,
		DirectStockWeightByClass: directStockWeightByClass,
		ETFActualByTicker:        etfActualByTicker,
		AssetClassKeys:           assetClassKeys,
	}, nil
}
