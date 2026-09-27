package database

import (
	"context"
	"crypto/sha256"
	"database/sql"
	_ "embed"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// The old schema_migrations table seen on UAT belongs to an absent historical
// runner. Preserve it as evidence; do not reinterpret its unrelated versions.
const ledgerTable = "terminal_schema_migrations"

//go:embed migrations/0001_baseline.sql
var baselineSQL string

//go:embed migrations/0001_fresh_defaults.sql
var freshDefaultsSQL string

//go:embed migrations/0003_source_research.sql
var sourceResearchSQL string

//go:embed migrations/0004_owner_sessions.sql
var ownerSessionsSQL string

//go:embed migrations/0005_weight_management.sql
var weightManagementSQL string

//go:embed migrations/0006_announcement_subscriptions.sql
var announcementSubscriptionsSQL string

//go:embed migrations/0007_statement_revisions.sql
var statementRevisionsSQL string

type migration struct {
	Version       int
	Name, Content string
	Apply         func(context.Context, querier) error
}
type Applied struct {
	Version      int    `json:"version"`
	Name         string `json:"name"`
	Checksum     string `json:"checksum"`
	AppliedAt    string `json:"applied_at"`
	BackupPath   string `json:"backup_path,omitempty"`
	BackupSHA256 string `json:"backup_sha256,omitempty"`
}
type Plan struct {
	Fresh          bool     `json:"fresh"`
	CurrentVersion int      `json:"current_version"`
	Pending        []string `json:"pending"`
	Statements     int      `json:"statement_count"`
}
type Options struct{ BackupDir string }

func migrations() []migration {
	return []migration{{1, "baseline_2026_09_12", baselineSQL + "\n-- fresh defaults --\n" + freshDefaultsSQL, func(ctx context.Context, q querier) error {
		// The exact pre-runner production layout is adopted atomically by v2.
		// Do not alter the shipped v1 content/checksum or replay fresh defaults.
		if known, err := productionLegacySchema(ctx, q); err != nil || known {
			return err
		}
		statements, fresh, err := baselinePlan(ctx, q)
		if err != nil {
			return err
		}
		for _, statement := range statements {
			if _, err := q.ExecContext(ctx, statement); err != nil {
				return fmt.Errorf("baseline schema change failed: %w", err)
			}
		}
		if fresh {
			if _, err := q.ExecContext(ctx, freshDefaultsSQL); err != nil {
				return fmt.Errorf("fresh defaults: %w", err)
			}
		}
		return nil
	}}, productionLegacyMigration(), {3, "source_research_jobs", sourceResearchSQL, func(ctx context.Context, q querier) error {
		_, err := q.ExecContext(ctx, sourceResearchSQL)
		return err
	}}, {4, "owner_sessions", ownerSessionsSQL, func(ctx context.Context, q querier) error {
		_, err := q.ExecContext(ctx, ownerSessionsSQL)
		return err

	}}, {5, "weight_management", weightManagementSQL, func(ctx context.Context, q querier) error {
		_, err := q.ExecContext(ctx, weightManagementSQL)
		return err
	}}, {6, "announcement_subscriptions", announcementSubscriptionsSQL, func(ctx context.Context, q querier) error {
		_, err := q.ExecContext(ctx, announcementSubscriptionsSQL)
		return err
	}}, {7, "statement_revisions", statementRevisionsSQL, func(ctx context.Context, q querier) error {
		_, err := q.ExecContext(ctx, statementRevisionsSQL)
		return err
	}}}
}

func checksum(m migration) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%d\n%s\n%s", m.Version, m.Name, m.Content)))
	return hex.EncodeToString(sum[:])
}

