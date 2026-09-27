package assetclass

import (
	"strings"
	"unicode"
)

type Class struct {
	Code              string
	AssetClassCode    string
	DisplayName       string
	ClassType         string
	ParentCode        string
	AllowGrouping     bool
	AllowTargetWeight bool
	DisplayOrder      int
	Active            bool
}

func (c Class) IsSystemBucket() bool {
	return strings.EqualFold(strings.TrimSpace(c.ClassType), "SYSTEM_BUCKET")
}

func CompactKey(value string) string {
	normalized := Normalize(value)
	return strings.NewReplacer(" ", "", "-", "", "_", "").Replace(strings.ToUpper(strings.TrimSpace(normalized)))
}

func DisplayName(code string) string {
	normalized := Normalize(code)
	if normalized == "" || normalized == "UNASSIGNED" {
		return ""
	}
	words := strings.Fields(strings.ReplaceAll(normalized, "_", " "))
	for i, word := range words {
		words[i] = titleWord(word)
	}
	return strings.Join(words, " ")
}

func Normalize(value string) string {
	normalized := strings.ToUpper(strings.TrimSpace(value))
	compact := strings.Map(func(r rune) rune {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			return r
		}
		return -1
	}, normalized)

	switch compact {
	case "", "UNASSIGNED":
		return "UNASSIGNED"
	case "CASH", "CASHRESERVE", "RESERVE", "CASHFLOATING", "MONEYMARKET":
		return "CASH"
	case "SPY", "SPX", "XAO", "EQUITY":
		return "EQUITY"
	case "BROADEQUITY", "BROADBETA", "GENERALEQUITY":
		return "BROAD_EQUITY"
	case "XLB", "MATERIALS", "MATERIAL":
		return "MATERIALS"
	case "XLE", "ENERGY":
		return "ENERGY"
	case "ENERGYPRODUCERS", "ENERGYOILGAS", "COALMINER":
		return "ENERGY_PRODUCERS"
	case "ENERGYCOMMODITIES", "NATURALGAS", "DIRECTCOMMODITIES":
		return "ENERGY_COMMODITIES"
	case "XLF", "FINANCIALS", "FINANCIAL":
		return "FINANCIALS"
	case "BANKS", "BANK", "BANKFINANCIALS":
		return "BANKS"
	case "XLV", "PHARMA", "PHARMACEUTICALS", "PHARMACEUTICAL":
		return "PHARMA"
	case "PHARMABIOTECH", "BIOTECH":
		return "PHARMA_BIOTECH"
	case "HEALTHCARE":
		return "HEALTHCARE"
	case "HEALTHCARESERVICES":
		return "HEALTHCARE_SERVICES"
	case "MEDTECH":
		return "MEDTECH"
	case "REMX", "REE", "RAREEARTHS":
		return "REE"
	case "RAREEARTHSCRITICALMINERALS", "CRITICALMINERALS":
		return "RARE_EARTHS_CRITICAL_MINERALS"
	case "GOLD":
		return "GOLD"
	case "PHYSICALGOLD", "PHYSICALGOLDETF", "GOLDETF":
		return "PHYSICAL_GOLD"
	case "GOLDMINER", "GOLDMINERS":
		return "GOLD_MINERS"
	case "SILVER":
		return "SILVER"
	case "PHYSICALSILVER", "PHYSICALSILVERETF", "SILVERETF":
		return "PHYSICAL_SILVER"
	case "SILVERMINER", "SILVERMINERS":
		return "SILVER_MINERS"
	case "COPPER":
		return "COPPER"
	case "COPPERMINER", "COPPERMINERS":
		return "COPPER_MINERS"
	case "BASEMETALS":
		return "BASEMETALS"
	case "BASEMETALSMINER", "BASEMETALSMINERS", "BAUXITEMINER":
		return "BASE_METALS_MINERS"
	case "LITHIUM":
		return "LITHIUM"
	case "LITHIUMMINER", "LITHIUMMINERS":
		return "LITHIUM_MINERS"
	case "URANIUM":
		return "URANIUM"
	case "URANIUMMINER", "URANIUMMINERS":
		return "URANIUM_MINERS"
	case "IRON":
		return "IRON"
	case "IRONORE", "IRONOREMINER", "IRONOREMINERS":
		return "IRON_ORE_MINERS"
	case "DIVERSIFIEDMINER", "DIVERSIFIEDMINERS":
		return "DIVERSIFIED_MINERS"
	case "MATERIALSCHEMICALS", "CHEMICALSMATERIALS":
		return "MATERIALS_CHEMICALS"
	case "FORESTRYPAPERPACKAGING":
		return "FORESTRY_PAPER_PACKAGING"
	case "STEELMETALSPROCESSING", "STEELBASEMETALSPROCESSING":
		return "STEEL_METALS_PROCESSING"
	case "MININGSERVICE", "MININGSERVICES", "MININGCONTRACTORS", "MININGEQUIPMENT":
		return "MINING_SERVICES"
	case "ALUMINIUM":
		return "ALUMINIUM"
	case "BONDS", "FIXEDINCOME", "FIXEDINCOMECREDIT":
		return "BONDS"
	case "INSURANCE":
		return "INSURANCE"
	case "STAPLES":
		return "STAPLES"
	case "CONSUMERSTAPLES":
		return "CONSUMER_STAPLES"
	case "CONSUMERDISCRETIONARY", "CONSUMERRETAIL":
		return "CONSUMER_DISCRETIONARY"
	case "GAMBLING":
		return "GAMBLING"
	case "GAMINGGAMBLING", "GAMBLINGWAGERING":
		return "GAMING_GAMBLING"
	case "GAMING":
		return "GAMING"
	case "EDUCATION":
		return "EDUCATION"
	case "MEDIAPUBLISHING":
		return "MEDIA_PUBLISHING"
	case "TECHNOLOGY", "TECH":
		return "TECHNOLOGY"
	case "TECHNOLOGYPLATFORMS":
		return "TECHNOLOGY_PLATFORMS"
	case "SOFTWARESAAS":
		return "SOFTWARE_SAAS"
	case "SEMICONDUCTORS", "SEMICONDUCTOR", "SEMIS":
		return "SEMICONDUCTORS"
	case "CRYPTODIGITALASSETS", "CRYPTO":
		return "CRYPTO_DIGITAL_ASSETS"
	case "DATACENTRES", "DATACENTERS":
		return "DATACENTRES"
	case "TELECOMMUNICATIONS", "TELECOM":
		return "TELECOMMUNICATIONS"
	case "INDUSTRIALS", "INDUSTRIAL":
		return "INDUSTRIALS"
	case "CONSTRUCTIONENGINEERING":
		return "CONSTRUCTION_ENGINEERING"
	case "TRANSPORTLOGISTICS":
		return "TRANSPORT_LOGISTICS"
	case "CIVILAEROSPACE":
		return "CIVIL_AEROSPACE"
	case "DEFENCE", "DEFENSE":
		return "DEFENCE"
	case "INFRASTRUCTURE":
		return "INFRASTRUCTURE"
	case "UTILITIES":
		return "UTILITIES"
	case "REALESTATEREIT", "REIT", "REITS":
		return "REAL_ESTATE_REIT"
	case "AGRICULTUREAGRIBUSINESS", "AGRIBUSINESS", "AGRICULTURE":
		return "AGRICULTURE_AGRIBUSINESS"
	case "ETF":
		return "ETF"
	case "MISC", "MISCELLANEOUS":
		return "MISC"
	default:
		return normalized
	}
}

