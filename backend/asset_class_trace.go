package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gorilla/mux"
)

// Asset-class trace.
//
// When two surfaces disagree about a security's class, the cause is one of
// several layers and they are not distinguishable from the outside: duplicate
// analysis rows, a group implying something else, or read-time re-resolution
// moving the stored value. This walks every layer for one ticker and reports
// what each one says, so the answer comes from the running system instead of
// from reasoning about the code.
//
// GET /api/asset-classes/trace/{ticker}

type assetClassTraceRow struct {
	ID                int    `json:"id"`
	Ticker            string `json:"ticker"`
	Name              string `json:"name"`
	SecurityType      string `json:"security_type"`
	StoredClass       string `json:"stored_class"`
	StoredSource      string `json:"stored_source"`
	StoredSetAt       string `json:"stored_set_at"`
	UpdatedAt         string `json:"updated_at"`
	NormalizedClass   string `json:"normalized_class"`
	ReResolvedClass   string `json:"re_resolved_class"`
	ReResolvedOK      bool   `json:"re_resolved_ok"`
	ResolutionChanged bool   `json:"resolution_changed"`
	GroupClass        string `json:"group_class"`
	GroupDisagrees    bool   `json:"group_disagrees"`
	// MatchedBy: "ticker" if this row was found by ticker (how the ETF ledger
	// joins), "name" if only by company name (how the statement/positions paths
	// join). A row matched only by name is invisible to the ledger and vice versa.
	MatchedBy string `json:"matched_by"`
}

type assetClassTraceClass struct {
	Code              string `json:"code"`
	AssetClassCode    string `json:"asset_class_code"`
	DisplayName       string `json:"display_name"`
	ParentCode        string `json:"parent_code"`
	ClassType         string `json:"class_type"`
	AllowGrouping     bool   `json:"allow_grouping"`
	AllowTargetWeight bool   `json:"allow_target_weight"`
	DisplayOrder      int    `json:"display_order"`
	Active            bool   `json:"active"`
}

type assetClassShapeRow struct {
	AssetClass  string  `json:"asset_class"`
	DisplayName string  `json:"display_name"`
	WeightPct   float64 `json:"weight_pct"`
}

type assetClassTraceGroup struct {
	GroupID        string `json:"group_id"`
	GroupName      string `json:"group_name"`
	AssetClassCode string `json:"asset_class_code"`
	ParentID       string `json:"parent_id"`
	ResolvedClass  string `json:"resolved_class"`
	Resolves       bool   `json:"resolves"`
}

type AssetClassTrace struct {
	Ticker string `json:"ticker"`
	// AnalysisRows is every stock_analysis row matching the ticker. More than
	// one is itself a finding: different surfaces may pick different rows.
	AnalysisRows []assetClassTraceRow `json:"analysis_rows"`
	// LedgerPick is the row the ETF monitor would use, chosen exactly the way
	// loadETFAssetClassMappings chooses it.
	LedgerPick         *assetClassTraceRow    `json:"ledger_pick"`
	LedgerClass        string                 `json:"ledger_class"`
	LedgerUnassignable bool                   `json:"ledger_unassignable"`
	RelatedClasses     []assetClassTraceClass `json:"related_classes"`
	ApprovedShapeClass string                 `json:"approved_shape_class"`
	ApprovedShapePct   float64                `json:"approved_shape_weight_pct"`
	ClassTargetExists  bool                   `json:"class_target_exists"`
	CorePolicyTicker   string                 `json:"core_policy_ticker"`
	CorePolicyExists   bool                   `json:"core_policy_exists"`
	// ParentShapeClass/Pct: if the class itself carries no shape weight, does its
	// PARENT? A shape written at parent granularity and a class assigned at child
	// granularity produce a $0 target with nothing obviously wrong on either side.
	ParentShapeClass string  `json:"parent_shape_class"`
	ParentShapePct   float64 `json:"parent_shape_weight_pct"`
	// ApprovedShapeRows is every class the approved shape carries a weight on, so
	// it is visible where the weights actually sit.
	ApprovedShapeRows []assetClassShapeRow `json:"approved_shape_rows"`
	// RawGroup is the security's stock group as stored, reported even when its
	// asset_class_code does not resolve — an unresolvable group still supplies a
	// NAME that other surfaces may be displaying.
	RawGroup *assetClassTraceGroup `json:"raw_group"`
	// NameJoinPick is the row a name-joined surface would read. Several queries
	// do `WHERE LOWER(TRIM(sa.name)) = LOWER(TRIM(sh.details)) LIMIT 1` with no
	// ORDER BY, so when more than one row shares a name the choice is arbitrary
	// and can differ from the ledger's ticker-joined pick.
	NameJoinPick  *assetClassTraceRow `json:"name_join_pick"`
	NameJoinClass string              `json:"name_join_class"`
	Findings      []string            `json:"findings"`
}

