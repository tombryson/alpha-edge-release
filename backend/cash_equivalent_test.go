package main

import "testing"

func TestIsCashEquivalentTickerNormalisesExchangePrefix(t *testing.T) {
	cases := []struct {
		ticker string
		want   bool
	}{
		{ticker: "AAA", want: true},
		{ticker: "ASX:AAA", want: true},
		{ticker: "ASX_DLY:AAA", want: true},
		{ticker: "BSUB", want: true},
		{ticker: "ASX:BSUB", want: true},
		{ticker: "ASX:BHP", want: false},
		{ticker: "", want: false},
	}

	for _, tc := range cases {
		if got := isCashEquivalentTicker(tc.ticker); got != tc.want {
			t.Fatalf("isCashEquivalentTicker(%q) = %v, want %v", tc.ticker, got, tc.want)
		}
	}
}