func ResolveGroupingClassCode(value string, classes []Class) (string, bool) {
	normalized := Normalize(value)
	switch normalized {
	case "", "UNASSIGNED", "MISC", "CASH":
		return "", false
	case "ETF", "EQUITY":
		normalized = "BROAD_EQUITY"
	case "FIXED_INCOME":
		normalized = "BONDS"
	case "ALUMINIUM":
		normalized = "BASE_METALS_MINERS"
	case "FINANCIALS":
		normalized = "BANKS"
	case "GAMING":
		normalized = "GAMING_GAMBLING"
	}

	if code, ok := matchClassCode(normalized, classes, false, true); ok {
		return code, true
	}
	return "", false
}

func ResolveAssignmentClass(value string, classes []Class) (string, bool) {
	normalized := Normalize(value)
	switch normalized {
	case "", "UNASSIGNED", "MISC", "CASH":
		return "", true
	case "ETF", "EQUITY":
		normalized = "BROAD_EQUITY"
	case "FIXED_INCOME":
		normalized = "BONDS"
	case "ALUMINIUM":
		normalized = "BASE_METALS_MINERS"
	case "FINANCIALS":
		normalized = "BANKS"
	case "GAMING":
		normalized = "GAMING_GAMBLING"
	}
	return ResolveGroupingClassCode(normalized, classes)
}

