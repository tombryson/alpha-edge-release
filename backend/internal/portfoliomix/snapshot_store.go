package portfoliomix

import (
	"context"
	"database/sql"
	"strings"
	"time"
)

type SnapshotMeta struct {
	ID                    int64
	Status                string
	Reason                string
	SourceRebalancePlanID *int64
	Notes                 string
	ApprovedAt            *time.Time
	CreatedAt             *time.Time
}

type CreateSnapshotInput struct {
	Reason       string
	SourcePlanID *int64
	Notes        string
	Rows         []Row
}

type Store struct {
	DB  *sql.DB
	Now func() time.Time
}

func (s Store) LoadLatestApproved(ctx context.Context) (*SnapshotMeta, []Row, error) {
	row := s.DB.QueryRowContext(ctx, `
		SELECT id, status, COALESCE(reason, ''), source_rebalance_plan_id, COALESCE(notes, ''), approved_at, created_at
		FROM portfolio_mix_snapshots
		WHERE status = 'APPROVED'
		ORDER BY approved_at DESC, id DESC
		LIMIT 1
	`)

	snapshot, err := scanSnapshotMeta(row)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, []Row{}, nil
		}
		return nil, nil, err
	}

	rows, err := s.loadRows(ctx, s.DB, snapshot.ID)
	if err != nil {
		return nil, nil, err
	}
	return snapshot, rows, nil
}

func (s Store) LoadByIDTx(ctx context.Context, tx *sql.Tx, snapshotID int64) (*SnapshotMeta, []Row, error) {
	row := tx.QueryRowContext(ctx, `
		SELECT id, status, COALESCE(reason, ''), source_rebalance_plan_id, COALESCE(notes, ''), approved_at, created_at
		FROM portfolio_mix_snapshots
		WHERE id = ?
	`, snapshotID)

	snapshot, err := scanSnapshotMeta(row)
	if err != nil {
		return nil, nil, err
	}

	rows, err := s.loadRows(ctx, tx, snapshot.ID)
	if err != nil {
		return nil, nil, err
	}
	return snapshot, rows, nil
}

func (s Store) LoadByID(ctx context.Context, snapshotID int64) (*SnapshotMeta, []Row, error) {
	row := s.DB.QueryRowContext(ctx, `
		SELECT id, status, COALESCE(reason, ''), source_rebalance_plan_id, COALESCE(notes, ''), approved_at, created_at
		FROM portfolio_mix_snapshots
		WHERE id = ?
	`, snapshotID)

	snapshot, err := scanSnapshotMeta(row)
	if err != nil {
		return nil, nil, err
	}

	rows, err := s.loadRows(ctx, s.DB, snapshot.ID)
	if err != nil {
		return nil, nil, err
	}
	return snapshot, rows, nil
}

func (s Store) CreateApprovedTx(ctx context.Context, tx *sql.Tx, input CreateSnapshotInput) (*SnapshotMeta, []Row, error) {
	now := time.Now().UTC()
	if s.Now != nil {
		now = s.Now().UTC()
	}
	if err := checkApprovalTx(ctx, tx, now); err != nil {
		return nil, nil, err
	}
	reason := strings.TrimSpace(input.Reason)
	if reason == "" {
		reason = "DISCRETIONARY"
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE portfolio_mix_snapshots
		SET status = 'SUPERSEDED'
		WHERE status = 'APPROVED'
	`); err != nil {
		return nil, nil, err
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO portfolio_mix_snapshots(status, reason, source_rebalance_plan_id, notes, approved_at)
		VALUES ('APPROVED', ?, ?, ?, ?)
	`, reason, input.SourcePlanID, strings.TrimSpace(input.Notes), now)
	if err != nil {
		return nil, nil, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, nil, err
	}

	for _, row := range input.Rows {
		if row.WeightPct < 0 {
			continue
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO portfolio_mix_snapshot_rows(snapshot_id, asset_class, display_name, display_order, governed_by_q1, weight_pct)
			VALUES (?, ?, ?, ?, ?, ?)
		`, id, row.AssetClass, row.DisplayName, row.DisplayOrder, row.GovernedByQ1, row.WeightPct); err != nil {
			return nil, nil, err
		}
	}

	return s.LoadByIDTx(ctx, tx, id)
}

type rowScanner interface {
	Scan(dest ...any) error
}

type rowQuerier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

func scanSnapshotMeta(row rowScanner) (*SnapshotMeta, error) {
	var snapshot SnapshotMeta
	var sourcePlanID sql.NullInt64
	var approvedAt sql.NullTime
	var createdAt sql.NullTime
	if err := row.Scan(&snapshot.ID, &snapshot.Status, &snapshot.Reason, &sourcePlanID, &snapshot.Notes, &approvedAt, &createdAt); err != nil {
		return nil, err
	}
	if sourcePlanID.Valid {
		value := sourcePlanID.Int64
		snapshot.SourceRebalancePlanID = &value
	}
	if approvedAt.Valid {
		value := approvedAt.Time
		snapshot.ApprovedAt = &value
	}
	if createdAt.Valid {
		value := createdAt.Time
		snapshot.CreatedAt = &value
	}
	return &snapshot, nil
}

func (s Store) loadRows(ctx context.Context, querier rowQuerier, snapshotID int64) ([]Row, error) {
	rowsDb, err := querier.QueryContext(ctx, `
		SELECT asset_class, display_name, display_order, governed_by_q1, weight_pct
		FROM portfolio_mix_snapshot_rows
		WHERE snapshot_id = ?
		ORDER BY display_order ASC, weight_pct DESC, asset_class ASC
	`, snapshotID)
	if err != nil {
		return nil, err
	}
	defer rowsDb.Close()

	rows := make([]Row, 0)
	for rowsDb.Next() {
		var item Row
		if err := rowsDb.Scan(&item.AssetClass, &item.DisplayName, &item.DisplayOrder, &item.GovernedByQ1, &item.WeightPct); err != nil {
			return nil, err
		}
		rows = append(rows, item)
	}
	if err := rowsDb.Err(); err != nil {
		return nil, err
	}
	return rows, nil
}
