package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"sort"
	"strings"
)

// Portfolio mandate.
//
// The approved portfolio shape is the mandate: a class draws capital if and only
// if the shape carries a weight on it. Classification is free and never blocked —
// researching something you do not yet fund is how a shape comes to be revised —
// but funding is closed. See DOCS/system/PORTFOLIO_MANDATE_MODEL.md.
//
// Separating "what a security is" from "what it is funded to be" gives four
// states, and none of them is an error:
//
//	FUNDED         class in mandate. Normal; has a target.
//	RESEARCHED     classed, not in mandate, not held. A candidate for the next
//	               shape review — the research funnel into policy.
//	OFF_MANDATE    classed, not in mandate, and HELD. Capital outside policy.
//	               The state a portfolio manager must never be blind to.
//	UNEXPRESSED    in mandate, nothing classed to it. A funded sleeve with
//	               nothing in it.
//
// Before this existed, states 2 and 3 both rendered as "no target", collapsing
// "something I might buy" and "something I already own that my policy does not
// sanction" into the same non-statement.
const (
	MandateStateFunded      = "FUNDED"
	MandateStateResearched  = "RESEARCHED_NOT_MANDATED"
	MandateStateOffMandate  = "OFF_MANDATE"
	MandateStateUnexpressed = "UNEXPRESSED"
)

type MandateClass struct {
	AssetClass  string  `json:"asset_class"`
	DisplayName string  `json:"display_name"`
	WeightPct   float64 `json:"weight_pct"`
	// HeldValue and SecurityCount describe what is actually classed into this
	// mandate class, which is what makes UNEXPRESSED visible.
	HeldValue     float64 `json:"held_value"`
	SecurityCount int     `json:"security_count"`
	Unexpressed   bool    `json:"unexpressed"`
}

type MandateSecurity struct {
	Ticker       string  `json:"ticker"`
	Name         string  `json:"name"`
	SecurityType string  `json:"security_type"`
	AssetClass   string  `json:"asset_class"`
	ClassName    string  `json:"asset_class_name"`
	ClassSource  string  `json:"asset_class_source"`
	HeldValue    float64 `json:"held_value"`
	State        string  `json:"state"`
}

type MandateReport struct {
	HasApprovedShape bool `json:"has_approved_shape"`
	// MandateClasses is the funded list: the authoritative answer to "what draws
	// capital".
	MandateClasses []MandateClass `json:"mandate_classes"`
	// OffMandate is the exception report — held, classed outside the mandate.
	OffMandate []MandateSecurity `json:"off_mandate"`
	// Researched is the shape review queue: classed, unfunded, unheld.
	Researched []MandateSecurity `json:"researched_not_mandated"`
	// Unexpressed lists funded classes with nothing classed into them.
	Unexpressed []MandateClass `json:"unexpressed_classes"`

	PortfolioValue float64 `json:"portfolio_value"`
	// OffMandateValue is the "of which off-mandate" figure. Off-mandate holdings
	// count toward actual exposure — they are real money — and are excluded only
	// from target maths, because their class has no target to contribute to. That
	// makes actual and target legitimately disagree by this amount, so the gap is
	// stated rather than left looking like a rounding error.
	OffMandateValue float64 `json:"off_mandate_value"`
	OffMandatePct   float64 `json:"off_mandate_pct"`

	Counts map[string]int `json:"counts"`
}

// loadMandateClasses returns the classes the approved shape funds, keyed by
// normalised class code. An empty map with ok=false means no approved shape,
// in which case nothing can be judged off-mandate and the whole report is
// inconclusive rather than alarming.
func loadMandateClasses() (map[string]MandateClass, bool, error) {
	var snapshotID int
	err := db.QueryRow(`
		SELECT id FROM portfolio_mix_snapshots
		WHERE status = 'APPROVED'
		ORDER BY id DESC LIMIT 1
	`).Scan(&snapshotID)
	if err == sql.ErrNoRows {
		return map[string]MandateClass{}, false, nil
	}
	if err != nil {
		return nil, false, err
	}

	rows, err := db.Query(`
		SELECT asset_class, COALESCE(display_name, ''), weight_pct
		FROM portfolio_mix_snapshot_rows
		WHERE snapshot_id = ? AND weight_pct > 0
	`, snapshotID)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()

	classes := map[string]MandateClass{}
	for rows.Next() {
		var row MandateClass
		if err := rows.Scan(&row.AssetClass, &row.DisplayName, &row.WeightPct); err != nil {
			return nil, false, err
		}
		code := normalizePrimaryAssetClass(row.AssetClass)
		if code == "" {
			continue
		}
		row.AssetClass = code
		if row.DisplayName == "" {
			row.DisplayName = code
		}
		// A class may appear more than once in a shape; the mandate cares about
		// the total weight on it.
		if existing, found := classes[code]; found {
			row.WeightPct += existing.WeightPct
		}
		classes[code] = row
	}
	return classes, len(classes) > 0, rows.Err()
}

