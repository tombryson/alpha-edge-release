package staticdata

// Static ETF bootstrap settings.
//
// These are defaults used to initialise the ETF monitor and policy table. They
// are not asset-class taxonomy and should not be used to infer ETF class
// assignments; ETF class assignments live on stock_analysis.primary_asset_class.

var DefaultETFTickers = []string{
	"FANG",
	"GPEQ",
	"ESPO",
	"ASIA",
	"SGDJ",
	"SLVR",
	"ARMR",
	"SEMI",
	"LSX",
	"NUCL",
	"VPN",
}

var DefaultETFPolicySettings = map[string]string{
	"etf_min_exposure_pct":            "25",
	"etf_core_sleeve_ratio_pct":       "25",
	"etf_sell_reduction_pct":          "50",
	"etf_momentum_automation_enabled": "true",
	"etf_momentum_daily_utc_hour":     "10",
	"etf_momentum_publish_cadence":    "EIGHTY_TRADING_DAYS",
}
