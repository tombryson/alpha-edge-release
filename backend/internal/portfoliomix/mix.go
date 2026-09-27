package portfoliomix

import (
	"math"
	"sort"
	"strings"
)

type SleeveResolver func(string) (Sleeve, bool)

type Sleeve struct {
	Code         string
	DisplayName  string
	DisplayOrder int
}

type Summary struct {
	AssetClass             string
	DisplayName            string
	DisplayOrder           int
	OverlayEligible        bool
	ActualInvestedPct      float64
	ActualInvestedValue    float64
	TacticalCashPct        float64
	TacticalCashValue      float64
	TotalClassCapitalValue float64
}

type Row struct {
	AssetClass          string
	DisplayName         string
	DisplayOrder        int
	GovernedByQ1        bool
	WeightPct           float64
	InvestedWeightPct   float64
	SleeveCashWeightPct float64
	Value               float64
	InvestedValue       float64
	SleeveCashValue     float64
}

type CashComponent struct {
	Key          string
	DisplayName  string
	Ticker       string
	Value        float64
	WeightPct    float64
	DisplayOrder int
}

func BuildRows(summaries []Summary, totalValue float64, cashValue float64, resolve SleeveResolver) []Row {
	rowBySleeve := make(map[string]Row)

	for _, summary := range summaries {
		if summary.TotalClassCapitalValue <= 0.01 && summary.ActualInvestedValue <= 0.01 && summary.TacticalCashValue <= 0.01 {
			continue
		}
		assetClass := strings.ToUpper(strings.TrimSpace(summary.AssetClass))
		displayName := strings.TrimSpace(summary.DisplayName)
		displayOrder := summary.DisplayOrder
		if resolve != nil {
			if sleeve, ok := resolve(summary.AssetClass); ok {
				assetClass = strings.ToUpper(strings.TrimSpace(sleeve.Code))
				displayName = strings.TrimSpace(sleeve.DisplayName)
				displayOrder = sleeve.DisplayOrder
			}
		}
		if assetClass == "" {
			assetClass = "UNASSIGNED"
		}
		if displayName == "" {
			displayName = assetClass
		}

		existing := rowBySleeve[assetClass]
		if existing.AssetClass == "" {
			existing = Row{
				AssetClass:   assetClass,
				DisplayName:  displayName,
				DisplayOrder: displayOrder,
				GovernedByQ1: summary.OverlayEligible,
			}
		}
		existing.GovernedByQ1 = existing.GovernedByQ1 || summary.OverlayEligible
		existing.WeightPct += summary.ActualInvestedPct
		existing.InvestedWeightPct += summary.ActualInvestedPct
		existing.SleeveCashWeightPct += summary.TacticalCashPct
		existing.Value += summary.ActualInvestedValue
		existing.InvestedValue += summary.ActualInvestedValue
		existing.SleeveCashValue += summary.TacticalCashValue
		rowBySleeve[assetClass] = existing
	}

	if cashValue > 0.01 || totalValue > 0.01 {
		cashPct := 0.0
		if totalValue > 0 {
			cashPct = (cashValue / totalValue) * 100
		}
		displayName := "Cash/Reserve"
		displayOrder := 10000
		if resolve != nil {
			if sleeve, ok := resolve("CASH"); ok {
				displayName = strings.TrimSpace(sleeve.DisplayName)
				displayOrder = sleeve.DisplayOrder
			}
		}
		rowBySleeve["CASH"] = Row{
			AssetClass:          "CASH",
			DisplayName:         displayName,
			DisplayOrder:        displayOrder,
			GovernedByQ1:        false,
			WeightPct:           cashPct,
			InvestedWeightPct:   0,
			SleeveCashWeightPct: cashPct,
			Value:               cashValue,
			InvestedValue:       0,
			SleeveCashValue:     cashValue,
		}
	}

	rows := make([]Row, 0, len(rowBySleeve))
	for _, row := range rowBySleeve {
		rows = append(rows, row)
	}
	sortRows(rows)
	return rows
}

func BuildCashComponents(components []CashComponent, totalValue float64, portfolioCashBucketValue float64) []CashComponent {
	result := make([]CashComponent, 0, len(components))
	for _, component := range components {
		if component.Value <= 0.01 {
			continue
		}
		if totalValue > 0 {
			component.WeightPct = (component.Value / totalValue) * 100
		}
		result = append(result, component)
	}
	if len(result) == 0 && portfolioCashBucketValue > 0.01 {
		weightPct := 0.0
		if totalValue > 0 {
			weightPct = (portfolioCashBucketValue / totalValue) * 100
		}
		result = append(result, CashComponent{
			Key:          "CASH_RESERVE",
			DisplayName:  "Cash/Reserve",
			Value:        portfolioCashBucketValue,
			WeightPct:    weightPct,
			DisplayOrder: 1,
		})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].DisplayOrder != result[j].DisplayOrder {
			return result[i].DisplayOrder < result[j].DisplayOrder
		}
		return result[i].DisplayName < result[j].DisplayName
	})
	return result
}

func sortRows(rows []Row) {
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].DisplayOrder != rows[j].DisplayOrder {
			return rows[i].DisplayOrder < rows[j].DisplayOrder
		}
		if math.Abs(rows[i].WeightPct-rows[j].WeightPct) > 0.0001 {
			return rows[i].WeightPct > rows[j].WeightPct
		}
		return rows[i].AssetClass < rows[j].AssetClass
	})
}
