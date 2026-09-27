package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const cycleEvidenceDays = 7

type portfolioCycle struct {
	SnapshotID int64     `json:"snapshot_id"`
	StartedAt  time.Time `json:"started_at"`
	EndedAt    time.Time `json:"ended_at"`
	Closed     bool      `json:"closed"`
}

type cycleSecurityReturn struct {
	Ticker         string   `json:"ticker"`
	Exchange       string   `json:"exchange"`
	Name           string   `json:"name"`
	AssetClass     string   `json:"asset_class"`
	OpeningValue   float64  `json:"opening_value_aud"`
	ReturnPct      *float64 `json:"return_pct"`
	StartPriceDate string   `json:"start_price_date,omitempty"`
	EndPriceDate   string   `json:"end_price_date,omitempty"`
	Reason         string   `json:"reason,omitempty"`
}

type cycleClassReturn struct {
	AssetClass  string   `json:"asset_class"`
	ReturnPct   *float64 `json:"return_pct"`
	Securities  int      `json:"securities"`
	Covered     int      `json:"covered"`
	CoveragePct float64  `json:"coverage_pct"`
	Reason      string   `json:"reason,omitempty"`
}

type portfolioCycleResponse struct {
	Cycle         *portfolioCycle       `json:"cycle"`
	Method        string                `json:"method"`
	BaselineAt    *time.Time            `json:"baseline_at"`
	Classes       []cycleClassReturn    `json:"classes"`
	Securities    []cycleSecurityReturn `json:"securities"`
	BestPerformer *cycleSecurityReturn  `json:"best_performer"`
	Covered       int                   `json:"covered"`
	Reason        string                `json:"reason,omitempty"`
}

type cyclePrice struct {
	Date          string
	Symbol        string
	Currency      string
	AdjustedClose float64
}

func cycleIdentity(ticker, exchange string) string {
	ticker = strings.ToUpper(strings.TrimSpace(ticker))
	exchange = strings.TrimRight(strings.ToUpper(strings.TrimSpace(exchange)), ":")
	if parts := strings.Split(ticker, ":"); len(parts) == 2 {
		if exchange != "" && exchange != parts[0] {
			return ""
		}
		exchange, ticker = parts[0], parts[1]
	}
	if ticker == "" || exchange == "" {
		return ""
	}
	return exchange + ":" + ticker
}

func validCycleNumber(value float64) bool {
	return value > 0 && !math.IsNaN(value) && !math.IsInf(value, 0)
}

// Use completed daily bars before each boundary. Never use the closing price of
// an approval day that may still have been in progress when approval occurred.
func cyclePriceWindow(boundary time.Time) (string, string) {
	day := time.Date(boundary.UTC().Year(), boundary.UTC().Month(), boundary.UTC().Day(), 0, 0, 0, 0, time.UTC)
	return day.AddDate(0, 0, -cycleEvidenceDays).Format("2006-01-02"), day.AddDate(0, 0, -1).Format("2006-01-02")
}

