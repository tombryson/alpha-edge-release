package database

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"github.com/mattn/go-sqlite3"
)

type Report struct {
	Path         string           `json:"path"`
	Integrity    string           `json:"integrity"`
	SchemaSHA256 string           `json:"schema_sha256"`
	FileSHA256   string           `json:"file_sha256,omitempty"`
	Tables       map[string]int64 `json:"table_counts"`
	Migrations   []Applied        `json:"migrations"`
}

// Open treats its input as a filename, not a caller-supplied SQLite URI.
func Open(path string, readOnly bool) (*sql.DB, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	mode := "rw"
	if readOnly {
		mode = "ro"
	}
	u := url.URL{Scheme: "file", Path: abs}
	params := url.Values{"mode": {mode}, "_busy_timeout": {"15000"}}
	u.RawQuery = params.Encode()
	db, err := sql.Open("sqlite3", u.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	return db, nil
}

func integrity(ctx context.Context, q querier) error {
	rows, err := q.QueryContext(ctx, "PRAGMA quick_check")
	if err != nil {
		return err
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var result string
		if err := rows.Scan(&result); err != nil {
			return err
		}
		if result != "ok" {
			return fmt.Errorf("SQLite integrity check failed: %s", result)
		}
		count++
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if count != 1 {
		return fmt.Errorf("SQLite integrity check returned no result")
	}
	return nil
}

func Inspect(ctx context.Context, db *sql.DB) (Report, error) {
	conn, err := db.Conn(ctx)
	if err != nil {
		return Report{}, err
	}
	defer conn.Close()
	if _, err = conn.ExecContext(ctx, "BEGIN"); err != nil {
		return Report{}, err
	}
	defer conn.ExecContext(context.Background(), "ROLLBACK")
	return inspectFrom(ctx, conn)
}

func inspectFrom(ctx context.Context, q querier) (Report, error) {
	r := Report{Tables: map[string]int64{}}
	if err := integrity(ctx, q); err != nil {
		return r, err
	}
	r.Integrity = "ok"
	objects, err := objects(ctx, q)
	if err != nil {
		return r, err
	}
	hash := sha256.New()
	for _, o := range objects {
		fmt.Fprintf(hash, "%s\n%s\n%s\n", o.Kind, o.Name, o.SQL)
		if o.Kind == "table" {
			var count int64
			if err := q.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+ident(o.Name)).Scan(&count); err != nil {
				return r, err
			}
			r.Tables[o.Name] = count
		}
	}
	r.SchemaSHA256 = hex.EncodeToString(hash.Sum(nil))
	r.Migrations, err = applied(ctx, q)
	return r, err
}

// Backup uses SQLite's online API, including committed WAL pages. It only
// publishes a validated standalone file and never overwrites a destination.
func Backup(ctx context.Context, source, destination string) (report Report, err error) {
	src, err := Open(source, true)
	if err != nil {
		return report, err
	}
	defer src.Close()
	if _, err = os.Lstat(destination); err == nil {
		return report, fmt.Errorf("destination already exists: %s", destination)
	} else if !os.IsNotExist(err) {
		return report, err
	}
	parent := filepath.Dir(destination)
	tmp, err := os.CreateTemp(parent, ".alpha-edge-backup-*.db")
	if err != nil {
		return report, err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err = tmp.Close(); err != nil {
		return report, err
	}
	dest, err := Open(tmpPath, false)
	if err != nil {
		return report, err
	}
	defer dest.Close()
	srcConn, err := src.Conn(ctx)
	if err != nil {
		return report, err
	}
	defer srcConn.Close()
	destConn, err := dest.Conn(ctx)
	if err != nil {
		return report, err
	}
	err = destConn.Raw(func(rawDest any) error {
		return srcConn.Raw(func(rawSrc any) error {
			d, ok := rawDest.(*sqlite3.SQLiteConn)
			if !ok {
				return fmt.Errorf("unsupported backup destination driver")
			}
			s, ok := rawSrc.(*sqlite3.SQLiteConn)
			if !ok {
				return fmt.Errorf("unsupported backup source driver")
			}
			backup, err := d.Backup("main", s, "main")
			if err != nil {
				return err
			}
			for {
				if err = ctx.Err(); err != nil {
					backup.Finish()
					return err
				}
				done, stepErr := backup.Step(256)
				if stepErr != nil {
					backup.Finish()
					return stepErr
				}
				if done {
					return backup.Finish()
				}
				select {
				case <-ctx.Done():
					backup.Finish()
					return ctx.Err()
				case <-time.After(time.Millisecond):
				}
			}
		})
	})
	destConn.Close()
	if err != nil {
		return report, err
	}
	// A backup must remain readable without the source WAL or sidecar files.
	if _, err = dest.ExecContext(ctx, "PRAGMA journal_mode=DELETE"); err != nil {
		return report, err
	}
	report, err = Inspect(ctx, dest)
	if err != nil {
		return report, err
	}
	if err = dest.Close(); err != nil {
		return report, err
	}
	f, err := os.OpenFile(tmpPath, os.O_RDWR, 0600)
	if err != nil {
		return report, err
	}
	hash := sha256.New()
	_, err = io.Copy(hash, f)
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return report, err
	}
	if closeErr != nil {
		return report, closeErr
	}
	report.Path = destination
	report.FileSHA256 = hex.EncodeToString(hash.Sum(nil))
	// Link is an atomic no-clobber publication on the destination filesystem.
	if err = os.Link(tmpPath, destination); err != nil {
		return report, err
	}
	dir, err := os.Open(parent)
	if err != nil {
		return report, err
	}
	defer dir.Close()
	if err = dir.Sync(); err != nil {
		return report, err
	}
	return report, nil
}
