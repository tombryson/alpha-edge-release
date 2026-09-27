// dbtool operates on explicit SQLite files. It never starts HTTP or schedulers.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"time"

	"trading-backend/internal/database"
)

func run(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: dbtool inspect|plan|migrate|backup|restore --db FILE [--out NEW_FILE] [--backup-dir DIR]")
	}
	flags := flag.NewFlagSet(args[0], flag.ContinueOnError)
	path := flags.String("db", "", "explicit source database file (must exist)")
	out := flags.String("out", "", "new backup/restore file; existing destinations are refused")
	backups := flags.String("backup-dir", "", "required before upgrading an existing database")
	timeout := flags.Duration("timeout", 2*time.Minute, "maximum operation duration")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	if *path == "" || flags.NArg() != 0 || *timeout <= 0 {
		return fmt.Errorf("an explicit --db file and positive timeout are required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	var result any
	switch args[0] {
	case "backup", "restore":
		if *out == "" {
			return fmt.Errorf("--out must name a new file; in-place restore is not supported")
		}
		r, err := database.Backup(ctx, *path, *out)
		if err != nil {
			return err
		}
		result = r
	case "inspect", "plan", "migrate":
		db, err := database.Open(*path, args[0] != "migrate")
		if err != nil {
			return err
		}
		defer db.Close()
		switch args[0] {
		case "inspect":
			result, err = database.Inspect(ctx, db)
		case "plan":
			result, err = database.Preview(ctx, db)
		case "migrate":
			result, err = database.Migrate(ctx, db, database.Options{BackupDir: *backups})
		}
		if err != nil {
			return err
		}
	default:
		return fmt.Errorf("unknown command %q", args[0])
	}
	return json.NewEncoder(os.Stdout).Encode(result)
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
