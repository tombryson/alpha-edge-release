package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"
)

type watchlistPeer struct {
	Ticker string  `json:"ticker"`
	Before float64 `json:"before"`
	After  float64 `json:"after"`
}

type watchlistOpportunity struct {
	ID         int             `json:"id"`
	Ticker     string          `json:"ticker"`
	Name       string          `json:"name"`
	AssetClass string          `json:"asset_class"`
	ClassName  string          `json:"class_name"`
	Signal     string          `json:"signal"`
	SignalAt   string          `json:"signal_at,omitempty"`
	Outperform string          `json:"outperform"`
	Benchmark  string          `json:"benchmark,omitempty"`
	State      string          `json:"state"`
	Reason     string          `json:"reason"`
	Entry      float64         `json:"entry"`
	IdealPct   *float64        `json:"ideal_pct"`
	ClassNow   float64         `json:"class_now"`
	ClassAfter float64         `json:"class_after"`
	ClassLimit float64         `json:"class_limit"`
	ClassCash  float64         `json:"class_cash"`
	ActionID   int             `json:"action_id,omitempty"`
	Peers      []watchlistPeer `json:"peers"`
}

// Preview only: this endpoint does not project actions, reserve cash or alter
// the held-stock universe. Each candidate is an alternative use of the pool.
func getWatchlistOpportunities(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	items, err := watchlistOpportunities(r.Context())
	if err != nil {
		http.Error(w, "Watchlist assessment unavailable", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"items": items, "as_of": time.Now().UTC().Format(time.RFC3339)})
}