func buildAssetClassTrace(rawTicker string) (AssetClassTrace, error) {
	key := canonicalSecurityTickerKey(rawTicker)
	trace := AssetClassTrace{Ticker: key, Findings: []string{}}
	if key == "" {
		return trace, nil
	}

	groupDerived := loadGroupDerivedAssetClasses(context.Background())
	sleeves := loadAssetClasses()

	rows, err := db.Query(`
		SELECT id, COALESCE(ticker, ''), COALESCE(name, ''), COALESCE(security_type, ''),
		       COALESCE(primary_asset_class, ''), COALESCE(asset_class_source, ''),
		       COALESCE(CAST(asset_class_set_at AS TEXT), ''), COALESCE(CAST(updated_at AS TEXT), '')
		FROM stock_analysis
		ORDER BY
			CASE WHEN TRIM(COALESCE(primary_asset_class, '')) = '' THEN 1 ELSE 0 END,
			updated_at DESC,
			id DESC
	`)
	if err != nil {
		return trace, err
	}
	defer rows.Close()

	for rows.Next() {
		var row assetClassTraceRow
		if err := rows.Scan(&row.ID, &row.Ticker, &row.Name, &row.SecurityType,
			&row.StoredClass, &row.StoredSource, &row.StoredSetAt, &row.UpdatedAt); err != nil {
			return trace, err
		}
		if canonicalSecurityTickerKey(row.Ticker) != key {
			continue
		}

		row.NormalizedClass = normalizePrimaryAssetClass(row.StoredClass)
		if row.NormalizedClass != "" {
			resolved, ok := resolvePortfolioAssignmentClassFromAssetClasses(row.NormalizedClass, sleeves)
			row.ReResolvedClass = resolved
			row.ReResolvedOK = ok
			row.ResolutionChanged = ok && resolved != "" && resolved != row.NormalizedClass
		}

		row.GroupClass = groupDerived[strings.TrimSpace(row.Name)]
		if row.GroupClass == "" {
			row.GroupClass = groupDerived[canonicalCompanyNameKey(row.Name)]
		}
		row.GroupDisagrees = row.GroupClass != "" && row.NormalizedClass != "" && row.GroupClass != row.NormalizedClass

		row.MatchedBy = "ticker"
		trace.AnalysisRows = append(trace.AnalysisRows, row)
	}
	if err := rows.Err(); err != nil {
		return trace, err
	}

	// Now the other join. Statement and position paths look the analysis row up
	// by company name, not by ticker, so a second row sharing the name — with a
	// different ticker, or none — is what those surfaces read instead.
	seenID := map[int]bool{}
	names := map[string]bool{}
	for _, row := range trace.AnalysisRows {
		seenID[row.ID] = true
		if trimmed := strings.ToLower(strings.TrimSpace(row.Name)); trimmed != "" {
			names[trimmed] = true
		}
	}
	for name := range names {
		nameRows, err := db.Query(`
			SELECT id, COALESCE(ticker, ''), COALESCE(name, ''), COALESCE(security_type, ''),
			       COALESCE(primary_asset_class, ''), COALESCE(asset_class_source, ''),
			       COALESCE(CAST(asset_class_set_at AS TEXT), ''), COALESCE(CAST(updated_at AS TEXT), '')
			FROM stock_analysis
			WHERE LOWER(TRIM(name)) = ?
			ORDER BY id
		`, name)
		if err != nil {
			return trace, err
		}
		for nameRows.Next() {
			var row assetClassTraceRow
			if err := nameRows.Scan(&row.ID, &row.Ticker, &row.Name, &row.SecurityType,
				&row.StoredClass, &row.StoredSource, &row.StoredSetAt, &row.UpdatedAt); err != nil {
				nameRows.Close()
				return trace, err
			}
			row.NormalizedClass = normalizePrimaryAssetClass(row.StoredClass)
			if row.NormalizedClass != "" {
				resolved, ok := resolvePortfolioAssignmentClassFromAssetClasses(row.NormalizedClass, sleeves)
				row.ReResolvedClass = resolved
				row.ReResolvedOK = ok
				row.ResolutionChanged = ok && resolved != "" && resolved != row.NormalizedClass
			}
			// The name join takes the first row it sees, so the first row here is
			// what those surfaces would read.
			if trace.NameJoinPick == nil {
				pick := row
				pick.MatchedBy = "name"
				trace.NameJoinPick = &pick
				trace.NameJoinClass = row.NormalizedClass
			}
			if seenID[row.ID] {
				continue
			}
			seenID[row.ID] = true
			row.MatchedBy = "name"
			trace.AnalysisRows = append(trace.AnalysisRows, row)
		}
		nameRows.Close()
	}

	if len(trace.AnalysisRows) == 0 {
		trace.Findings = append(trace.Findings, "No stock_analysis row matches this ticker.")
		return trace, nil
	}

	// The ETF monitor takes the first row in this ordering, which is what
	// loadETFAssetClassMappings does after deduplicating by ticker.
	pick := trace.AnalysisRows[0]
	trace.LedgerPick = &pick
	trace.LedgerClass = pick.NormalizedClass
	if pick.ReResolvedOK && pick.ReResolvedClass != "" {
		trace.LedgerClass = pick.ReResolvedClass
	} else if pick.NormalizedClass != "" {
		trace.LedgerUnassignable = true
	}

	if len(trace.AnalysisRows) > 1 {
		distinct := map[string]bool{}
		for _, row := range trace.AnalysisRows {
			distinct[row.NormalizedClass] = true
		}
		if len(distinct) > 1 {
			trace.Findings = append(trace.Findings,
				"DUPLICATE ROWS WITH DIFFERENT CLASSES: this ticker has more than one stock_analysis row and they disagree. Surfaces that pick a different row will show a different class.")
		} else {
			trace.Findings = append(trace.Findings,
				"This ticker has more than one stock_analysis row, though they agree on the class.")
		}
	}
	if pick.ResolutionChanged {
		trace.Findings = append(trace.Findings,
			"READ-TIME RE-RESOLUTION MOVED THE CLASS: stored "+pick.NormalizedClass+
				" resolves to "+pick.ReResolvedClass+". Surfaces showing the stored value and surfaces re-resolving it will disagree.")
	}
	if trace.LedgerUnassignable {
		trace.Findings = append(trace.Findings,
			"STORED CLASS IS NOT ASSIGNABLE: "+pick.NormalizedClass+
				" is not an active, groupable sleeve, so no class target can be computed for it.")
	}
	if trace.NameJoinClass != "" && trace.NameJoinClass != pick.NormalizedClass {
		trace.Findings = append(trace.Findings,
			"TICKER JOIN AND NAME JOIN READ DIFFERENT ROWS: the ETF ledger joins stock_analysis by ticker and reads "+
				pick.NormalizedClass+"; statement and position paths join by company name and read "+
				trace.NameJoinClass+". Both are 'correct' for their own query.")
	}
	if pick.GroupDisagrees {
		trace.Findings = append(trace.Findings,
			"GROUP DISAGREES: the security's stock group implies "+pick.GroupClass+
				" but the stored class is "+pick.NormalizedClass+".")
	}

	// Every registry class that could be involved: the one it resolves to, and
	// anything sharing its parent, since that is what the fallback chooses from.
	relevant := map[string]bool{pick.NormalizedClass: true, trace.LedgerClass: true, pick.GroupClass: true}
	parents := map[string]bool{}
	for _, sleeve := range sleeves {
		if relevant[normalizePrimaryAssetClass(sleeve.Code)] {
			parents[normalizePrimaryAssetClass(sleeve.ParentCode)] = true
		}
	}
	for _, sleeve := range sleeves {
		code := normalizePrimaryAssetClass(sleeve.Code)
		parent := normalizePrimaryAssetClass(sleeve.ParentCode)
		if !relevant[code] && !parents[code] && !relevant[parent] {
			continue
		}
		trace.RelatedClasses = append(trace.RelatedClasses, assetClassTraceClass{
			Code:              sleeve.Code,
			AssetClassCode:    sleeve.AssetClassCode,
			DisplayName:       sleeve.DisplayName,
			ParentCode:        sleeve.ParentCode,
			ClassType:         sleeve.ClassType,
			AllowGrouping:     sleeve.AllowGrouping,
			AllowTargetWeight: sleeve.AllowTargetWeight,
			DisplayOrder:      sleeve.DisplayOrder,
			Active:            sleeve.Active,
		})
	}

	// Does the approved shape actually carry a weight on the class the ledger
	// landed on? This is the difference between "no target" and "wrong key".
	if trace.LedgerClass != "" {
		var weight float64
		err := db.QueryRow(`
			SELECT COALESCE(SUM(weight_pct), 0)
			FROM portfolio_mix_snapshot_rows
			WHERE snapshot_id = (
				SELECT id FROM portfolio_mix_snapshots WHERE status = 'APPROVED' ORDER BY id DESC LIMIT 1
			) AND UPPER(TRIM(asset_class)) = ?
		`, trace.LedgerClass).Scan(&weight)
		if err == nil {
			trace.ApprovedShapeClass = trace.LedgerClass
			trace.ApprovedShapePct = weight
			trace.ClassTargetExists = weight > 0
			if weight <= 0 {
				trace.Findings = append(trace.Findings,
					"NO SHAPE WEIGHT ON "+trace.LedgerClass+": the approved portfolio shape carries no weight for the class the ledger resolved to, so the class target is $0 and every fund under it has no target.")

				// Is the weight sitting on the parent instead? That is a shape
				// written at one granularity and a class assigned at another,
				// with nothing bridging them.
				parentCode := ""
				for _, sleeve := range sleeves {
					if normalizePrimaryAssetClass(sleeve.Code) == trace.LedgerClass {
						parentCode = normalizePrimaryAssetClass(sleeve.ParentCode)
					}
				}
				if parentCode != "" {
					var parentWeight float64
					if err := db.QueryRow(`
						SELECT COALESCE(SUM(weight_pct), 0)
						FROM portfolio_mix_snapshot_rows
						WHERE snapshot_id = (
							SELECT id FROM portfolio_mix_snapshots WHERE status = 'APPROVED' ORDER BY id DESC LIMIT 1
						) AND UPPER(TRIM(asset_class)) = ?
					`, parentCode).Scan(&parentWeight); err == nil {
						trace.ParentShapeClass = parentCode
						trace.ParentShapePct = parentWeight
						if parentWeight > 0 {
							trace.Findings = append(trace.Findings,
								"THE WEIGHT IS ON THE PARENT: the shape carries "+
									formatPct(parentWeight)+" on "+parentCode+", the parent of "+
									trace.LedgerClass+". A shape written at parent granularity does not reach a fund classed to a child — class targets are keyed on the exact class code.")
						}
					}
				}
			}
		}

		shapeRows, shapeErr := db.Query(`
			SELECT asset_class, COALESCE(display_name, ''), weight_pct
			FROM portfolio_mix_snapshot_rows
			WHERE snapshot_id = (
				SELECT id FROM portfolio_mix_snapshots WHERE status = 'APPROVED' ORDER BY id DESC LIMIT 1
			) AND weight_pct > 0
			ORDER BY weight_pct DESC
		`)
		if shapeErr == nil {
			for shapeRows.Next() {
				var row assetClassShapeRow
				if err := shapeRows.Scan(&row.AssetClass, &row.DisplayName, &row.WeightPct); err == nil {
					trace.ApprovedShapeRows = append(trace.ApprovedShapeRows, row)
				}
			}
			shapeRows.Close()
		}

		var coreTicker string
		if err := db.QueryRow(`SELECT COALESCE(core_ticker, '') FROM asset_class_etf_policies WHERE asset_class = ?`,
			trace.LedgerClass).Scan(&coreTicker); err == nil {
			trace.CorePolicyExists = true
			trace.CorePolicyTicker = coreTicker
		} else {
			trace.Findings = append(trace.Findings,
				"NO CORE POLICY FOR "+trace.LedgerClass+": no fund is selected as Core for this class, so no effective target is computed for any fund in it.")
		}
	}

	var group assetClassTraceGroup
	if err := db.QueryRow(`
		SELECT COALESCE(groups.id, ''), COALESCE(groups.name, ''),
		       COALESCE(groups.asset_class_code, ''), COALESCE(groups.parent_id, '')
		FROM stock_group_assignments assignments
		JOIN stock_groups groups ON groups.id = assignments.group_id
		WHERE LOWER(TRIM(assignments.company_name)) = LOWER(TRIM(?))
		LIMIT 1
	`, pick.Name).Scan(&group.GroupID, &group.GroupName, &group.AssetClassCode, &group.ParentID); err == nil {
		group.ResolvedClass, group.Resolves = resolvePortfolioGroupingAssetClassCodeFromAssetClasses(group.AssetClassCode, sleeves)
		trace.RawGroup = &group
		if !group.Resolves {
			trace.Findings = append(trace.Findings,
				"GROUP DOES NOT RESOLVE: the security sits in group \""+group.GroupName+
					"\" whose asset_class_code ("+group.AssetClassCode+
					") is not an assignable sleeve. Surfaces that display the GROUP NAME will show \""+
					group.GroupName+"\" while surfaces showing the stored class show \""+pick.NormalizedClass+"\".")
		}
	}

	if len(trace.Findings) == 0 {
		trace.Findings = append(trace.Findings, "No divergence found for this ticker.")
	}
	return trace, nil
}

func formatPct(value float64) string {
	return strconv.FormatFloat(value, 'f', 2, 64) + "%"
}

func getAssetClassTrace(w http.ResponseWriter, r *http.Request) {
	trace, err := buildAssetClassTrace(mux.Vars(r)["ticker"])
	if err != nil {
		log.Printf("[ASSET CLASS] Failed to trace %s: %v", mux.Vars(r)["ticker"], err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	encoder := json.NewEncoder(w)
	encoder.SetIndent("", "  ")
	encoder.Encode(trace)
}
