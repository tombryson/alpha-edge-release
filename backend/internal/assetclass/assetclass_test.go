package assetclass

import "testing"

func TestNormalize(t *testing.T) {
	tests := map[string]string{
		"":                                "UNASSIGNED",
		"Gold Miners":                     "GOLD_MINERS",
		"GOLD_MINERS":                     "GOLD_MINERS",
		"gold-miner":                      "GOLD_MINERS",
		"Physical Gold ETF":               "PHYSICAL_GOLD",
		"Silver ETF":                      "PHYSICAL_SILVER",
		"Copper Miner":                    "COPPER_MINERS",
		"Base Metals Miners":              "BASE_METALS_MINERS",
		"Lithium Miner":                   "LITHIUM_MINERS",
		"Uranium Miner":                   "URANIUM_MINERS",
		"Iron Ore Miner":                  "IRON_ORE_MINERS",
		"Diversified Miner":               "DIVERSIFIED_MINERS",
		"Chemicals & Materials":           "MATERIALS_CHEMICALS",
		"Steel & Base Metals Processing":  "STEEL_METALS_PROCESSING",
		"Mining Services":                 "MINING_SERVICES",
		"Pharma & Biotech":                "PHARMA_BIOTECH",
		"fixed income":                    "BONDS",
		"Cash/Reserve":                    "CASH",
		"Rare Earths":                     "REE",
		"Rare Earths & Critical Minerals": "RARE_EARTHS_CRITICAL_MINERALS",
		"Consumer Staples":                "CONSUMER_STAPLES",
		"Consumer Retail":                 "CONSUMER_DISCRETIONARY",
		"Gaming":                          "GAMING",
		"Media & Publishing":              "MEDIA_PUBLISHING",
		"Technology Platforms":            "TECHNOLOGY_PLATFORMS",
		"Software SaaS":                   "SOFTWARE_SAAS",
		"Crypto Digital Assets":           "CRYPTO_DIGITAL_ASSETS",
		"Data Centers":                    "DATACENTRES",
		"Transport & Logistics":           "TRANSPORT_LOGISTICS",
		"Civil Aerospace":                 "CIVIL_AEROSPACE",
		"Real Estate / REIT":              "REAL_ESTATE_REIT",
		"Agriculture & Agribusiness":      "AGRICULTURE_AGRIBUSINESS",
		"not a known bucket":              "NOT A KNOWN BUCKET",
	}

	for input, want := range tests {
		if got := Normalize(input); got != want {
			t.Fatalf("Normalize(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestResolveGroupingClassCodeAcceptsCompactCustomCode(t *testing.T) {
	classes := []Class{
		{
			Code:           "CUSTOM_CUSTOM3",
			AssetClassCode: "CUSTOM_CUSTOM3",
			DisplayName:    "Custom3",
			ClassType:      "CUSTOM",
			AllowGrouping:  true,
			Active:         true,
		},
	}

	resolved, ok := ResolveGroupingClassCode("CUSTOMCUSTOM3", classes)
	if !ok || resolved != "CUSTOM_CUSTOM3" {
		t.Fatalf("resolved = %q/%v, want CUSTOM_CUSTOM3/true", resolved, ok)
	}
}

func TestResolveAssignmentClassUsesCanonicalPortfolioSleeve(t *testing.T) {
	classes := []Class{
		{Code: "UNASSIGNED", AssetClassCode: "UNASSIGNED", DisplayName: "Unassigned", ClassType: "SYSTEM_BUCKET", AllowTargetWeight: true, Active: true},
		{Code: "BROAD_EQUITY", AssetClassCode: "BROAD_EQUITY", DisplayName: "Broad Equity", AllowGrouping: true, AllowTargetWeight: true, Active: true},
		{Code: "BANKS", AssetClassCode: "BANKS", DisplayName: "Banks", ParentCode: "FINANCIALS", AllowGrouping: true, AllowTargetWeight: true, Active: true},
		{Code: "GOLD_MINERS", AssetClassCode: "GOLD", DisplayName: "Gold Miners", ParentCode: "GOLD", AllowGrouping: true, AllowTargetWeight: true, Active: true},
		{Code: "PHARMA_BIOTECH", AssetClassCode: "PHARMA_BIOTECH", DisplayName: "Pharma & Biotech", ParentCode: "PHARMA", AllowGrouping: true, AllowTargetWeight: true, Active: true},
		{Code: "MINING_SERVICES", AssetClassCode: "MINING_SERVICES", DisplayName: "Mining Services", ParentCode: "MATERIALS", AllowGrouping: true, AllowTargetWeight: true, Active: true},
		{Code: "BONDS", AssetClassCode: "BONDS", DisplayName: "Bonds", AllowGrouping: true, AllowTargetWeight: true, Active: true},
		{Code: "GAMING_GAMBLING", AssetClassCode: "GAMING_GAMBLING", DisplayName: "Gaming & Gambling", AllowGrouping: true, AllowTargetWeight: true, Active: true},
	}

	tests := map[string]string{
		"GOLD":             "GOLD_MINERS",
		"Gold Miners":      "GOLD_MINERS",
		"GOLD_MINERS":      "GOLD_MINERS",
		"PHARMA":           "PHARMA_BIOTECH",
		"Pharma & Biotech": "PHARMA_BIOTECH",
		"Mining Services":  "MINING_SERVICES",
		"EQUITY":           "BROAD_EQUITY",
		"FIXED_INCOME":     "BONDS",
		"FINANCIALS":       "BANKS",
		"GAMING":           "GAMING_GAMBLING",
	}

	for input, want := range tests {
		got, ok := ResolveAssignmentClass(input, classes)
		if !ok {
			t.Fatalf("ResolveAssignmentClass(%q) rejected, want %q", input, want)
		}
		if got != want {
			t.Fatalf("ResolveAssignmentClass(%q) = %q, want %q", input, got, want)
		}
	}

	for _, input := range []string{"", "UNASSIGNED", "MISC", "CASH"} {
		got, ok := ResolveAssignmentClass(input, classes)
		if !ok || got != "" {
			t.Fatalf("ResolveAssignmentClass(%q) = %q/%v, want empty/true", input, got, ok)
		}
	}
}

func TestResolveGroupingClassCodeRejectsSystemBuckets(t *testing.T) {
	classes := []Class{
		{Code: "CASH", AssetClassCode: "CASH", DisplayName: "Cash/Reserve", ClassType: "SYSTEM_BUCKET", AllowGrouping: false, AllowTargetWeight: true, Active: true},
		{Code: "GOLD_MINERS", AssetClassCode: "GOLD", DisplayName: "Gold Miners", ParentCode: "GOLD", AllowGrouping: true, AllowTargetWeight: true, Active: true},
		{Code: "WATCH_ONLY", AssetClassCode: "WATCH_ONLY", DisplayName: "Watch Only", AllowGrouping: false, AllowTargetWeight: false, Active: true},
		{Code: "INACTIVE_CLASS", AssetClassCode: "INACTIVE", DisplayName: "Inactive", AllowGrouping: true, AllowTargetWeight: true, Active: false},
	}

	for _, input := range []string{"", "UNASSIGNED", "MISC", "CASH", "WATCH_ONLY", "INACTIVE"} {
		if got, ok := ResolveGroupingClassCode(input, classes); ok {
			t.Fatalf("ResolveGroupingClassCode(%q) = %q/true, want rejection", input, got)
		}
	}
	got, ok := ResolveGroupingClassCode("GOLD", classes)
	if !ok || got != "GOLD_MINERS" {
		t.Fatalf("ResolveGroupingClassCode(GOLD) = %q/%v, want GOLD_MINERS/true", got, ok)
	}
}

func TestResolveAssignmentClassRejectsUnknownWhenNoUnassignedFallback(t *testing.T) {
	classes := []Class{
		{Code: "GOLD_MINERS", AssetClassCode: "GOLD", DisplayName: "Gold Miners", ParentCode: "GOLD", AllowGrouping: true, AllowTargetWeight: true, Active: true},
	}

	if got, ok := ResolveAssignmentClass("NOT_A_REAL_CLASS", classes); ok {
		t.Fatalf("ResolveAssignmentClass resolved unknown class to %q", got)
	}
}

func TestResolveClassForCodeCanFallbackToUnassigned(t *testing.T) {
	classes := []Class{
		{Code: "UNASSIGNED", AssetClassCode: "UNASSIGNED", DisplayName: "Unassigned", ClassType: "SYSTEM_BUCKET", AllowTargetWeight: true, Active: true},
		{Code: "GOLD_MINERS", AssetClassCode: "GOLD", DisplayName: "Gold Miners", ParentCode: "GOLD", AllowGrouping: true, AllowTargetWeight: true, Active: true},
	}

	got, ok := ResolveClassForCode("NOT_A_REAL_CLASS", classes, true)
	if !ok {
		t.Fatalf("ResolveClassForCode rejected unknown class, want UNASSIGNED fallback")
	}
	if got.Code != "UNASSIGNED" {
		t.Fatalf("ResolveClassForCode fallback = %q, want UNASSIGNED", got.Code)
	}
}

func TestResolveClassForCodeHonoursTargetWeightRequirement(t *testing.T) {
	classes := []Class{
		{Code: "UNASSIGNED", AssetClassCode: "UNASSIGNED", DisplayName: "Unassigned", ClassType: "SYSTEM_BUCKET", AllowTargetWeight: true, Active: true},
		{Code: "BANKS", AssetClassCode: "BANKS", DisplayName: "Banks", ParentCode: "FINANCIALS", AllowGrouping: true, AllowTargetWeight: true, Active: true},
		{Code: "WATCH_ONLY", AssetClassCode: "WATCH_ONLY", DisplayName: "Watch Only", AllowGrouping: true, AllowTargetWeight: false, Active: true},
	}

	got, ok := ResolveClassForCode("FINANCIALS", classes, true)
	if !ok || got.Code != "BANKS" {
		t.Fatalf("ResolveClassForCode parent code = %q/%v, want BANKS/true", got.Code, ok)
	}

	got, ok = ResolveClassForCode("WATCH_ONLY", classes, false)
	if !ok || got.Code != "WATCH_ONLY" {
		t.Fatalf("ResolveClassForCode without target requirement = %q/%v, want WATCH_ONLY/true", got.Code, ok)
	}
	got, ok = ResolveClassForCode("WATCH_ONLY", classes, true)
	if !ok || got.Code != "UNASSIGNED" {
		t.Fatalf("ResolveClassForCode with target requirement = %q/%v, want UNASSIGNED/true", got.Code, ok)
	}
}

func TestDisplayNameAndCompactKey(t *testing.T) {
	if got := DisplayName("PHARMA_BIOTECH"); got != "Pharma Biotech" {
		t.Fatalf("DisplayName = %q, want Pharma Biotech", got)
	}
	if got := DisplayName("UNASSIGNED"); got != "" {
		t.Fatalf("DisplayName(UNASSIGNED) = %q, want empty", got)
	}
	if got := CompactKey("Pharma & Biotech"); got != "PHARMABIOTECH" {
		t.Fatalf("CompactKey = %q, want PHARMABIOTECH", got)
	}
}
