package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"sort"
	"strconv"

	"github.com/gorilla/mux"
)

func preserveLegacyStatementTx(tx *sql.Tx, statementID int64) error {
	_, err := tx.Exec(`INSERT INTO statement_revisions(statement_id, revision, source, snapshot_json)
		SELECT statement_id, 1, 'legacy_snapshot', snapshot_json FROM statement_evidence_snapshot
		WHERE statement_id = ? AND NOT EXISTS (SELECT 1 FROM statement_revisions WHERE statement_id = ?)`, statementID, statementID)
	return err
}

func recordStatementRevisionTx(tx *sql.Tx, statementID int64, payload StatementImport) (int64, error) {
	// Row order in the broker document does not make an otherwise identical import a correction.
	payload.Holdings = append([]StatementHolding{}, payload.Holdings...)
	sort.Slice(payload.Holdings, func(i, j int) bool { return payload.Holdings[i].Details < payload.Holdings[j].Details })
	raw, err := json.Marshal(payload)
	if err != nil {
		return 0, err
	}
	digest := sha256.Sum256(raw)
	hash := hex.EncodeToString(digest[:])
	var id int64
	var previous sql.NullString
	err = tx.QueryRow(`SELECT id, payload_sha256 FROM statement_revisions WHERE statement_id = ? ORDER BY revision DESC LIMIT 1`, statementID).Scan(&id, &previous)
	if err != nil && err != sql.ErrNoRows {
		return 0, err
	}
	if previous.Valid && previous.String == hash {
		return id, nil
	}
	result, err := tx.Exec(`INSERT INTO statement_revisions(statement_id, revision, source, payload_sha256, accepted_payload_json, snapshot_json)
		SELECT statement_id, (SELECT COALESCE(MAX(revision), 0) + 1 FROM statement_revisions WHERE statement_id = ?),
		'import', ?, ?, snapshot_json FROM statement_evidence_snapshot WHERE statement_id = ?`, statementID, hash, string(raw), statementID)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

// The existing statement endpoint remains the latest corrected projection.
// Revision reads are authenticated by the same router, with bounded metadata pages.
func getStatementRevisions(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(mux.Vars(r)["id"], 10, 64)
	if err != nil || id <= 0 {
		http.Error(w, "Invalid statement id", 400)
		return
	}
	before := int64(1<<63 - 1)
	if value := r.URL.Query().Get("before"); value != "" {
		before, err = strconv.ParseInt(value, 10, 64)
		if err != nil || before <= 0 {
			http.Error(w, "Invalid revision cursor", 400)
			return
		}
	}
	rows, err := db.Query(`SELECT id, revision, source, recorded_at, payload_sha256 FROM statement_revisions WHERE statement_id = ? AND revision < ? ORDER BY revision DESC LIMIT 100`, id, before)
	if err != nil {
		http.Error(w, "Unable to read statement revisions", 500)
		return
	}
	defer rows.Close()
	items := []map[string]interface{}{}
	for rows.Next() {
		var revisionID int64
		var revision int
		var source, recorded string
		var hash sql.NullString
		if err := rows.Scan(&revisionID, &revision, &source, &recorded, &hash); err != nil {
			http.Error(w, "Unable to read statement revision", 500)
			return
		}
		items = append(items, map[string]interface{}{"id": revisionID, "revision": revision, "source": source, "recorded_at": recorded, "payload_sha256": hash.String})
	}
	if rows.Err() != nil {
		http.Error(w, "Unable to read statement revisions", 500)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"statement_id": id, "revisions": items})
}

func getStatementRevision(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, err := strconv.ParseInt(vars["id"], 10, 64)
	revision, revisionErr := strconv.Atoi(vars["revision"])
	if err != nil || revisionErr != nil || id <= 0 || revision <= 0 {
		http.Error(w, "Invalid statement revision", 400)
		return
	}
	var snapshot string
	var payload sql.NullString
	var source, recorded string
	err = db.QueryRow(`SELECT snapshot_json, accepted_payload_json, source, recorded_at FROM statement_revisions WHERE statement_id = ? AND revision = ?`, id, revision).Scan(&snapshot, &payload, &source, &recorded)
	if err == sql.ErrNoRows {
		http.Error(w, "Statement revision not found", 404)
		return
	}
	if err != nil {
		http.Error(w, "Unable to read statement revision", 500)
		return
	}
	var accepted json.RawMessage
	if payload.Valid {
		accepted = json.RawMessage(payload.String)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"statement_id": id, "revision": revision, "source": source, "recorded_at": recorded, "snapshot": json.RawMessage(snapshot), "accepted_payload": accepted})
}
