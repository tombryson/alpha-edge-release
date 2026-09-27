package portfolio

import "testing"

func TestResolveQ3RiskTarget(t *testing.T) {
	tests := []struct {
		name       string
		spPct      float64
		xaoPct     float64
		spSource   string
		wantPct    float64
		wantSource string
	}{
		{
			name:       "both disconnected",
			spPct:      -1,
			xaoPct:     -1,
			wantPct:    -1,
			wantSource: "DISCONNECTED",
		},
		{
			name:       "only XAO connected",
			spPct:      -1,
			xaoPct:     35,
			spSource:   "SPX",
			wantPct:    35,
			wantSource: "XAO",
		},
		{
			name:       "only SP connected",
			spPct:      65,
			xaoPct:     -1,
			spSource:   "spx",
			wantPct:    65,
			wantSource: "SPX",
		},
		{
			name:       "lower SP target governs",
			spPct:      30,
			xaoPct:     80,
			spSource:   "SPX",
			wantPct:    30,
			wantSource: "SPX",
		},
		{
			name:       "lower XAO target governs",
			spPct:      80,
			xaoPct:     30,
			spSource:   "SPX",
			wantPct:    30,
			wantSource: "XAO",
		},
		{
			name:       "empty SP source defaults to SPY",
			spPct:      80,
			xaoPct:     -1,
			spSource:   "",
			wantPct:    80,
			wantSource: "SPY",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotPct, gotSource := ResolveQ3RiskTarget(tt.spPct, tt.xaoPct, tt.spSource)
			if gotPct != tt.wantPct || gotSource != tt.wantSource {
				t.Fatalf("ResolveQ3RiskTarget() = %.1f, %q; want %.1f, %q", gotPct, gotSource, tt.wantPct, tt.wantSource)
			}
		})
	}
}

func TestBuildRiskStateQ4OverridesQ3(t *testing.T) {
	state := BuildRiskState(35, 80, "SPX", Q4CrisisInput{
		Active: true,
		Reason: "q4d_sell_signal",
	})

	if state.Mode != "Q4_CRISIS" {
		t.Fatalf("Mode = %q; want Q4_CRISIS", state.Mode)
	}
	if state.Priority != 2 {
		t.Fatalf("Priority = %d; want 2", state.Priority)
	}
	if state.TargetPct != Q4CrisisTargetEquityPct {
		t.Fatalf("TargetPct = %.1f; want %.1f", state.TargetPct, Q4CrisisTargetEquityPct)
	}
	if state.TargetKind != "MARKET_EXPOSURE" {
		t.Fatalf("TargetKind = %q; want MARKET_EXPOSURE", state.TargetKind)
	}
	if state.Q3TargetPct != 35 || state.Q3Source != "SPX" || !state.Q3Active {
		t.Fatalf("Q3 context = %.1f/%s/%v; want 35.0/SPX/true", state.Q3TargetPct, state.Q3Source, state.Q3Active)
	}
}

func TestBuildRiskStateQ3Throttle(t *testing.T) {
	state := BuildRiskState(65, 80, "SPX", Q4CrisisInput{})

	if state.Mode != "Q3_THROTTLE" {
		t.Fatalf("Mode = %q; want Q3_THROTTLE", state.Mode)
	}
	if state.Priority != 1 {
		t.Fatalf("Priority = %d; want 1", state.Priority)
	}
	if state.TargetPct != 65 {
		t.Fatalf("TargetPct = %.1f; want 65.0", state.TargetPct)
	}
	if state.TargetKind != "Q1_EXPOSURE" {
		t.Fatalf("TargetKind = %q; want Q1_EXPOSURE", state.TargetKind)
	}
	if state.ActiveReason != "spx_q3_signal" {
		t.Fatalf("ActiveReason = %q; want spx_q3_signal", state.ActiveReason)
	}
}

func TestBuildRiskStateNormal(t *testing.T) {
	state := BuildRiskState(100, 100, "SPX", Q4CrisisInput{})

	if state.Mode != "NORMAL" {
		t.Fatalf("Mode = %q; want NORMAL", state.Mode)
	}
	if state.TargetPct != 100 {
		t.Fatalf("TargetPct = %.1f; want 100.0", state.TargetPct)
	}
	if state.Q3Active {
		t.Fatalf("Q3Active = true; want false")
	}
}
