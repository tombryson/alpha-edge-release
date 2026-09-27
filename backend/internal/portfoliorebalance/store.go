package portfoliorebalance

import (
	"context"
	"database/sql"
	"math"
	"strings"
	"time"
)

type PlanRow struct {
	AssetClass        string  `json:"asset_class"`
	DisplayName       string  `json:"display_name"`
	DisplayOrder      int     `json:"display_order"`
	GovernedByQ1      bool    `json:"governed_by_q1"`
	CurrentWeightPct  float64 `json:"current_weight_pct"`
	TargetWeightPct   float64 `json:"target_weight_pct"`
	DeltaWeightPct    float64 `json:"delta_weight_pct"`
	RecordedMoveValue float64 `json:"recorded_move_value,omitempty"`
	Note              string  `json:"note,omitempty"`
}

type Plan struct {
	ID               int64      `json:"id"`
	Status           string     `json:"status"`
	Driver           string     `json:"driver"`
	Title            string     `json:"title,omitempty"`
	Notes            string     `json:"notes,omitempty"`
	MemoJobID        string     `json:"memo_job_id,omitempty"`
	SourceSnapshotID *int64     `json:"source_snapshot_id,omitempty"`
	CreatedAt        *time.Time `json:"created_at,omitempty"`
	UpdatedAt        *time.Time `json:"updated_at,omitempty"`
	CompletedAt      *time.Time `json:"completed_at,omitempty"`
	ApprovedAt       *time.Time `json:"approved_at,omitempty"`
	Rows             []PlanRow  `json:"rows"`
}

type CreateInput struct {
	Driver           string
	Title            string
	Notes            string
	MemoJobID        string
	SourceSnapshotID *int64
	Rows             []PlanRow
}

type Store struct {
	DB *sql.DB
}

func (s Store) LoadCurrent(ctx context.Context) (*Plan, error) {
	row := s.DB.QueryRowContext(ctx, `
		SELECT p.id, p.status, p.driver, COALESCE(p.title, ''), COALESCE(p.notes, ''), COALESCE(p.memo_job_id, ''), p.source_snapshot_id, p.created_at, p.updated_at, p.completed_at, p.approved_at
		FROM portfolio_rebalance_plans p
		WHERE p.status IN ('OPEN','PARTIAL','COMPLETED')
		  AND EXISTS (
			SELECT 1
			FROM portfolio_rebalance_plan_rows r
			WHERE r.plan_id = p.id
			  AND ABS(COALESCE(r.target_weight_pct, 0) - COALESCE(r.current_weight_pct, 0)) > 0.05
		  )
		ORDER BY created_at DESC, id DESC
		LIMIT 1
	`)
	return s.loadPlan(ctx, row)
}

func (s Store) LoadByID(ctx context.Context, planID int64) (*Plan, error) {
	row := s.DB.QueryRowContext(ctx, `
		SELECT id, status, driver, COALESCE(title, ''), COALESCE(notes, ''), COALESCE(memo_job_id, ''), source_snapshot_id, created_at, updated_at, completed_at, approved_at
		FROM portfolio_rebalance_plans
		WHERE id = ?
		LIMIT 1
	`, planID)
	return s.loadPlan(ctx, row)
}

func (s Store) CreateOpen(ctx context.Context, input CreateInput) (*Plan, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if err := s.SupersedeActiveTx(ctx, tx); err != nil {
		return nil, err
	}

	var snapshotID any
	if input.SourceSnapshotID != nil {
		snapshotID = *input.SourceSnapshotID
	}
	result, err := tx.ExecContext(ctx, `
		INSERT INTO portfolio_rebalance_plans(status, driver, title, notes, memo_job_id, source_snapshot_id)
		VALUES ('OPEN', ?, ?, ?, ?, ?)
	`, strings.ToUpper(strings.TrimSpace(input.Driver)), strings.TrimSpace(input.Title), strings.TrimSpace(input.Notes), strings.TrimSpace(input.MemoJobID), snapshotID)
	if err != nil {
		return nil, err
	}
	planID, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}

	for _, row := range input.Rows {
		assetClass := strings.ToUpper(strings.TrimSpace(row.AssetClass))
		if assetClass == "" {
			continue
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO portfolio_rebalance_plan_rows(plan_id, asset_class, display_name, display_order, governed_by_q1, current_weight_pct, target_weight_pct, recorded_move_value, note)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, planID, assetClass, strings.TrimSpace(row.DisplayName), row.DisplayOrder, row.GovernedByQ1, row.CurrentWeightPct, row.TargetWeightPct, math.Max(0, row.RecordedMoveValue), strings.TrimSpace(row.Note)); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.LoadCurrent(ctx)
}

