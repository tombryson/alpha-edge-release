// Package database owns schema upgrades and isolated SQLite recovery operations.
package database

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
)

type querier interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

type object struct{ Kind, Name, SQL string }
type column struct {
	Name, Type  string
	NotNull, PK int
	Default     sql.NullString
}

func ident(s string) string { return `"` + strings.ReplaceAll(s, `"`, `""`) + `"` }

func objects(ctx context.Context, q querier) ([]object, error) {
	rows, err := q.QueryContext(ctx, `SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END,name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []object
	for rows.Next() {
		var o object
		if err := rows.Scan(&o.Kind, &o.Name, &o.SQL); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func columns(ctx context.Context, q querier, table string) ([]column, error) {
	rows, err := q.QueryContext(ctx, "PRAGMA table_info("+ident(table)+")")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []column
	for rows.Next() {
		var c column
		var ordinal int
		if err := rows.Scan(&ordinal, &c.Name, &c.Type, &c.NotNull, &c.Default, &c.PK); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// SQLite supplies the column metadata; this scanner only preserves the exact
// frozen column declaration when constructing an additive ALTER TABLE.
func declarations(create string) ([]string, error) {
	parts, _, err := declarationsEnd(create)
	return parts, err
}

func declarationsEnd(create string) ([]string, int, error) {
	start := strings.IndexByte(create, '(')
	if start < 0 {
		return nil, 0, fmt.Errorf("invalid table declaration")
	}
	depth, quote, begin := 1, byte(0), start+1
	var parts []string
	for i := begin; i < len(create); i++ {
		ch := create[i]
		if quote != 0 {
			if ch == quote {
				if i+1 < len(create) && create[i+1] == quote {
					i++
				} else {
					quote = 0
				}
			}
			continue
		}
		switch ch {
		case '\'', '"', '`':
			quote = ch
		case '[':
			quote = ']'
		case '(':
			depth++
		case ')':
			depth--
			if depth == 0 {
				parts = append(parts, strings.TrimSpace(create[begin:i]))
				return parts, i + 1, nil
			}
		case ',':
			if depth == 1 {
				parts = append(parts, strings.TrimSpace(create[begin:i]))
				begin = i + 1
			}
		}
	}
	return nil, 0, fmt.Errorf("unbalanced table declaration")
}

func columnDefinition(create, name string) (string, error) {
	parts, err := declarations(create)
	if err != nil {
		return "", err
	}
	for _, part := range parts {
		word := strings.Fields(part)
		if len(word) == 0 {
			continue
		}
		token := strings.Trim(word[0], "\"`[]")
		if strings.EqualFold(token, name) {
			return part, nil
		}
	}
	return "", fmt.Errorf("cannot find declaration for %s", name)
}

// Normalise SQL whitespace and identifier case, but retain quoted values.
func normalSQL(s string) string {
	var b strings.Builder
	var quote byte
	for i := 0; i < len(s); i++ {
		ch := s[i]
		if quote != 0 {
			b.WriteByte(ch)
			if ch == quote {
				if i+1 < len(s) && s[i+1] == quote {
					i++
					b.WriteByte(ch)
				} else {
					quote = 0
				}
			}
			continue
		}
		if ch == '\'' {
			quote = ch
			b.WriteByte(ch)
		} else if ch == ' ' || ch == '\n' || ch == '\t' || ch == '\r' || ch == '"' || ch == '`' || ch == '[' || ch == ']' {
			continue
		} else {
			b.WriteString(strings.ToUpper(string(ch)))
		}
	}
	return b.String()
}

func checks(create string) ([]string, error) {
	parts, err := declarations(create)
	if err != nil {
		return nil, err
	}
	var out []string
	for _, part := range parts {
		upper := strings.ToUpper(part)
		for start := 0; start < len(part); {
			i := strings.Index(upper[start:], "CHECK")
			if i < 0 {
				break
			}
			i += start + 5
			for i < len(part) && (part[i] == ' ' || part[i] == '\n' || part[i] == '\t') {
				i++
			}
			if i >= len(part) || part[i] != '(' {
				start = i
				continue
			}
			decl, end, err := declarationsEnd("CHECK" + part[i:])
			if err != nil {
				return nil, err
			}
			out = append(out, normalSQL(strings.Join(decl, ",")))
			start = i + end - len("CHECK")
		}
	}
	sort.Strings(out)
	return out, nil
}

