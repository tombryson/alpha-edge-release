package main

import "math"

// Targets describe capacity, not cash. An ETF target reduction releases only
// unoccupied capacity; an unsold fund continues to consume its class budget.
func directStockBudget(classTarget, effectiveETFTarget, actualETFValue float64) float64 {
	return math.Max(classTarget-math.Max(effectiveETFTarget, actualETFValue), 0)
}
