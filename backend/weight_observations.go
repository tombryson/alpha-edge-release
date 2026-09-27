package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

// Import corrections can replace rows without changing the statement ID.
func weightStatementFingerprint(reader actionQueryReader, id int64) (string, error) {
	var raw string
	err := reader.QueryRow(`SELECT json_object('date',statement_date,'total',total_value_aud,'cash',cash_aud,
		'holdings',(SELECT json_group_array(json_object('name',details,'security',security_id,'units',quantity,
		'value',value_aud,'price',current_price,'currency',currency)) FROM
		(SELECT * FROM statement_holdings WHERE statement_id=account_statements.id ORDER BY details,security_id,id)))
		FROM account_statements WHERE id=?`, id).Scan(&raw)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", sha256.Sum256([]byte(raw))), nil
}

func invalidateCorrectedWeightObservations(tx *sql.Tx, epoch int) error {
	rows, err := tx.Query(`SELECT subject,observed_date,evidence_json FROM weight_observations WHERE epoch=? AND qualifies=1 AND observed_date>=date('now','-8 days')`, epoch)
	if err != nil {
		return err
	}
	type observation struct {
		subject, date string
		ref           weightReference
	}
	var observations []observation
	for rows.Next() {
		var item observation
		var raw string
		if err = rows.Scan(&item.subject, &item.date, &raw); err == nil {
			err = json.Unmarshal([]byte(raw), &item.ref)
		}
		if err != nil {
			rows.Close()
			return err
		}
		observations = append(observations, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	fingerprints := map[int64]string{}
	for _, item := range observations {
		fingerprint, ok := fingerprints[item.ref.StatementID]
		if !ok {
			fingerprint, err = weightStatementFingerprint(tx, item.ref.StatementID)
			if err != nil && err != sql.ErrNoRows {
				return err
			}
			fingerprints[item.ref.StatementID] = fingerprint
		}
		if fingerprint == item.ref.StatementFingerprint {
			continue
		}
		// Preserve the historical model inputs, but do not use corrected evidence
		// to authorise a sale or to re-arm a dismissed breach.
		_, err = tx.Exec(`UPDATE weight_observations SET qualifies=0,
			evidence_json=json_set(evidence_json,'$.fresh',json('false'),'$.reason','Statement corrected')
			WHERE epoch=? AND subject=? AND observed_date=?`, epoch, item.subject, item.date)
		if err != nil {
			return err
		}
	}
	return nil
}

func weightObservationsConfirmed(reader deploymentReader, epoch int, subject, after string) (bool, error) {
	rows, err := reader.Query(`SELECT observed_date,qualifies FROM weight_observations
		WHERE epoch=? AND subject=? AND observed_date>? ORDER BY observed_date DESC LIMIT 2`, epoch, subject, after)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	var dates []time.Time
	valid := true
	for rows.Next() {
		var date string
		var qualifies bool
		if err = rows.Scan(&date, &qualifies); err != nil {
			return false, err
		}
		stamp, parseErr := time.Parse("2006-01-02", date)
		valid = valid && qualifies && parseErr == nil
		dates = append(dates, stamp)
	}
	return valid && len(dates) == 2 && dates[0].Sub(dates[1]) <= 4*24*time.Hour, rows.Err()
}