func watchlistOpportunities(ctx context.Context) ([]watchlistOpportunity, error) {
	rows, err := db.QueryContext(ctx, `SELECT a.id, a.ticker, a.name, COALESCE(a.primary_asset_class,''), COALESCE(a.security_type,'STOCK')
		FROM stock_analysis a WHERE a.is_watchlist=1 AND COALESCE(a.is_external,0)=0
		AND NOT EXISTS (SELECT 1 FROM holdings h LEFT JOIN company_mappings m ON m.company_name=h.company_name
		WHERE h.is_active=1 AND (h.quantity>0 OR h.value_aud>0) AND
		UPPER(TRIM(CASE WHEN INSTR(COALESCE(NULLIF(h.ticker,''),m.ticker,''),':')>0
		THEN SUBSTR(COALESCE(NULLIF(h.ticker,''),m.ticker,''),INSTR(COALESCE(NULLIF(h.ticker,''),m.ticker,''),':')+1)
		ELSE COALESCE(NULLIF(h.ticker,''),m.ticker,'') END))=
		UPPER(TRIM(CASE WHEN INSTR(a.ticker,':')>0 THEN SUBSTR(a.ticker,INSTR(a.ticker,':')+1) ELSE a.ticker END)))
		ORDER BY a.name,a.id`)
	if err != nil {
		return nil, err
	}
	items := []watchlistOpportunity{}
	for rows.Next() {
		var item watchlistOpportunity
		var role string
		if err = rows.Scan(&item.ID, &item.Ticker, &item.Name, &item.AssetClass, &role); err != nil {
			rows.Close()
			return nil, err
		}
		if isNonAllocatingSecurityType(role) || isNonAllocatingInstrumentName(item.Name) {
			continue
		}
		item.Signal, item.Outperform = "UNKNOWN", "UNKNOWN"
		item.State, item.Reason = "WAITING", "Waiting for an entry signal"
		item.Peers = []watchlistPeer{}
		items = append(items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil || len(items) == 0 {
		return items, err
	}
	capacities, err := deploymentClassCapacities()
	if err != nil {
		return nil, err
	}
	funding, err := loadDeploymentFunding(db)
	if err != nil {
		return nil, err
	}
	baseline, baseErr := weightReferencesFrom(db, capacities, "")
	for i := range items {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		item := &items[i]
		class, err := securityActionAssetClassForTicker(item.Ticker)
		if err != nil {
			return nil, err
		}
		item.AssetClass = class
		capacity := capacities[class].forSecurity(item.Ticker, funding)
		item.ClassName = capacity.DisplayName
		if item.ClassName == "" {
			item.ClassName = class
		}
		item.ClassCash = math.Max(funding.ClassCash[class]-funding.ClassSpent[class], 0)
		if err := loadWatchlistSignals(ctx, item, capacity.Risk); err != nil {
			return nil, err
		}
		var pending int
		if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM security_actions WHERE ticker=? AND status IN ('AWAITING_STATEMENT','VARIANCE')`, securityActionTicker(item.Ticker)).Scan(&pending); err != nil {
			return nil, err
		}
		if pending > 0 {
			item.State, item.Reason = "PENDING", "Execution recorded; awaiting statement confirmation"
			continue
		}
		if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM security_actions WHERE ticker=? AND status='OPEN' AND intent IN ('EXIT','REDUCE')`, securityActionTicker(item.Ticker)).Scan(&pending); err != nil {
			return nil, err
		}
		if pending > 0 {
			item.State, item.Reason = "BLOCKED", "Resolve the outstanding exit or reduction before a new entry"
			continue
		}
		if !strings.Contains(item.Ticker, ":") {
			item.State, item.Reason = "RESEARCH", "Set the listing exchange in Analysis"
			continue
		}
		if baseErr != nil {
			item.State, item.Reason = "DATA", "Current statement and research evidence unavailable"
			continue
		}
		refs, err := weightReferencesFrom(db, capacities, item.Ticker)
		if err != nil {
			return nil, err
		}
		ref := refs[securityActionTicker(item.Ticker)]
		if ref.PortfolioValue > 0 {
			item.ClassNow = 100 * (capacity.TotalCurrent + funding.ClassSpent[class]) / ref.PortfolioValue
			item.ClassAfter = item.ClassNow
			item.ClassLimit = 100 * capacity.WorkingTarget / ref.PortfolioValue
		}
		if !ref.Available {
			item.State, item.Reason = "RESEARCH", ref.Reason
			if item.Reason == "" {
				item.Reason = "Research incomplete or identity ambiguous"
			}
			continue
		}
		if !ref.Fresh {
			item.State, item.Reason = "DATA", "Refresh statement or price history before reviewing entry"
			continue
		}
		if ref.Ideal <= 0 {
			item.State, item.Reason = "RESEARCH", "Research produces no positive allocation"
			continue
		}
		item.IdealPct = &ref.Percent
		heldCount := 0
		for ticker, peer := range refs {
			before, held := baseline[ticker]
			if peer.AssetClass != class || !held {
				continue
			}
			if peer.Role == "STOCK" {
				heldCount++
			}
			item.Peers = append(item.Peers, watchlistPeer{Ticker: peer.Ticker, Before: before.Percent, After: peer.Percent})
		}
		sort.Slice(item.Peers, func(i, j int) bool { return item.Peers[i].Ticker < item.Peers[j].Ticker })
		isFund := ref.Role == "ETF" || ref.Role == "CORE_ETF"
		if heldCount >= 10 && !isFund {
			item.State, item.Reason = "CAPACITY", "Ten stock positions already occupy this class"
			continue
		}
		source := "cdf"
		if isFund {
			mode, modeErr := etfManagementModeFrom(db, item.Ticker)
			if modeErr != nil {
				return nil, modeErr
			}
			if mode != "tms" {
				source = "etf_tms"
			}
		}
		permission, err := deploymentSecurityPermission(db, item.Ticker, "BUY", source, class, capacity.Risk)
		if err != nil {
			return nil, err
		}
		if permission.State != "" {
			item.State, item.Reason = permission.State, permission.Reason
			continue
		}
		if capacity.TargetShortfall < deploymentMinimumTicket {
			item.State, item.Reason = "CAPACITY", "Class has less than $100 of entry capacity"
			continue
		}
		if reason := funding.reason(); reason != "" {
			item.State, item.Reason = "FUNDING", reason
			continue
		}
		remaining := math.Min(capacity.AvailableFunding, funding.available())
		if remaining < deploymentMinimumTicket {
			item.State, item.Reason = "FUNDING", "Needs statement-backed class cash"
			continue
		}
		ticket := math.Min(math.Max(deploymentMinimumTicket, deploymentTicketFraction*capacity.AvailableFunding), remaining)
		if capacity.WeightEnabled {
			ticket = math.Min(ticket, math.Max(ref.Ideal-funding.SecuritySpent[securityActionTicker(item.Ticker)], 0))
		}
		if ticket < deploymentMinimumTicket {
			item.State, item.Reason = "WEIGHT_LIMIT", "Room below Ideal wt is less than the $100 minimum"
			continue
		}
		item.State, item.Reason = "READY", "Available within current class, signal and funding rules; verify the entry price before trading"
		item.Entry = math.Floor(ticket*100) / 100
		item.ClassAfter = item.ClassNow + 100*item.Entry/ref.PortfolioValue
	}
	sort.SliceStable(items, func(i, j int) bool {
		rank := func(item watchlistOpportunity) int {
			if item.State == "READY" {
				return 0
			}
			if item.State == "PENDING" {
				return 1
			}
			if item.Signal == "BREAKOUT" || item.Outperform == "BUY" {
				return 2
			}
			return 3
		}
		if rank(items[i]) != rank(items[j]) {
			return rank(items[i]) < rank(items[j])
		}
		return items[i].Name < items[j].Name
	})
	return items, nil
}

func loadWatchlistSignals(ctx context.Context, item *watchlistOpportunity, risk deploymentRisk) error {
	err := db.QueryRowContext(ctx, `SELECT position_state FROM security_positions WHERE ticker=?`, securityActionTicker(item.Ticker)).Scan(&item.Signal)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	var signal string
	err = db.QueryRowContext(ctx, `SELECT alert_type,created_at FROM alerts WHERE UPPER(TRIM(ticker)) IN (?,?) AND is_active=1
		AND (expiry_date IS NULL OR datetime(expiry_date)>datetime('now'))
		AND alert_type IN ('BUY','SELL','SELL_50','SELL_DOWN','BREAKOUT','ADD','TRIM') ORDER BY datetime(created_at) DESC,id DESC LIMIT 1`, strings.ToUpper(strings.TrimSpace(item.Ticker)), securityActionTicker(item.Ticker)).Scan(&signal, &item.SignalAt)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	if signal == "BREAKOUT" && item.Signal == "BUY" {
		item.Signal = "BREAKOUT"
	}
	err = db.QueryRowContext(ctx, `SELECT id FROM security_actions WHERE ticker=? AND intent='DEPLOY' AND status='OPEN' ORDER BY id DESC LIMIT 1`, securityActionTicker(item.Ticker)).Scan(&item.ActionID)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	themes, err := loadCommodityThemeConfigsFrom(ctx, db)
	if err != nil {
		return err
	}
	for _, theme := range themes {
		if theme.TacticalAssetCode != item.AssetClass {
			continue
		}
		stages, err := loadCommodityThemeStageConfigsFrom(ctx, db, theme.Code)
		if err != nil {
			return err
		}
		events, err := loadCommodityThemeEventsFrom(ctx, db, theme.Code)
		if err != nil {
			return err
		}
		for _, stage := range stages {
			if stage.Key != "SECURITY_OUTPERFORM" {
				continue
			}
			source := resolvedCommodityThemeSource(stage, &resolvedCommodityThemeSecurity{Ticker: item.Ticker})
			item.Benchmark = source.Denominator
			if !hasCommodityThemeCDFConnection(risk.Connections["cdf"], source) {
				continue
			}
			var latest *commodityThemeEvent
			for i := range events {
				event := &events[i]
				if event.StageKey != stage.Key || event.Scope != stage.Scope || !sameConfiguredSymbol(item.Ticker, event.SecurityTicker) || !commodityThemeEventMatchesConfiguredStage(*event, stage) {
					continue
				}
				if event.Signal != "BUY" && event.Signal != "SELL" {
					continue
				}
				if latest == nil || eventIsLater(*event, *latest) {
					latest = event
				}
			}
			if latest != nil {
				item.Outperform = latest.Signal
			}
		}
	}
	return nil
}
