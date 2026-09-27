package main

import (
	"context"
	"testing"
	"time"
)

func TestBackupSchedulerDisabledAndFailureVisible(t *testing.T) {
	defer setupSecurityActionTestDB(t)()
	t.Setenv("ALPHA_EDGE_BACKUPS_ENABLED", "false")
	runScheduledBackup(context.Background(), "missing", time.Now().UTC())
	if status := readBackupStatus(); status.Enabled || status.State != "disabled" {
		t.Fatal(status)
	}
	t.Setenv("ALPHA_EDGE_BACKUPS_ENABLED", "true")
	t.Setenv("RESTIC_REPOSITORY", "")
	now := time.Now().UTC()
	runScheduledBackup(context.Background(), "missing", now)
	failed := readBackupStatus()
	if failed.State != "failed" || failed.Error == "" || !failed.LastSuccess.IsZero() {
		t.Fatal(failed)
	}
	runScheduledBackup(context.Background(), "missing", now.Add(time.Minute))
	if !readBackupStatus().LastAttempt.Equal(failed.LastAttempt) {
		t.Fatal("failure caused tight retry loop")
	}
}
