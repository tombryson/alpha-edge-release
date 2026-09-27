package staticdata

// Static regime return ticker mapping.
//
// This is market-data configuration for the regime screen. It is not the
// canonical asset-class taxonomy; canonical allocation buckets live in the
// asset_classes table.

// Yahoo Finance tickers for each regime asset class.
// Each entry is a list so EQUITY can show SPX + XAO side by side.
var RegimeReturnTickers = map[string][]string{
	"EQUITY":    {"^GSPC", "^AXJO"},
	"ENERGY":    {"XLE"},
	"GOLD":      {"GC=F"},
	"SILVER":    {"SLV"},
	"COPPER":    {"HG=F"},
	"IRON":      {"BHP"},
	"ALUMINIUM": {"AA"},
	"URANIUM":   {"URA"},
	"REE":       {"REMX"},
}

var RegimeReturnLabels = map[string]string{
	"^GSPC": "SPX",
	"^AXJO": "XAO",
	"XLE":   "XLE",
	"GC=F":  "GOLD",
	"SLV":   "SILVER",
	"HG=F":  "COPPER",
	"BHP":   "BHP",
	"AA":    "AA",
	"URA":   "URA",
	"REMX":  "REMX",
}

var RegimeReturnAssetClassOrder = []string{
	"EQUITY",
	"ENERGY",
	"GOLD",
	"SILVER",
	"COPPER",
	"IRON",
	"ALUMINIUM",
	"URANIUM",
	"REE",
}

var RegimeStatusAssetClasses = []string{
	"EQUITY",
	"GOLD",
	"SILVER",
	"ETF",
	"MATERIALS",
	"URANIUM",
	"BASEMETALS",
	"PHARMA",
	"REE",
	"FINANCIALS",
	"ENERGY",
	"COPPER",
	"HEALTHCARE",
	"IRON",
	"ALUMINIUM",
}

var KnownRegimeWebhookTickers = []string{
	"SPY",
	"SPX",
	"XAO",
	"GOLD",
	"SILVER",
	"COPPER",
	"ENERGY",
	"URANIUM",
	"MATERIALS",
	"FINANCIALS",
	"HEALTHCARE",
	"IRON",
	"ALUMINIUM",
	"REMX",
	"GC1!",
	"SI1!",
	"CL1!",
}

var AffectedAssetClassesByRegimeTicker = map[string][]string{
	"SPY":        {"EQUITY"},
	"SPX":        {"EQUITY"},
	"XAO":        {"EQUITY"},
	"GOLD":       {"GOLD"},
	"SILVER":     {"SILVER"},
	"COPPER":     {"COPPER", "BASEMETALS"},
	"XLE":        {"ENERGY"},
	"ENERGY":     {"ENERGY"},
	"URANIUM":    {"URANIUM"},
	"XLB":        {"MATERIALS"},
	"MATERIALS":  {"MATERIALS"},
	"XLF":        {"FINANCIALS"},
	"FINANCIALS": {"FINANCIALS"},
	"XLV":        {"HEALTHCARE", "PHARMA"},
	"HEALTHCARE": {"HEALTHCARE"},
	"PHARMA":     {"PHARMA"},
	"IRON":       {"IRON"},
	"ALUMINIUM":  {"ALUMINIUM"},
	"REMX":       {"REE"},
	"REE":        {"REE"},
}

var RegimeControllersByAssetClass = map[string][]string{
	"ENERGY":     {"ENERGY"},
	"PHARMA":     {"PHARMA"},
	"HEALTHCARE": {"HEALTHCARE"},
	"MATERIALS":  {"EQUITY", "MATERIALS"},
	"GOLD":       {"EQUITY", "GOLD"},
	"SILVER":     {"EQUITY", "SILVER"},
	"COPPER":     {"EQUITY", "COPPER"},
	"BASEMETALS": {"EQUITY", "BASEMETALS"},
	"LITHIUM":    {"EQUITY", "MATERIALS"},
	"URANIUM":    {"EQUITY", "URANIUM"},
	"REE":        {"EQUITY", "REE"},
	"IRON":       {"EQUITY", "IRON"},
	"ALUMINIUM":  {"EQUITY", "ALUMINIUM"},
	"FINANCIALS": {"EQUITY", "FINANCIALS"},
	"INSURANCE":  {"EQUITY", "FINANCIALS"},
}

var RegimeControllerlessAssetClasses = map[string]struct{}{
	"":           {},
	"UNASSIGNED": {},
	"ETF":        {},
	"BONDS":      {},
}