func ResolveClassForCode(value string, classes []Class, requireTargetWeight bool) (Class, bool) {
	normalized := Normalize(value)
	if normalized == "" {
		normalized = "UNASSIGNED"
	}
	compactNormalized := CompactKey(normalized)

	for _, class := range classes {
		if !class.Active || (requireTargetWeight && !class.AllowTargetWeight) {
			continue
		}
		if classCodeMatches(class.Code, normalized, compactNormalized) {
			return class, true
		}
	}
	for _, class := range classes {
		if !class.Active || (requireTargetWeight && !class.AllowTargetWeight) {
			continue
		}
		if classCodeMatches(class.AssetClassCode, normalized, compactNormalized) {
			return class, true
		}
	}
	for _, class := range classes {
		if !class.Active || (requireTargetWeight && !class.AllowTargetWeight) || class.IsSystemBucket() {
			continue
		}
		if classCodeMatches(class.ParentCode, normalized, compactNormalized) {
			return class, true
		}
	}
	if normalized != "CASH" {
		for _, class := range classes {
			if class.Active && (!requireTargetWeight || class.AllowTargetWeight) && Normalize(class.Code) == "UNASSIGNED" {
				return class, true
			}
		}
	}

	return Class{}, false
}

func matchClassCode(normalized string, classes []Class, requireTargetWeight bool, requireGrouping bool) (string, bool) {
	compactNormalized := CompactKey(normalized)
	for _, class := range classes {
		if !class.Active || class.IsSystemBucket() {
			continue
		}
		if requireTargetWeight && !class.AllowTargetWeight {
			continue
		}
		if requireGrouping && !class.AllowGrouping {
			continue
		}
		if classCodeMatches(class.Code, normalized, compactNormalized) {
			return Normalize(class.Code), true
		}
	}
	for _, class := range classes {
		if !class.Active || class.IsSystemBucket() {
			continue
		}
		if requireTargetWeight && !class.AllowTargetWeight {
			continue
		}
		if requireGrouping && !class.AllowGrouping {
			continue
		}
		if classCodeMatches(class.AssetClassCode, normalized, compactNormalized) {
			return Normalize(class.Code), true
		}
	}
	for _, class := range classes {
		if !class.Active || class.IsSystemBucket() {
			continue
		}
		if requireTargetWeight && !class.AllowTargetWeight {
			continue
		}
		if requireGrouping && !class.AllowGrouping {
			continue
		}
		if classCodeMatches(class.ParentCode, normalized, compactNormalized) {
			return Normalize(class.Code), true
		}
	}
	return "", false
}

func classCodeMatches(value, normalized, compactNormalized string) bool {
	if strings.TrimSpace(value) == "" {
		return false
	}
	return Normalize(value) == normalized || CompactKey(value) == compactNormalized
}

func titleWord(value string) string {
	if value == "" {
		return ""
	}
	runes := []rune(strings.ToLower(value))
	runes[0] = unicode.ToUpper(runes[0])
	return string(runes)
}