func (s Store) MarkPartial(ctx context.Context, planID int64) error {
	_, err := s.DB.ExecContext(ctx, `
		UPDATE portfolio_rebalance_plans
		SET status = 'PARTIAL', completed_at = NULL, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, planID)
	return err
}

func (s Store) Complete(ctx context.Context, planID int64, rows []PlanRow) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, item := range rows {
		assetClass := strings.ToUpper(strings.TrimSpace(item.AssetClass))
		if assetClass == "" {
			continue
		}
		note := strings.TrimSpace(item.Note)
		if _, err := tx.ExecContext(ctx, `
			UPDATE portfolio_rebalance_plan_rows
			SET recorded_move_value = ?, note = CASE WHEN ? != '' THEN ? ELSE note END
			WHERE plan_id = ? AND asset_class = ?
		`, math.Max(0, item.RecordedMoveValue), note, note, planID, assetClass); err != nil {
			return err
		}
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE portfolio_rebalance_plans
		SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, planID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s Store) SupersedeActiveTx(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, `
		UPDATE portfolio_rebalance_plans
		SET status = 'SUPERSEDED', updated_at = CURRENT_TIMESTAMP
		WHERE status IN ('OPEN','PARTIAL','COMPLETED')
	`)
	return err
}

func (s Store) ApproveTx(ctx context.Context, tx *sql.Tx, planID int64) error {
	_, err := tx.ExecContext(ctx, `
		UPDATE portfolio_rebalance_plans
		SET status = 'APPROVED', approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, planID)
	return err
}

func (s Store) loadPlan(ctx context.Context, row rowScanner) (*Plan, error) {
	var plan Plan
	var sourceSnapshotID sql.NullInt64
	var createdAt sql.NullTime
	var updatedAt sql.NullTime
	var completedAt sql.NullTime
	var approvedAt sql.NullTime
	if err := row.Scan(&plan.ID, &plan.Status, &plan.Driver, &plan.Title, &plan.Notes, &plan.MemoJobID, &sourceSnapshotID, &createdAt, &updatedAt, &completedAt, &approvedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if sourceSnapshotID.Valid {
		value := sourceSnapshotID.Int64
		plan.SourceSnapshotID = &value
	}
	if createdAt.Valid {
		value := createdAt.Time
		plan.CreatedAt = &value
	}
	if updatedAt.Valid {
		value := updatedAt.Time
		plan.UpdatedAt = &value
	}
	if completedAt.Valid {
		value := completedAt.Time
		plan.CompletedAt = &value
	}
	if approvedAt.Valid {
		value := approvedAt.Time
		plan.ApprovedAt = &value
	}

	rows, err := loadRows(ctx, s.DB, plan.ID)
	if err != nil {
		return nil, err
	}
	plan.Rows = rows
	return &plan, nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

type rowQuerier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

func loadRows(ctx context.Context, q rowQuerier, planID int64) ([]PlanRow, error) {
	rowsDb, err := q.QueryContext(ctx, `
		SELECT asset_class, display_name, display_order, governed_by_q1, current_weight_pct, target_weight_pct, COALESCE(recorded_move_value, 0), COALESCE(note, '')
		FROM portfolio_rebalance_plan_rows
		WHERE plan_id = ?
		ORDER BY display_order ASC, asset_class ASC
	`, planID)
	if err != nil {
		return nil, err
	}
	defer rowsDb.Close()

	rows := make([]PlanRow, 0)
	for rowsDb.Next() {
		var item PlanRow
		if err := rowsDb.Scan(&item.AssetClass, &item.DisplayName, &item.DisplayOrder, &item.GovernedByQ1, &item.CurrentWeightPct, &item.TargetWeightPct, &item.RecordedMoveValue, &item.Note); err != nil {
			return nil, err
		}
		item.DeltaWeightPct = item.TargetWeightPct - item.CurrentWeightPct
		rows = append(rows, item)
	}
	return rows, rowsDb.Err()
}
