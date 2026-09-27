package portfoliomix

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

const MinimumApprovalMonths = 4

type ApprovalPolicy struct {
	MinimumMonths int        `json:"minimum_months"`
	CanApprove    bool       `json:"can_approve"`
	NextAllowedAt *time.Time `json:"next_allowed_at,omitempty"`
}

type ApprovalLockedError struct{ NextAllowedAt time.Time }

func (e *ApprovalLockedError) Error() string {
	return fmt.Sprintf("Portfolio shapes must remain in place for four calendar months. Next approval: %s.", e.NextAllowedAt.Format(time.RFC3339))
}

// Clamp month ends (31 October -> 28/29 February), rather than rolling into March.
func NextApprovalAt(approvedAt time.Time) time.Time {
	t := approvedAt.UTC()
	month := time.Date(t.Year(), t.Month()+MinimumApprovalMonths, 1, t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), time.UTC)
	lastDay := month.AddDate(0, 1, -1).Day()
	day := t.Day()
	if day > lastDay {
		day = lastDay
	}
	return month.AddDate(0, 0, day-1)
}

func Policy(approvedAt *time.Time, now time.Time) ApprovalPolicy {
	policy := ApprovalPolicy{MinimumMonths: MinimumApprovalMonths, CanApprove: true}
	if approvedAt != nil {
		next := NextApprovalAt(*approvedAt)
		policy.NextAllowedAt = &next
		policy.CanApprove = !now.Before(next)
	}
	return policy
}

func checkApprovalTx(ctx context.Context, tx *sql.Tx, now time.Time) error {
	var approved, created sql.NullTime
	err := tx.QueryRowContext(ctx, `SELECT approved_at, created_at FROM portfolio_mix_snapshots
		WHERE status IN ('APPROVED', 'SUPERSEDED') ORDER BY datetime(COALESCE(approved_at, created_at)) DESC, id DESC LIMIT 1`).Scan(&approved, &created)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	if !approved.Valid {
		approved = created
	}
	if !approved.Valid || approved.Time.IsZero() {
		return fmt.Errorf("previous approval date is unavailable; approval cannot be verified")
	}
	policy := Policy(&approved.Time, now)
	if !policy.CanApprove {
		return &ApprovalLockedError{NextAllowedAt: *policy.NextAllowedAt}
	}
	return nil
}
