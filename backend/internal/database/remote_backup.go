package database

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

type RemoteBackupConfig struct {
	Repository string
	Namespace  string
}

func (c RemoteBackupConfig) Validate() error {
	u, err := url.Parse(strings.TrimPrefix(c.Repository, "s3:"))
	if err != nil || !strings.HasPrefix(c.Repository, "s3:https://") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || len(strings.Trim(u.Path, "/")) == 0 {
		return fmt.Errorf("RESTIC_REPOSITORY must identify an HTTPS S3 bucket, without embedded credentials")
	}
	if !regexp.MustCompile(`^[a-zA-Z0-9_-]{1,80}$`).MatchString(c.Namespace) {
		return fmt.Errorf("BACKUP_NAMESPACE must identify this environment (letters, digits, hyphens, underscores)")
	}
	if len(os.Getenv("RESTIC_PASSWORD")) < 32 {
		return fmt.Errorf("RESTIC_PASSWORD must contain at least 32 characters and be stored offline")
	}
	return nil
}

type RemoteBackupResult struct {
	SnapshotID string `json:"snapshot_id"`
	SHA256     string `json:"sha256"`
	Integrity  string `json:"integrity"`
}

func resticCommand(ctx context.Context, c RemoteBackupConfig, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, "restic", append([]string{"--no-cache", "--repo", c.Repository}, args...)...)
	// Secrets stay in the environment; stderr can contain URLs and is never forwarded to the API/logs.
	cmd.Stderr = io.Discard
	return cmd
}

// BackupRemote does not initialise, prune or unlock repositories. These remain
// explicit operator actions. Restic provides encryption, authentication and deduplication.
func BackupRemote(ctx context.Context, source string, c RemoteBackupConfig) (RemoteBackupResult, error) {
	if err := c.Validate(); err != nil {
		return RemoteBackupResult{}, err
	}
	return backupRemote(ctx, source, c)
}

func backupRemote(ctx context.Context, source string, c RemoteBackupConfig) (result RemoteBackupResult, err error) {
	dir, err := os.MkdirTemp("", "alpha-edge-verified-backup-")
	if err != nil {
		return result, err
	}
	defer os.RemoveAll(dir)
	path := filepath.Join(dir, "database.db")
	report, err := Backup(ctx, source, path)
	if err != nil {
		return result, fmt.Errorf("local SQLite snapshot failed: %w", err)
	}
	file, err := os.Open(path)
	if err != nil {
		return result, err
	}
	defer file.Close()
	cmd := resticCommand(ctx, c, "backup", "--stdin", "--stdin-filename", "database.db", "--host", c.Namespace, "--tag", "alpha-edge-sqlite", "--json")
	cmd.Stdin = file
	output, err := cmd.Output()
	if err != nil {
		return result, fmt.Errorf("encrypted backup upload failed; check repository access and Restic configuration")
	}
	scanner := bufio.NewScanner(bytes.NewReader(output))
	for scanner.Scan() {
		var row struct {
			Type string `json:"message_type"`
			ID   string `json:"snapshot_id"`
		}
		if json.Unmarshal(scanner.Bytes(), &row) == nil && row.Type == "summary" {
			result.SnapshotID = row.ID
		}
	}
	if scanner.Err() != nil || !regexp.MustCompile(`^[0-9a-f]{8,64}$`).MatchString(result.SnapshotID) {
		return result, fmt.Errorf("backup upload did not return a snapshot ID")
	}
	// Download exactly this snapshot, not 'latest', into an isolated file.
	restoredPath := filepath.Join(dir, "restored.db")
	restored, err := os.OpenFile(restoredPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return result, err
	}
	download := resticCommand(ctx, c, "dump", result.SnapshotID, "/database.db")
	hash := sha256.New()
	download.Stdout = io.MultiWriter(restored, hash)
	err = download.Run()
	closeErr := restored.Close()
	if err != nil || closeErr != nil {
		return result, fmt.Errorf("backup uploaded but restore download failed")
	}
	result.SHA256 = hex.EncodeToString(hash.Sum(nil))
	if result.SHA256 != report.FileSHA256 {
		return result, fmt.Errorf("restored backup checksum differs from verified source snapshot")
	}
	restoredDB, err := Open(restoredPath, true)
	if err != nil {
		return result, err
	}
	defer restoredDB.Close()
	restoredReport, err := Inspect(ctx, restoredDB)
	if err != nil {
		return result, fmt.Errorf("restored SQLite verification failed: %w", err)
	}
	result.Integrity = restoredReport.Integrity
	return result, nil
}