// loadHeldValuesByName returns the latest statement's value per holding, keyed by
// the canonical company name. Name is the key because that is what the statement
// carries; tickers are resolved separately and are not always present.
func loadHeldValuesByName() (map[string]float64, error) {
	values := map[string]float64{}
	var statementID int
	err := db.QueryRow(`
		SELECT id FROM account_statements
		ORDER BY statement_date DESC, id DESC LIMIT 1
	`).Scan(&statementID)
	if err == sql.ErrNoRows {
		return values, nil
	}
	if err != nil {
		return nil, err
	}

	rows, err := db.Query(`
		SELECT COALESCE(details, ''), COALESCE(SUM(value_aud), 0)
		FROM statement_holdings
		WHERE statement_id = ?
		GROUP BY details
	`, statementID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var name string
		var value float64
		if err := rows.Scan(&name, &value); err != nil {
			return nil, err
		}
		if key := strings.ToLower(strings.TrimSpace(name)); key != "" {
			values[key] += value
		}
	}
	return values, rows.Err()
}

// buildMandateReport classifies every security into one of the four states. It
// reads only: the divergence between taxonomy and mandate is the product, not a
// fault to be corrected behind the user's back.
func buildMandateReport() (MandateReport, error) {
	report := MandateReport{
		MandateClasses: []MandateClass{},
		OffMandate:     []MandateSecurity{},
		Researched:     []MandateSecurity{},
		Unexpressed:    []MandateClass{},
		Counts:         map[string]int{},
	}

	mandate, hasShape, err := loadMandateClasses()
	if err != nil {
		return report, err
	}
	report.HasApprovedShape = hasShape

	heldByName, err := loadHeldValuesByName()
	if err != nil {
		return report, err
	}
	for _, value := range heldByName {
		report.PortfolioValue += value
	}

	// No approved shape means no mandate, and without a mandate nothing can be
	// judged against it. Reporting the whole book as off-mandate here would be
	// loud, alarming and wrong — the correct answer is that the question cannot
	// be asked yet.
	if !hasShape {
		return report, nil
	}

	displayNames := assetClassDisplayNameByCode()

	rows, err := db.Query(`
		SELECT COALESCE(ticker, ''), COALESCE(name, ''), COALESCE(security_type, ''),
		       COALESCE(primary_asset_class, ''), COALESCE(asset_class_source, '')
		FROM stock_analysis
		ORDER BY name
	`)
	if err != nil {
		return report, err
	}
	defer rows.Close()

	classHeld := map[string]float64{}
	classCount := map[string]int{}

	for rows.Next() {
		var security MandateSecurity
		if err := rows.Scan(&security.Ticker, &security.Name, &security.SecurityType,
			&security.AssetClass, &security.ClassSource); err != nil {
			return report, err
		}
		// A non-allocating instrument draws no capital by definition and is not a
		// mandate question.
		if isNonAllocatingSecurityType(security.SecurityType) {
			continue
		}
		security.AssetClass = normalizePrimaryAssetClass(security.AssetClass)
		if security.AssetClass == "" || security.AssetClass == "UNASSIGNED" {
			continue
		}
		security.ClassName = displayNames[security.AssetClass]
		if security.ClassName == "" {
			security.ClassName = security.AssetClass
		}
		security.HeldValue = heldByName[strings.ToLower(strings.TrimSpace(security.Name))]

		if _, inMandate := mandate[security.AssetClass]; inMandate {
			security.State = MandateStateFunded
			classHeld[security.AssetClass] += security.HeldValue
			classCount[security.AssetClass]++
			report.Counts[MandateStateFunded]++
			continue
		}

		// Outside the mandate. Held or not is what separates an exception from a
		// candidate, and they want completely different treatment.
		if security.HeldValue > 0 {
			security.State = MandateStateOffMandate
			report.OffMandate = append(report.OffMandate, security)
			report.OffMandateValue += security.HeldValue
			report.Counts[MandateStateOffMandate]++
			continue
		}
		security.State = MandateStateResearched
		report.Researched = append(report.Researched, security)
		report.Counts[MandateStateResearched]++
	}
	if err := rows.Err(); err != nil {
		return report, err
	}

	for code, class := range mandate {
		class.HeldValue = classHeld[code]
		class.SecurityCount = classCount[code]
		class.Unexpressed = classCount[code] == 0
		if class.DisplayName == code {
			if name := displayNames[code]; name != "" {
				class.DisplayName = name
			}
		}
		report.MandateClasses = append(report.MandateClasses, class)
		if class.Unexpressed {
			report.Unexpressed = append(report.Unexpressed, class)
			report.Counts[MandateStateUnexpressed]++
		}
	}

	if report.PortfolioValue > 0 {
		report.OffMandatePct = (report.OffMandateValue / report.PortfolioValue) * 100
	}

	sort.Slice(report.MandateClasses, func(i, j int) bool {
		return report.MandateClasses[i].WeightPct > report.MandateClasses[j].WeightPct
	})
	sort.Slice(report.Unexpressed, func(i, j int) bool {
		return report.Unexpressed[i].WeightPct > report.Unexpressed[j].WeightPct
	})
	// Biggest money first: the off-mandate report is read for size, not alphabet.
	sort.Slice(report.OffMandate, func(i, j int) bool {
		return report.OffMandate[i].HeldValue > report.OffMandate[j].HeldValue
	})
	sort.Slice(report.Researched, func(i, j int) bool {
		if report.Researched[i].AssetClass != report.Researched[j].AssetClass {
			return report.Researched[i].AssetClass < report.Researched[j].AssetClass
		}
		return report.Researched[i].Name < report.Researched[j].Name
	})

	return report, nil
}

func getPortfolioMandate(w http.ResponseWriter, r *http.Request) {
	report, err := buildMandateReport()
	if err != nil {
		log.Printf("[MANDATE] Failed to build mandate report: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(report)
}
