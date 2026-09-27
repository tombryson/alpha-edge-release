package main

import (
	"testing"
)

func seedAnalysisWithClass(t *testing.T, name, ticker, class, source string) int {
	t.Helper()
	result, err := db.Exec(`
		INSERT INTO stock_analysis (ticker, name, primary_asset_class, security_type, asset_class_source)
		VALUES (?, ?, ?, 'STOCK', NULLIF(?, ''))
	`, ticker, name, class, source)
	if err != nil {
		t.Fatalf("seed analysis %s: %v", name, err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		t.Fatalf("read analysis id: %v", err)
	}
	return int(id)
}

// seedGroupWithClass puts a security in a group that implies a class, which is
// the second, independent assignment surface.
func seedGroupWithClass(t *testing.T, groupID, companyName, assetClassCode string) {
	t.Helper()
	if _, err := db.Exec(`
		INSERT INTO stock_groups (id, name, asset_class_code, display_order)
		VALUES (?, ?, ?, 1)
		ON CONFLICT(id) DO UPDATE SET asset_class_code = excluded.asset_class_code
	`, groupID, groupID+" group", assetClassCode); err != nil {
		t.Fatalf("seed group %s: %v", groupID, err)
	}
	if _, err := db.Exec(`
		INSERT INTO stock_group_assignments (company_name, group_id)
		VALUES (?, ?)
		ON CONFLICT(company_name) DO UPDATE SET group_id = excluded.group_id
	`, companyName, groupID); err != nil {
		t.Fatalf("seed group assignment %s: %v", companyName, err)
	}
}

func classOf(t *testing.T, id int) string {
	t.Helper()
	var class, source string
	if err := db.QueryRow(`
		SELECT COALESCE(primary_asset_class, ''), COALESCE(asset_class_source, '')
		FROM stock_analysis WHERE id = ?
	`, id).Scan(&class, &source); err != nil {
		t.Fatalf("read class for %d: %v", id, err)
	}
	return class
}

func TestAssetClassPrecedenceRanking(t *testing.T) {
	cases := []struct {
		incoming, existing string
		wins               bool
		why                string
	}{
		{AssetClassSourceGroup, AssetClassSourceManual, false, "a group must never overwrite a hand-set class"},
		{AssetClassSourceGroup, AssetClassSourceHeuristic, true, "a group beats a hardcoded guess"},
		{AssetClassSourceGroup, "", true, "a group beats an unattributed legacy value"},
		{AssetClassSourceManual, AssetClassSourceManual, true, "a later manual edit replaces an earlier one"},
		{AssetClassSourceManual, AssetClassSourceGroup, true, "a person overrules a group"},
		{AssetClassSourceLLMAuto, AssetClassSourceManual, false, "auto-assign must not overwrite a person"},
		{AssetClassSourceManual, AssetClassSourceLLMAuto, true, "a person overrules auto-assign"},
		{AssetClassSourceHeuristic, AssetClassSourceGroup, false, "a guess never beats a real assignment"},
	}
	for _, tc := range cases {
		if got := assetClassWriteWins(tc.incoming, tc.existing); got != tc.wins {
			t.Errorf("assetClassWriteWins(%q, %q) = %v, want %v — %s",
				tc.incoming, tc.existing, got, tc.wins, tc.why)
		}
	}
}

func TestUnknownAssetClassSourceIsNotStored(t *testing.T) {
	if got := normalizeAssetClassSource("something-else"); got != "" {
		t.Fatalf("normalizeAssetClassSource(%q) = %q, want empty", "something-else", got)
	}
	if got := normalizeAssetClassSource(" manual "); got != AssetClassSourceManual {
		t.Fatalf("normalizeAssetClassSource with padding = %q, want MANUAL", got)
	}
}

// The regression this whole change exists for: a class set by hand was silently
// reverted at the next deploy by a group membership set at some other time.
func TestBackfillDoesNotRevertAManualAssignment(t *testing.T) {
	cleanup := setupSecurityActionTestDB(t)
	defer cleanup()

	id := seedAnalysisWithClass(t, "Procure Space", "UFO", "TECHNOLOGY", AssetClassSourceManual)
	seedGroupWithClass(t, "grp-aero", "Procure Space", "CIVIL_AEROSPACE")

	backfillPrimaryAssetClasses()

	if got := classOf(t, id); got != "TECHNOLOGY" {
		t.Fatalf("manual class was overwritten by the group: got %q, want TECHNOLOGY", got)
	}
}

// A value nobody claimed is fair game for the group to settle.
func TestBackfillAppliesGroupClassOverAnUnattributedValue(t *testing.T) {
	cleanup := setupSecurityActionTestDB(t)
	defer cleanup()

	id := seedAnalysisWithClass(t, "Legacy Holding", "LGCY", "TECHNOLOGY", "")
	seedGroupWithClass(t, "grp-gold", "Legacy Holding", "GOLD_MINERS")

	backfillPrimaryAssetClasses()

	if got := classOf(t, id); got != "GOLD_MINERS" {
		t.Fatalf("group class was not applied to an unattributed row: got %q", got)
	}
}

// The conflict has to be visible, since the backfill no longer resolves it.
func TestManualGroupDisagreementIsReportedAsAConflict(t *testing.T) {
	cleanup := setupSecurityActionTestDB(t)
	defer cleanup()

	seedAnalysisWithClass(t, "Procure Space", "UFO", "TECHNOLOGY", AssetClassSourceManual)
	seedGroupWithClass(t, "grp-aero", "Procure Space", "CIVIL_AEROSPACE")

	backfillPrimaryAssetClasses()

	conflicts, err := loadAssetClassConflicts()
	if err != nil {
		t.Fatalf("load conflicts: %v", err)
	}
	found := false
	for _, conflict := range conflicts {
		if conflict.Ticker == "UFO" {
			found = true
			if conflict.StoredClass != "TECHNOLOGY" || conflict.GroupClass != "CIVIL_AEROSPACE" {
				t.Errorf("conflict reported the wrong pair: stored=%q group=%q",
					conflict.StoredClass, conflict.GroupClass)
			}
			if conflict.StoredSource != AssetClassSourceManual {
				t.Errorf("conflict lost the provenance: got %q", conflict.StoredSource)
			}
		}
	}
	if !found {
		t.Fatalf("a manual/group disagreement was not reported, got %+v", conflicts)
	}
}

// Agreement is not a conflict, and neither is having no group at all.
func TestNoConflictWhenGroupAgreesOrIsAbsent(t *testing.T) {
	cleanup := setupSecurityActionTestDB(t)
	defer cleanup()

	seedAnalysisWithClass(t, "Agrees Ltd", "AGR", "GOLD_MINERS", AssetClassSourceManual)
	seedGroupWithClass(t, "grp-gold", "Agrees Ltd", "GOLD_MINERS")
	seedAnalysisWithClass(t, "Ungrouped Ltd", "UNG", "GOLD_MINERS", AssetClassSourceManual)

	conflicts, err := loadAssetClassConflicts()
	if err != nil {
		t.Fatalf("load conflicts: %v", err)
	}
	for _, conflict := range conflicts {
		if conflict.Ticker == "AGR" || conflict.Ticker == "UNG" {
			t.Errorf("%s should not be a conflict: %+v", conflict.Ticker, conflict)
		}
	}
}
