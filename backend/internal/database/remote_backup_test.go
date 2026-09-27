package database

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRemoteBackupRejectsLocalAndUnsafeConfig(t *testing.T) {
	t.Setenv("RESTIC_PASSWORD", strings.Repeat("x", 32))
	for _, repository := range []string{"/data/backups", "s3:http://storage/bucket", "s3:https://user:secret@storage/bucket", "s3:https://storage", "s3:https://storage/bucket#fragment"} {
		if (RemoteBackupConfig{Repository: repository, Namespace: "uat"}).Validate() == nil {
			t.Fatalf("accepted unsafe repository %s", repository)
		}
	}
	if err := (RemoteBackupConfig{Repository: "s3:https://t3.storage.dev/private-bucket/uat", Namespace: "uat"}).Validate(); err != nil {
		t.Fatal(err)
	}
	t.Setenv("RESTIC_PASSWORD", "short")
	if (RemoteBackupConfig{Repository: "s3:https://t3.storage.dev/bucket", Namespace: "uat"}).Validate() == nil {
		t.Fatal("weak/missing password accepted")
	}
}

func TestRemoteBackupEncryptedRoundTrip(t *testing.T) {
	if _, err := exec.LookPath("restic"); err != nil {
		if os.Getenv("CI") != "" {
			t.Fatal("release CI requires Restic for encrypted restore verification")
		}
		t.Skip("restic is required; installed in release CI")
	}
	t.Setenv("RESTIC_PASSWORD", "synthetic-test-password-never-use-in-production")
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	db, path := testDB(t)
	if _, err := Migrate(ctx, db, options(t)); err != nil {
		t.Fatal(err)
	}
	execute(t, db, `INSERT INTO settings(key,value) VALUES('backup-sentinel','PRIVATE_BACKUP_SENTINEL')`)
	c := RemoteBackupConfig{Repository: filepath.Join(t.TempDir(), "encrypted-repo"), Namespace: "test"}
	if err := resticCommand(ctx, c, "init").Run(); err != nil {
		t.Fatal(err)
	}
	// The production entry point refuses local storage. Only this isolated test bypasses that validation.
	result, err := backupRemote(ctx, path, c)
	if err != nil || result.Integrity != "ok" || len(result.SHA256) != 64 {
		t.Fatalf("restore not verified: %+v %v", result, err)
	}
	err = filepath.Walk(c.Repository, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		raw, err := os.ReadFile(path)
		if strings.Contains(string(raw), "PRIVATE_BACKUP_SENTINEL") {
			t.Fatalf("plaintext financial data found in repository")
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("RESTIC_PASSWORD", "wrong-key")
	if _, err := backupRemote(ctx, path, c); err == nil {
		t.Fatal("wrong encryption key succeeded")
	}
}