func tableConstraints(ctx context.Context, q querier, table string) ([]string, error) {
	rows, err := q.QueryContext(ctx, "PRAGMA foreign_key_list("+ident(table)+")")
	if err != nil {
		return nil, err
	}
	var out []string
	for rows.Next() {
		var id, seq int
		var target, from, to, update, delete, match string
		if err := rows.Scan(&id, &seq, &target, &from, &to, &update, &delete, &match); err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, fmt.Sprintf("fk:%d:%s:%s:%s:%s:%s:%s", seq, target, from, to, update, delete, match))
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	rows, err = q.QueryContext(ctx, "PRAGMA index_list("+ident(table)+")")
	if err != nil {
		return nil, err
	}
	var names []string
	for rows.Next() {
		var seq, unique, partial int
		var name, origin string
		if err := rows.Scan(&seq, &name, &unique, &origin, &partial); err != nil {
			rows.Close()
			return nil, err
		}
		if unique == 1 && partial == 0 {
			names = append(names, name)
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	for _, name := range names {
		rows, err := q.QueryContext(ctx, "PRAGMA index_info("+ident(name)+")")
		if err != nil {
			return nil, err
		}
		var cols []string
		for rows.Next() {
			var seq, cid int
			var col sql.NullString
			if err := rows.Scan(&seq, &cid, &col); err != nil {
				rows.Close()
				return nil, err
			}
			cols = append(cols, col.String)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
		out = append(out, "unique:"+strings.Join(cols, ","))
	}
	sort.Strings(out)
	unique := out[:0]
	for _, item := range out {
		if len(unique) == 0 || unique[len(unique)-1] != item {
			unique = append(unique, item)
		}
	}
	return unique, nil
}

func baselinePlan(ctx context.Context, q querier) ([]string, bool, error) {
	ref, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		return nil, false, err
	}
	defer ref.Close()
	ref.SetMaxOpenConns(1)
	if _, err = ref.ExecContext(ctx, baselineSQL); err != nil {
		return nil, false, fmt.Errorf("invalid embedded baseline: %w", err)
	}
	expected, err := objects(ctx, ref)
	if err != nil {
		return nil, false, err
	}
	actual, err := objects(ctx, q)
	if err != nil {
		return nil, false, err
	}
	byName := map[string]object{}
	fresh := true
	for _, o := range actual {
		byName[o.Name] = o
		if o.Name != ledgerTable {
			fresh = false
		}
	}
	if !fresh {
		for _, table := range []string{"holdings", "account_statements", "stock_analysis", "settings", "alerts", "security_positions"} {
			if byName[table].Kind != "table" {
				return nil, false, fmt.Errorf("unsupported database: required legacy table %s is missing", table)
			}
		}
	}
	var plan []string
	for _, o := range expected {
		old, exists := byName[o.Name]
		if !exists {
			if !fresh && o.Kind == "table" && o.Name != "portfolio_memo_runs" {
				return nil, false, fmt.Errorf("unsupported upgrade: missing table %s; explicit migration required", o.Name)
			}
			plan = append(plan, o.SQL)
			continue
		}
		if old.Kind != o.Kind {
			return nil, false, fmt.Errorf("schema conflict: %s is a %s, expected %s", o.Name, old.Kind, o.Kind)
		}
		if o.Kind != "table" {
			if normalSQL(old.SQL) != normalSQL(o.SQL) {
				return nil, false, fmt.Errorf("schema conflict: %s definition differs", o.Name)
			}
			continue
		}
		wanted, err := columns(ctx, ref, o.Name)
		if err != nil {
			return nil, false, err
		}
		have, err := columns(ctx, q, o.Name)
		if err != nil {
			return nil, false, err
		}
		byCol := map[string]column{}
		for _, c := range have {
			byCol[c.Name] = c
		}
		for _, c := range wanted {
			if existing, ok := byCol[c.Name]; ok {
				if !strings.EqualFold(c.Type, existing.Type) || c.PK != existing.PK {
					return nil, false, fmt.Errorf("schema conflict: %s.%s type or primary key differs", o.Name, c.Name)
				}
				defaultsMatch := c.Default == existing.Default
				if o.Name == "etf_allocations" && c.Name == "tactical_status" && existing.Default.Valid && existing.Default.String == `"BUY"` && c.Default.String == `'BUY'` {
					defaultsMatch = true
				}
				if c.NotNull != existing.NotNull || !defaultsMatch {
					return nil, false, fmt.Errorf("schema conflict: %s.%s nullability or default differs", o.Name, c.Name)
				}
				continue
			}
			// Only these known recent additive fields can be adopted. Missing
			// older columns may mean a rename or corruption, not an old version.
			additive := o.Name == "security_actions" && (c.Name == "execution_cash_value" || c.Name == "execution_exception_reason" || c.Name == "execution_policy_snapshot")
			if !additive {
				return nil, false, fmt.Errorf("unsupported upgrade: missing column %s.%s; explicit migration required", o.Name, c.Name)
			}
			definition, err := columnDefinition(o.SQL, c.Name)
			if err != nil {
				return nil, false, err
			}
			plan = append(plan, "ALTER TABLE "+ident(o.Name)+" ADD COLUMN "+definition)
		}
		wantConstraints, err := tableConstraints(ctx, ref, o.Name)
		if err != nil {
			return nil, false, err
		}
		haveConstraints, err := tableConstraints(ctx, q, o.Name)
		if err != nil {
			return nil, false, err
		}
		if strings.Join(wantConstraints, "|") != strings.Join(haveConstraints, "|") {
			return nil, false, fmt.Errorf("unsupported upgrade: %s foreign/unique keys differ; explicit migration required", o.Name)
		}
		wantChecks, err := checks(o.SQL)
		if err != nil {
			return nil, false, err
		}
		haveChecks, err := checks(old.SQL)
		if err != nil {
			return nil, false, err
		}
		if strings.Join(wantChecks, "|") != strings.Join(haveChecks, "|") {
			// The deployed pre-baseline ETF table added this column without its
			// CHECK. Preserve that known layout; do not rebuild historical rows.
			if o.Name == "etf_allocations" && len(haveChecks) == 0 && len(wantChecks) == 1 && wantChecks[0] == "TACTICAL_STATUSIN('BUY','SELL')" {
				var invalid int
				if err := q.QueryRowContext(ctx, `SELECT COUNT(*) FROM etf_allocations WHERE tactical_status NOT IN ('BUY','SELL')`).Scan(&invalid); err != nil {
					return nil, false, err
				}
				if invalid == 0 {
					continue
				}
			}
			return nil, false, fmt.Errorf("unsupported upgrade: %s CHECK constraints differ; explicit migration required", o.Name)
		}
	}
	return plan, fresh, nil
}