func applied(ctx context.Context, q querier) ([]Applied, error) {
	var exists int
	if err := q.QueryRowContext(ctx, "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?", ledgerTable).Scan(&exists); err != nil {
		return nil, err
	}
	out := []Applied{}
	if exists == 0 {
		return out, nil
	}
	rows, err := q.QueryContext(ctx, "SELECT version,name,checksum,applied_at,backup_path,backup_sha256 FROM "+ledgerTable+" ORDER BY version")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var a Applied
		if err := rows.Scan(&a.Version, &a.Name, &a.Checksum, &a.AppliedAt, &a.BackupPath, &a.BackupSHA256); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func pending(ctx context.Context, q querier, list []migration) ([]migration, int, error) {
	for i, m := range list {
		if m.Version != i+1 || m.Name == "" || m.Apply == nil {
			return nil, 0, fmt.Errorf("invalid migration sequence at %d", i+1)
		}
	}
	done, err := applied(ctx, q)
	if err != nil {
		return nil, 0, err
	}
	if len(done) > len(list) {
		return nil, 0, fmt.Errorf("database schema is newer than this binary; refusing downgrade")
	}
	for i, a := range done {
		m := list[i]
		if a.Version != m.Version || a.Name != m.Name || a.Checksum != checksum(m) {
			return nil, 0, fmt.Errorf("migration %d history/checksum mismatch; restore matching application version", a.Version)
		}
	}
	return list[len(done):], len(done), nil
}

func Preview(ctx context.Context, db *sql.DB) (Plan, error) {
	return preview(ctx, db, migrations())
}

func preview(ctx context.Context, db *sql.DB, list []migration) (Plan, error) {
	conn, err := db.Conn(ctx)
	if err != nil {
		return Plan{}, err
	}
	defer conn.Close()
	if _, err = conn.ExecContext(ctx, "BEGIN"); err != nil {
		return Plan{}, err
	}
	defer conn.ExecContext(context.Background(), "ROLLBACK")
	return previewFrom(ctx, conn, list)
}

func previewFrom(ctx context.Context, q querier, list []migration) (Plan, error) {
	waiting, current, err := pending(ctx, q, list)
	if err != nil {
		return Plan{}, err
	}
	p := Plan{CurrentVersion: current, Pending: []string{}}
	if current == 0 && len(list) >= 2 && checksum(list[1]) == checksum(productionLegacyMigration()) {
		known, err := productionLegacySchema(ctx, q)
		if err != nil {
			return p, err
		}
		if known {
			p.Statements = 36 // 14 tables, 8 columns, 14 indexes; catalogue rows are separate.
			for _, m := range waiting {
				p.Pending = append(p.Pending, fmt.Sprintf("%04d_%s", m.Version, m.Name))
			}
			return p, nil
		}
	}
	statements, fresh, err := baselinePlan(ctx, q)
	if err != nil {
		return p, err
	}
	p.Fresh = fresh
	p.Statements = len(statements)
	if current > 0 && len(statements) > 0 {
		return p, fmt.Errorf("recorded schema is incomplete; restore or repair explicitly")
	}
	for _, m := range waiting {
		p.Pending = append(p.Pending, fmt.Sprintf("%04d_%s", m.Version, m.Name))
	}
	return p, nil
}

func Migrate(ctx context.Context, db *sql.DB, options Options) (Plan, error) {
	return migrate(ctx, db, options, migrations())
}

func migrate(ctx context.Context, db *sql.DB, options Options, list []migration) (Plan, error) {
	// Already-current replicas need no write lock. Pending upgrades are checked
	// again under the primary's write reservation, including concurrent startup.
	p, err := preview(ctx, db, list)
	if err != nil || len(p.Pending) == 0 {
		return p, err
	}
	conn, err := db.Conn(ctx)
	if err != nil {
		return Plan{}, err
	}
	defer conn.Close()
	// One dedicated SQLite connection owns the lock, every DDL statement and
	// the ledger write. A failure or process death cannot leave half an upgrade.
	if _, err = conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		return Plan{}, err
	}
	defer conn.ExecContext(context.Background(), "ROLLBACK")
	p, err = previewFrom(ctx, conn, list)
	if err != nil {
		return p, err
	}
	if len(p.Pending) == 0 {
		return p, nil
	}
	if err = integrity(ctx, conn); err != nil {
		return p, err
	}
	backup := Report{}
	if !p.Fresh {
		if options.BackupDir == "" {
			return p, fmt.Errorf("existing database upgrade requires a backup directory")
		}
		rows, err := conn.QueryContext(ctx, "PRAGMA database_list")
		if err != nil {
			return p, err
		}
		var source string
		for rows.Next() {
			var seq int
			var name, path string
			if err := rows.Scan(&seq, &name, &path); err != nil {
				rows.Close()
				return p, err
			}
			if name == "main" {
				source = path
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return p, err
		}
		if source == "" {
			return p, fmt.Errorf("existing database must be file-backed for verified pre-upgrade backup")
		}
		if err = os.MkdirAll(options.BackupDir, 0700); err != nil {
			return p, err
		}
		out := filepath.Join(options.BackupDir, fmt.Sprintf("pre-v%04d-%s.db", len(list), time.Now().UTC().Format("20060102T150405.000000000Z")))
		// A second read connection sees the committed pre-upgrade database while
		// our write reservation prevents other writers changing that snapshot.
		backup, err = Backup(ctx, source, out)
		if err != nil {
			return p, fmt.Errorf("pre-upgrade backup: %w", err)
		}
	}
	if _, err = conn.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS terminal_schema_migrations (
		version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL,
		applied_at TEXT NOT NULL, backup_path TEXT NOT NULL DEFAULT '', backup_sha256 TEXT NOT NULL DEFAULT ''
	)`); err != nil {
		return p, err
	}
	for _, m := range list[p.CurrentVersion:] {
		if err = m.Apply(ctx, conn); err != nil {
			return p, fmt.Errorf("migration %04d %s: %w", m.Version, m.Name, err)
		}
		if _, err = conn.ExecContext(ctx, `INSERT INTO terminal_schema_migrations(version,name,checksum,applied_at,backup_path,backup_sha256) VALUES(?,?,?,?,?,?)`, m.Version, m.Name, checksum(m), time.Now().UTC().Format(time.RFC3339Nano), backup.Path, backup.FileSHA256); err != nil {
			return p, err
		}
	}
	if err = integrity(ctx, conn); err != nil {
		return p, err
	}
	if _, err = conn.ExecContext(ctx, "COMMIT"); err != nil {
		return p, err
	}
	return p, nil
}