func loadCyclePrices(ctx context.Context, tx *sql.Tx, boundary time.Time) (map[string]cyclePrice, error) {
	from, to := cyclePriceWindow(boundary)
	rows, err := tx.QueryContext(ctx, `WITH ranked AS (
		SELECT ticker, exchange_prefix, observed_date, yahoo_symbol, currency, adjusted_close_price,
		ROW_NUMBER() OVER (PARTITION BY ticker, exchange_prefix ORDER BY observed_date DESC, id DESC) AS rank
		FROM security_price_daily WHERE source = 'YAHOO' AND date(observed_date) BETWEEN ? AND ?
	) SELECT ticker, COALESCE(exchange_prefix, ''), observed_date, yahoo_symbol, COALESCE(currency, ''), adjusted_close_price
	FROM ranked WHERE rank = 1`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	prices := make(map[string]cyclePrice)
	for rows.Next() {
		var ticker, exchange string
		var date time.Time
		var price cyclePrice
		if err := rows.Scan(&ticker, &exchange, &date, &price.Symbol, &price.Currency, &price.AdjustedClose); err != nil {
			return nil, err
		}
		price.Date = date.UTC().Format("2006-01-02")
		key := cycleIdentity(ticker, exchange)
		if key != "" {
			// Multiple stored aliases must not silently pick one conflicting series.
			if _, duplicate := prices[key]; duplicate {
				price.AdjustedClose = 0
			}
			prices[key] = price
		}
	}
	return prices, rows.Err()
}

func calculateCycleReturns(result *portfolioCycleResponse, opening, closing map[string]cyclePrice) {
	classByCode := make(map[string]*cycleClassReturn)
	for i := range result.Classes {
		classByCode[result.Classes[i].AssetClass] = &result.Classes[i]
	}
	// Finish constructing the slice before retaining pointers into it.
	for _, security := range result.Securities {
		if _, exists := classByCode[security.AssetClass]; !exists {
			result.Classes = append(result.Classes, cycleClassReturn{AssetClass: security.AssetClass})
			classByCode[security.AssetClass] = nil
		}
	}
	for i := range result.Classes {
		classByCode[result.Classes[i].AssetClass] = &result.Classes[i]
	}
	totals, coveredValues, weighted := map[string]float64{}, map[string]float64{}, map[string]float64{}
	identities := make(map[string]int)
	for _, security := range result.Securities {
		identities[cycleIdentity(security.Ticker, security.Exchange)]++
	}
	for i := range result.Securities {
		security := &result.Securities[i]
		class := classByCode[security.AssetClass]
		class.Securities++
		totals[security.AssetClass] += security.OpeningValue
		key := cycleIdentity(security.Ticker, security.Exchange)
		start, startOK := opening[key]
		end, endOK := closing[key]
		switch {
		case key == "" || identities[key] != 1:
			security.Reason = "Opening security identity is missing or ambiguous."
		case !startOK || !endOK:
			security.Reason = "Missing price evidence within seven days of a cycle boundary."
		case !validCycleNumber(start.AdjustedClose) || !validCycleNumber(end.AdjustedClose):
			security.Reason = "Valid adjusted prices are unavailable."
		case start.Symbol != end.Symbol || start.Currency == "" || !strings.EqualFold(start.Currency, end.Currency):
			security.Reason = "Price series or currency changed; returns are not comparable."
		case end.Date <= start.Date:
			security.Reason = "Not enough price history in this cycle."
		default:
			value := (end.AdjustedClose/start.AdjustedClose - 1) * 100
			if math.IsNaN(value) || math.IsInf(value, 0) {
				security.Reason = "Invalid price return."
				break
			}
			security.ReturnPct = &value
			security.StartPriceDate, security.EndPriceDate = start.Date, end.Date
			class.Covered++
			result.Covered++
			coveredValues[security.AssetClass] += security.OpeningValue
			weighted[security.AssetClass] += value * security.OpeningValue
		}
	}
	for i := range result.Classes {
		class := &result.Classes[i]
		total := totals[class.AssetClass]
		if total > 0 {
			class.CoveragePct = coveredValues[class.AssetClass] / total * 100
		}
		switch {
		case class.AssetClass == "CASH":
			class.Reason = "Cash interest is not included in price returns."
		case class.Securities == 0:
			class.Reason = "No recorded holdings at the start of this cycle."
		case class.Covered != class.Securities:
			class.Reason = fmt.Sprintf("Price evidence covers %d of %d opening holdings; no partial average is shown.", class.Covered, class.Securities)
		case total <= 0:
			class.Reason = "Opening capital is unavailable."
		default:
			value := weighted[class.AssetClass] / total
			class.ReturnPct = &value
		}
	}
	// Do not crown a winner from an incomplete subset or just today's survivors.
	if result.Covered == len(result.Securities) && result.Covered > 0 {
		for i := range result.Securities {
			candidate := &result.Securities[i]
			if result.BestPerformer == nil || *candidate.ReturnPct > *result.BestPerformer.ReturnPct {
				result.BestPerformer = candidate
			}
		}
	} else if len(result.Securities) > 0 {
		result.Reason = fmt.Sprintf("Cycle price evidence covers %d of %d opening holdings. Best performer is withheld until coverage is complete.", result.Covered, len(result.Securities))
	}
}

var errCycleNotFound = errors.New("approved portfolio shape not found")

func loadPortfolioCycle(ctx context.Context, snapshotID int64, now time.Time) (portfolioCycleResponse, error) {
	result := portfolioCycleResponse{Method: "opening_basket_adjusted_price_return", Classes: []cycleClassReturn{}, Securities: []cycleSecurityReturn{}}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	var cycle portfolioCycle
	var approved, created sql.NullTime
	err = tx.QueryRowContext(ctx, `SELECT id, approved_at, created_at FROM portfolio_mix_snapshots
		WHERE status IN ('APPROVED', 'SUPERSEDED') AND (? = 0 OR id = ?)
		ORDER BY datetime(COALESCE(approved_at, created_at)) DESC, id DESC LIMIT 1`, snapshotID, snapshotID).Scan(&cycle.SnapshotID, &approved, &created)
	if err == sql.ErrNoRows {
		if snapshotID != 0 {
			return result, errCycleNotFound
		}
		result.Reason = "No approved portfolio shape."
		return result, nil
	}
	if err != nil {
		return result, err
	}
	if !approved.Valid {
		approved = created
	}
	if !approved.Valid || approved.Time.After(now) {
		return result, fmt.Errorf("invalid approval date")
	}
	cycle.StartedAt, cycle.EndedAt = approved.Time.UTC(), now.UTC()
	var nextApproved, nextCreated sql.NullTime
	err = tx.QueryRowContext(ctx, `SELECT approved_at, created_at FROM portfolio_mix_snapshots
		WHERE status IN ('APPROVED', 'SUPERSEDED') AND
		(datetime(COALESCE(approved_at, created_at)) > datetime(?) OR (datetime(COALESCE(approved_at, created_at)) = datetime(?) AND id > ?))
		ORDER BY datetime(COALESCE(approved_at, created_at)), id LIMIT 1`, cycle.StartedAt, cycle.StartedAt, cycle.SnapshotID).Scan(&nextApproved, &nextCreated)
	if err != nil && err != sql.ErrNoRows {
		return result, err
	}
	if err == nil {
		if !nextApproved.Valid {
			nextApproved = nextCreated
		}
		if nextApproved.Valid && !nextApproved.Time.After(now) {
			cycle.EndedAt, cycle.Closed = nextApproved.Time.UTC(), true
		}
	}
	result.Cycle = &cycle
	rows, err := tx.QueryContext(ctx, `SELECT asset_class FROM portfolio_mix_snapshot_rows WHERE snapshot_id = ? ORDER BY display_order, asset_class`, cycle.SnapshotID)
	if err != nil {
		return result, err
	}
	seen := map[string]bool{}
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			rows.Close()
			return result, err
		}
		code = normalizePrimaryAssetClass(code)
		if !seen[code] {
			result.Classes = append(result.Classes, cycleClassReturn{AssetClass: code})
			seen[code] = true
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, err
	}
	var statementID int64
	var baseline time.Time
	err = tx.QueryRowContext(ctx, `SELECT statement_id, observed_at FROM portfolio_daily_snapshots
		WHERE source = 'STATEMENT' AND datetime(observed_at) <= datetime(?) AND datetime(observed_at) >= datetime(?)
		ORDER BY datetime(observed_at) DESC, statement_id DESC LIMIT 1`, cycle.StartedAt, cycle.StartedAt.AddDate(0, 0, -cycleEvidenceDays)).Scan(&statementID, &baseline)
	if err == sql.ErrNoRows {
		result.Reason = "No broker statement within seven days before this approval."
		for i := range result.Classes {
			result.Classes[i].Reason = result.Reason
		}
		return result, nil
	}
	if err != nil {
		return result, err
	}
	result.BaselineAt = &baseline
	rows, err = tx.QueryContext(ctx, `SELECT COALESCE(ticker, ''), COALESCE(exchange_prefix, ''), name, asset_class, market_value_aud
		FROM security_position_snapshots WHERE statement_id = ? AND source = 'STATEMENT' AND quantity > 0 AND market_value_aud > 0
		ORDER BY name, id`, statementID)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var security cycleSecurityReturn
		if err := rows.Scan(&security.Ticker, &security.Exchange, &security.Name, &security.AssetClass, &security.OpeningValue); err != nil {
			rows.Close()
			return result, err
		}
		security.AssetClass = normalizePrimaryAssetClass(security.AssetClass)
		result.Securities = append(result.Securities, security)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, err
	}
	opening, err := loadCyclePrices(ctx, tx, cycle.StartedAt)
	if err != nil {
		return result, err
	}
	closing, err := loadCyclePrices(ctx, tx, cycle.EndedAt)
	if err != nil {
		return result, err
	}
	calculateCycleReturns(&result, opening, closing)
	return result, nil
}

func getPortfolioCyclePerformance(w http.ResponseWriter, r *http.Request) {
	var id int64
	if raw := r.URL.Query().Get("snapshot_id"); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed <= 0 {
			http.Error(w, "snapshot_id must be a positive approval ID", http.StatusBadRequest)
			return
		}
		id = parsed
	}
	result, err := loadPortfolioCycle(r.Context(), id, time.Now().UTC())
	if errors.Is(err, errCycleNotFound) {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "Cycle performance could not be loaded", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(result)
}
