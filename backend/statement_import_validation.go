package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"strings"
	"time"
)

type statementExistingHolding struct {
	ID             int
	SecurityID     int64
	ISIN           string
	Ticker         string
	ExchangePrefix string
	CompanyName    string
	Quantity       float64
	ValueAUD       float64
	External       bool
}

func decodeStatementImport(reader io.Reader) (StatementImport, error) {
	var payload StatementImport
	var raw json.RawMessage
	decoder := json.NewDecoder(reader)
	if err := decoder.Decode(&raw); err != nil {
		return payload, err
	}
	if err := decoder.Decode(new(interface{})); err != io.EOF {
		return payload, fmt.Errorf("expected one statement JSON object")
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return payload, err
	}
	// Distinguish an explicit zero or empty holdings list from missing OCR fields.
	var fields struct {
		Account  map[string]json.RawMessage
		Holdings []map[string]json.RawMessage
	}
	if err := json.Unmarshal(raw, &fields); err != nil {
		return payload, err
	}
	present := func(row map[string]json.RawMessage, key string) bool {
		value := strings.TrimSpace(string(row[key]))
		return value != "" && value != "null"
	}
	for _, key := range []string{"account_name", "statement_date", "total_value_aud", "cash_aud"} {
		if !present(fields.Account, key) {
			return payload, fmt.Errorf("account.%s is required", key)
		}
	}
	if fields.Holdings == nil {
		return payload, fmt.Errorf("holdings must be an explicit array; use [] only for an all-cash statement")
	}
	for index, row := range fields.Holdings {
		for _, key := range []string{"details", "quantity", "currency"} {
			if !present(row, key) {
				return payload, fmt.Errorf("holding %d: %s is required", index+1, key)
			}
		}
		if !present(row, "value_aud") && !present(row, "market_value_native") {
			return payload, fmt.Errorf("holding %d: value_aud or market_value_native is required", index+1)
		}
	}
	return payload, nil
}

func statementCalendarDay(value time.Time) time.Time {
	year, month, day := value.Date()
	return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
}

func validateStatementImport(payload *StatementImport, now time.Time) error {
	account := &payload.Account
	account.AccountName = strings.TrimSpace(account.AccountName)
	if account.AccountName == "" || account.StatementDate.IsZero() {
		return fmt.Errorf("account name and statement date are required")
	}
	account.StatementDate = statementCalendarDay(account.StatementDate)
	// Broker calendar dates may be ahead of UTC in Australia, but not months ahead.
	if account.StatementDate.After(statementCalendarDay(now.UTC()).AddDate(0, 0, 1)) {
		return fmt.Errorf("statement date is in the future")
	}
	finite := func(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }
	for _, value := range []float64{account.TotalValueAUD, account.CashAUD, account.USDValue, account.USDAUD, account.GBPValue, account.GBPAUD, account.AUDValue} {
		if !finite(value) {
			return fmt.Errorf("account amounts must be finite numbers")
		}
	}
	if account.TotalValueAUD <= 0 {
		return fmt.Errorf("total_value_aud must be positive; a zero-value account closure requires review")
	}
	for _, pair := range [][2]float64{{account.USDValue, account.USDAUD}, {account.GBPValue, account.GBPAUD}} {
		if pair[0] < 0 || pair[1] < 0 || (pair[0] == 0) != (pair[1] == 0) {
			return fmt.Errorf("foreign asset totals require both native and AUD equivalents, or both zero")
		}
	}
	seenNames, seenISINs := map[string]bool{}, map[string]bool{}
	total, allowance := account.CashAUD, 0.02
	for index := range payload.Holdings {
		holding := &payload.Holdings[index]
		holding.Details = strings.TrimSpace(holding.Details)
		holding.ISIN = strings.ToUpper(strings.TrimSpace(holding.ISIN))
		holding.Currency = strings.ToUpper(strings.TrimSpace(holding.Currency))
		name := strings.ToLower(holding.Details)
		if name == "" || seenNames[name] || (holding.ISIN != "" && seenISINs[holding.ISIN]) {
			return fmt.Errorf("holding %d has a missing name or duplicate name/ISIN", index+1)
		}
		seenNames[name] = true
		if holding.ISIN != "" {
			seenISINs[holding.ISIN] = true
		}
		if holding.Currency == "" {
			return fmt.Errorf("%s: currency is required", holding.Details)
		}
		for _, value := range []float64{holding.Quantity, holding.CostAUD, holding.CostNative, holding.CurrentPrice, holding.ValueAUD, holding.MarketValueNative, holding.MarketValue, holding.CashReserve, holding.GainLossAUD, holding.GainLossNative, holding.GainLossPct} {
			if !finite(value) {
				return fmt.Errorf("%s: amounts and quantities must be finite", holding.Details)
			}
		}
		if holding.Quantity < 0 || holding.CurrentPrice < 0 || holding.ValueAUD < 0 || holding.MarketValueNative < 0 || holding.MarketValue < 0 || holding.CostAUD < 0 || holding.CostNative < 0 || holding.CashReserve < 0 {
			return fmt.Errorf("%s: quantities, prices, values and costs cannot be negative in this long-only import", holding.Details)
		}
		hasNative := holding.MarketValueNative != 0 || holding.CostNative != 0 || holding.GainLossNative != 0
		if hasNative && holding.Currency != "AUD" {
			validFX := (holding.Currency == "USD" && account.USDValue > 0 && account.USDAUD > 0) ||
				(holding.Currency == "GBP" && account.GBPValue > 0 && account.GBPAUD > 0)
			if !validFX {
				return fmt.Errorf("%s: no supported %s-to-AUD conversion in the account summary", holding.Details, holding.Currency)
			}
		}
		cost, value, gain, market := importedHoldingAUDAmounts(*account, *holding)
		if !finite(cost) || !finite(value) || !finite(gain) || !finite(market) || value < 0 {
			return fmt.Errorf("%s: invalid converted AUD amounts", holding.Details)
		}
		if holding.Quantity == 0 && value != 0 {
			return fmt.Errorf("%s: a nonzero holding value requires a positive quantity", holding.Details)
		}
		total += value
		allowance += 0.01 * math.Max(1, statementCurrencyRate(*account, holding.Currency))
	}
	allowance = math.Max(1, allowance)
	if !finite(total) || !finite(allowance) || math.Abs(total-account.TotalValueAUD) > allowance+0.000001 {
		return fmt.Errorf("statement totals do not reconcile: holdings plus cash AUD %.2f, account total AUD %.2f (rounding allowance AUD %.2f); nothing imported", total, account.TotalValueAUD, allowance)
	}
	return nil
}

func statementSecurityIsExternalTx(tx *sql.Tx, securityID int64, name, ticker string) (bool, error) {
	var external bool
	err := tx.QueryRow(fmt.Sprintf(`SELECT EXISTS (
		SELECT 1 FROM stock_analysis sa WHERE COALESCE(sa.is_external, 0) = 1 AND (
		(? > 0 AND sa.security_id = ?) OR LOWER(TRIM(sa.name)) = LOWER(TRIM(?)) OR
		(? != '' AND %s = ?)))`, stockAnalysisTickerKeySQL("sa.ticker")),
		securityID, securityID, name, securityActionTicker(ticker), securityActionTicker(ticker)).Scan(&external)
	return external, err
}
