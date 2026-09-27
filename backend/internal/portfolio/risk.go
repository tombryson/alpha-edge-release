package portfolio

import "strings"

const Q4CrisisTargetEquityPct = 10.0

type Q4CrisisInput struct {
	Active bool
	Reason string
}

type RiskState struct {
	Mode         string
	Label        string
	Priority     int
	TargetPct    float64
	TargetKind   string
	ActiveReason string
	Q3TargetPct  float64
	Q3Source     string
	Q3Active     bool
}

func ResolveQ3RiskTarget(spPct, xaoPct float64, spSource string) (float64, string) {
	spSource = strings.ToUpper(strings.TrimSpace(spSource))
	if spSource == "" {
		spSource = "SPY"
	}

	switch {
	case spPct < 0 && xaoPct < 0:
		return -1, "DISCONNECTED"
	case spPct < 0:
		return xaoPct, "XAO"
	case xaoPct < 0:
		return spPct, spSource
	case spPct <= xaoPct:
		return spPct, spSource
	default:
		return xaoPct, "XAO"
	}
}

func BuildRiskState(spPct, xaoPct float64, spSource string, q4 Q4CrisisInput) RiskState {
	q3TargetPct, q3Source := ResolveQ3RiskTarget(spPct, xaoPct, spSource)
	q3Active := q3TargetPct >= 0 && q3TargetPct < 99.9999

	state := RiskState{
		Mode:        "NORMAL",
		Label:       "Normal",
		Priority:    0,
		TargetPct:   100,
		TargetKind:  "NONE",
		Q3TargetPct: q3TargetPct,
		Q3Source:    q3Source,
		Q3Active:    q3Active,
	}

	if q4.Active {
		state.Mode = "Q4_CRISIS"
		state.Label = "Q4 Crisis"
		state.Priority = 2
		state.TargetPct = Q4CrisisTargetEquityPct
		state.TargetKind = "MARKET_EXPOSURE"
		state.ActiveReason = strings.TrimSpace(q4.Reason)
		return state
	}

	if q3Active {
		state.Mode = "Q3_THROTTLE"
		state.Label = "Q3 Throttle"
		state.Priority = 1
		state.TargetPct = q3TargetPct
		state.TargetKind = "Q1_EXPOSURE"
		state.ActiveReason = strings.ToLower(q3Source) + "_q3_signal"
	}

	return state
}
