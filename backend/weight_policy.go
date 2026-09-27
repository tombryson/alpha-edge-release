package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"
)

type weightPolicyResponse struct {
	weightPolicyMode
	Version string            `json:"version"`
	Targets []weightReference `json:"targets"`
	Error   string            `json:"error,omitempty"`
}

func getWeightPolicy(w http.ResponseWriter, r *http.Request) {
	mode, err := readWeightPolicy(db)
	if err != nil {
		http.Error(w, "Weight policy unavailable", 503)
		return
	}
	response := weightPolicyResponse{weightPolicyMode: mode, Version: weightPolicyVersion, Targets: []weightReference{}}
	capacities, err := deploymentClassCapacities()
	if err == nil {
		var refs map[string]weightReference
		refs, err = weightReferencesFrom(db, capacities, "")
		for _, ref := range refs {
			ref.Inputs = nil
			response.Targets = append(response.Targets, ref)
		}
		sort.Slice(response.Targets, func(i, j int) bool { return response.Targets[i].Ticker < response.Targets[j].Ticker })
	}
	if err != nil {
		response.Error = "Holdings or allocation evidence unavailable"
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func updateWeightPolicy(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Enabled *bool `json:"enabled"`
		Epoch   *int  `json:"epoch"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&body) != nil || body.Enabled == nil || body.Epoch == nil || *body.Epoch < 0 {
		http.Error(w, "enabled and epoch are required", 400)
		return
	}
	if decoder.Decode(new(any)) != io.EOF {
		http.Error(w, "Only one JSON object is allowed", 400)
		return
	}
	deploymentFundingMu.Lock()
	tx, err := db.Begin()
	if err != nil {
		deploymentFundingMu.Unlock()
		http.Error(w, err.Error(), 500)
		return
	}
	defer tx.Rollback()
	mode, err := readWeightPolicy(tx)
	if err == nil && mode.Epoch != *body.Epoch {
		tx.Rollback()
		deploymentFundingMu.Unlock()
		http.Error(w, "Weight management changed on another device; refresh before changing it", 409)
		return
	}
	if err == nil && mode.Enabled != *body.Enabled {
		_, err = tx.Exec(`UPDATE weight_policy SET enabled=?, epoch=epoch+1, changed_at=CURRENT_TIMESTAMP WHERE id=1`, *body.Enabled)
		if err == nil {
			reason := "Weight management switched off"
			if *body.Enabled {
				reason = "Weight management restarted"
			}
			err = closeWeightActions(tx, reason, "")
		}
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		tx.Rollback()
	}
	deploymentFundingMu.Unlock()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	// Reproject immediately, but never clear an execution awaiting a statement.
	if err = projectOpenDeploymentActions(); err != nil {
		log.Printf("[WEIGHT] Projection after mode change: %v", err)
	}
	getWeightPolicy(w, r)
}

func closeWeightActions(tx *sql.Tx, reason, subject string) error {
	_, err := tx.Exec(`UPDATE weight_action_evidence SET closed_reason=? WHERE (?='' OR subject=?)
		AND action_id IN (SELECT id FROM security_actions WHERE status IN ('OPEN','BLOCKED'))`, reason, subject, subject)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`UPDATE alerts SET is_active=0,resolved_at=CURRENT_TIMESTAMP,resolved_reason='WEIGHT_POLICY_CLOSED',resolved_note=?
		WHERE id IN (SELECT sa.alert_id FROM security_actions sa JOIN weight_action_evidence e ON e.action_id=sa.id
		WHERE (?='' OR e.subject=?) AND sa.status IN ('OPEN','BLOCKED'))`, reason, subject, subject)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`UPDATE security_actions SET status='NOT_APPLICABLE', blocked_by_action_id=NULL, updated_at=CURRENT_TIMESTAMP
		WHERE status IN ('OPEN','BLOCKED') AND id IN (SELECT action_id FROM weight_action_evidence WHERE (?='' OR subject=?))`, subject, subject)
	return err
}

func attachWeightActionEvidence(reader fundingReader, action *SecurityAction) error {
	if action.AlertType != "WEIGHT_REDUCE" && action.AlertType != "WEIGHT_CLASS_REVIEW" {
		return nil
	}
	var raw string
	err := reader.QueryRow(`SELECT evidence_json,closed_reason FROM weight_action_evidence WHERE action_id=?`, action.ID).Scan(&raw, &action.ClosedReason)
	if err != nil {
		return err
	}
	var evidence weightReference
	if err = json.Unmarshal([]byte(raw), &evidence); err != nil {
		return err
	}
	evidence.Inputs = nil
	action.WeightEvidence = &evidence
	action.Source = "weight_policy"
	return nil
}

func weightConflict(reader actionQueryReader, ref weightReference) (bool, error) {
	var exists bool
	err := reader.QueryRow(`SELECT EXISTS(SELECT 1 FROM security_actions sa JOIN alerts a ON a.id=sa.alert_id
		WHERE sa.status IN ('OPEN','BLOCKED','AWAITING_STATEMENT','VARIANCE','OVERRIDDEN')
		AND ((sa.ticker=? AND ((sa.intent IN ('REDUCE','EXIT') AND a.alert_type NOT IN ('WEIGHT_REDUCE','WEIGHT_CLASS_REVIEW'))
		OR sa.status IN ('AWAITING_STATEMENT','VARIANCE')))
		OR (sa.scope='ASSET_CLASS' AND sa.asset_class_code=? AND sa.intent IN ('REDUCE','EXIT') AND a.alert_type NOT IN ('WEIGHT_REDUCE','WEIGHT_CLASS_REVIEW'))))`, securityActionTicker(ref.Ticker), ref.AssetClass).Scan(&exists)
	if err != nil || exists {
		return exists, err
	}
	// Portfolio deleveraging owns the sale while its stage-one requirement is open.
	err = reader.QueryRow(`SELECT EXISTS(SELECT 1 FROM overlay_events WHERE status IN ('PENDING','PARTIAL','STAGE1_DONE','STAGE2_DONE')
		AND stage1_required_reduction_value > 0 AND (stage1_applied_at IS NULL OR reserve_confirmed_at IS NULL))`).Scan(&exists)
	if err != nil || exists {
		return exists, err
	}
	err = reader.QueryRow(`SELECT EXISTS(SELECT 1 FROM portfolio_rebalance_plans p JOIN portfolio_rebalance_plan_rows r ON r.plan_id=p.id
		WHERE p.status IN ('OPEN','PARTIAL') AND r.asset_class=? AND r.target_weight_pct<r.current_weight_pct)`, ref.AssetClass).Scan(&exists)
	return exists, err
}

func syncWeightPolicyLocked() error {
	mode, err := readWeightPolicy(db)
	if err != nil || !mode.Enabled {
		return err
	}
	capacities, err := deploymentClassCapacities()
	if err != nil {
		return err
	}
	refs, err := weightReferencesFrom(db, capacities, "")
	if err != nil {
		return err
	}
	// Class reviews use the same statement and approved-class denominator.
	for _, ref := range refs {
		for class, c := range capacities {
			if c.ApprovedTarget <= 0 && c.TotalCurrent <= 0 {
				continue
			}
			classRef := weightReference{Ticker: class, AssetClass: class, Role: "CLASS", Held: c.TotalCurrent, Ideal: c.ApprovedTarget,
				ClassBudget: c.ApprovedTarget, ObservedDate: ref.ObservedDate, StatementID: ref.StatementID, StatementFingerprint: ref.StatementFingerprint, PortfolioValue: ref.PortfolioValue, Available: true}
			date, dateErr := time.Parse("2006-01-02", ref.ObservedDate)
			classRef.Fresh = dateErr == nil && time.Since(date) >= -24*time.Hour && time.Since(date) <= 4*24*time.Hour
			refs["class:"+class] = classRef
		}
		break
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = invalidateCorrectedWeightObservations(tx, mode.Epoch); err != nil {
		return err
	}
	for subject, ref := range refs {
		var conflict bool
		if ref.Role != "CLASS" {
			conflict, err = weightConflict(tx, ref)
			if err != nil {
				return err
			}
		}
		ref.Suppressed = conflict
		qualifies := weightQualifies(ref)
		if ref.Role == "CLASS" {
			qualifies = ref.Fresh && ref.PortfolioValue > 0 && math.Abs(ref.Held-ref.Ideal)/ref.PortfolioValue >= 0.01 && (ref.Ideal <= 0 || math.Abs(ref.Held-ref.Ideal)/ref.Ideal > 0.5)
		}
		qualifies = qualifies && !conflict
		raw, err := json.Marshal(ref)
		if err != nil {
			return err
		}
		// First observation of a statement date is immutable. A corrected
		// statement replaces that date; polling/research edits cannot add days.
		_, err = tx.Exec(`INSERT INTO weight_observations(epoch,subject,observed_date,statement_id,qualifies,evidence_json)
			VALUES(?,?,?,?,?,?) ON CONFLICT(epoch,subject,observed_date) DO UPDATE SET
			statement_id=excluded.statement_id,qualifies=excluded.qualifies,evidence_json=excluded.evidence_json
			WHERE weight_observations.statement_id != excluded.statement_id OR
			json_extract(weight_observations.evidence_json,'$.statement_fingerprint') != json_extract(excluded.evidence_json,'$.statement_fingerprint')`, mode.Epoch, subject, ref.ObservedDate, ref.StatementID, qualifies, string(raw))
		if err != nil {
			return err
		}
		if !qualifies || conflict {
			reason := "Exposure no longer meets the reduction threshold"
			if !ref.Available || !ref.Fresh || ref.ResearchMissing > 0 {
				reason = "Fresh, complete weight evidence is unavailable"
			}
			if conflict {
				reason = "An existing reduction or execution takes precedence"
			}
			if err = closeWeightActions(tx, reason, subject); err != nil {
				return err
			}
			continue
		}
		var id int
		var status, previousRaw string
		err = tx.QueryRow(`SELECT sa.id,sa.status,e.evidence_json FROM weight_action_evidence e JOIN security_actions sa ON sa.id=e.action_id
			WHERE e.epoch=? AND e.subject=? ORDER BY sa.id DESC LIMIT 1`, mode.Epoch, subject).Scan(&id, &status, &previousRaw)
		if err != nil && err != sql.ErrNoRows {
			return err
		}
		if id != 0 && !securityActionTerminalStatus(status) {
			if status == securityActionOpen || status == securityActionBlocked {
				confirmed, err := weightObservationsConfirmed(tx, mode.Epoch, subject, "")
				if err != nil {
					return err
				}
				if ref.Role != "CLASS" && !confirmed {
					if err = closeWeightActions(tx, "Statement correction requires fresh confirmation", subject); err != nil {
						return err
					}
					continue
				}
				if err = updateWeightProposal(tx, id, ref, string(raw)); err != nil {
					return err
				}
			}
			continue
		}
		// Dismissal ends a breach episode. Re-arm only after fresh below-threshold
		// evidence, followed by two new qualifying observations.
		var resetDate string
		if id != 0 {
			var previous weightReference
			if err = json.Unmarshal([]byte(previousRaw), &previous); err != nil {
				return err
			}
			err = tx.QueryRow(`SELECT COALESCE(MAX(observed_date),'') FROM weight_observations
				WHERE epoch=? AND subject=? AND observed_date>? AND qualifies=0
				AND json_extract(evidence_json,'$.fresh')=1 AND json_extract(evidence_json,'$.available')=1
				AND COALESCE(json_extract(evidence_json,'$.suppressed'),0)=0 AND json_extract(evidence_json,'$.research_missing')=0`, mode.Epoch, subject, previous.ObservedDate).Scan(&resetDate)
			if err != nil {
				return err
			}
			if resetDate == "" {
				continue
			}
		}
		if ref.Role != "CLASS" {
			confirmed, err := weightObservationsConfirmed(tx, mode.Epoch, subject, resetDate)
			if err != nil {
				return err
			}
			if !confirmed {
				continue
			}
		}
		if err = createWeightProposal(tx, mode.Epoch, subject, ref, string(raw)); err != nil {
			return err
		}
	}
	// Sold, archived, reclassified, or no longer Core: retire the old proposal.
	rows, err := tx.Query(`SELECT DISTINCT e.subject FROM weight_action_evidence e JOIN security_actions sa ON sa.id=e.action_id WHERE sa.status IN ('OPEN','BLOCKED')`)
	if err != nil {
		return err
	}
	var absent []string
	for rows.Next() {
		var s string
		if err = rows.Scan(&s); err != nil {
			rows.Close()
			return err
		}
		if _, ok := refs[s]; !ok {
			absent = append(absent, s)
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, s := range absent {
		if err = closeWeightActions(tx, "No longer eligible for weight management", s); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func createWeightProposal(tx *sql.Tx, epoch int, subject string, ref weightReference, raw string) error {
	kind, intent, scope, priority := "WEIGHT_REDUCE", "REDUCE", "SECURITY", 1
	if ref.Role == "CLASS" {
		kind, intent, scope, priority = "WEIGHT_CLASS_REVIEW", "REVIEW", "ASSET_CLASS", 3
	}
	prefix, symbol := splitFullTicker(ref.Ticker)
	if symbol == "" {
		symbol = ref.Ticker
	}
	result, err := tx.Exec(`INSERT INTO alerts(ticker,alert_type,source,exchange_prefix,is_active) VALUES(?,?,NULL,?,1)`, symbol, kind, prefix)
	if err != nil {
		return err
	}
	alertID, err := result.LastInsertId()
	if err != nil {
		return err
	}
	result, err = tx.Exec(`INSERT INTO security_actions(alert_id,ticker,scope,asset_class_code,intent,instruction_basis,instruction,priority,policy_version)
		VALUES(?,?,?,?,?,'DOLLAR_VALUE','',?,?)`, alertID, symbol, scope, ref.AssetClass, intent, priority, weightPolicyVersion)
	if err != nil {
		return err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return err
	}
	_, err = tx.Exec(`INSERT INTO weight_action_evidence(action_id,epoch,subject,evidence_json) VALUES(?,?,?,?)`, id, epoch, subject, raw)
	if err != nil {
		return err
	}
	return updateWeightProposal(tx, int(id), ref, raw)
}

func updateWeightProposal(tx *sql.Tx, id int, ref weightReference, raw string) error {
	instruction := fmt.Sprintf("Reduce exposure by $%.0f", ref.Reduction)
	if ref.Role == "CLASS" {
		instruction = "Review class allocation"
	}
	_, err := tx.Exec(`UPDATE security_actions SET instruction=?, instruction_value=?,target_value=?,holding_value_snapshot=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('OPEN','BLOCKED')`, instruction, ref.Reduction, ref.Ideal, ref.Held, id)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`UPDATE weight_action_evidence SET evidence_json=? WHERE action_id=?`, raw, id)
	return err
}

func validateWeightReduction(action SecurityAction) error {
	mode, err := readWeightPolicy(db)
	if err != nil {
		return err
	}
	if !mode.Enabled {
		return fmt.Errorf("Weight management is off")
	}
	capacities, err := deploymentClassCapacities()
	if err != nil {
		return err
	}
	refs, err := weightReferencesFrom(db, capacities, "")
	if err != nil {
		return err
	}
	ref := refs[securityActionTicker(action.Ticker)]
	conflict, err := weightConflict(db, ref)
	if err != nil {
		return err
	}
	if conflict || !weightQualifies(ref) {
		return fmt.Errorf("This weight proposal changed; refresh before recording. No execution was recorded")
	}
	if math.Abs(ref.Reduction-action.InstructionValue) > 0.01 {
		return fmt.Errorf("The proposed reduction changed; review the new amount before recording")
	}
	return nil
}

func refreshWeightRouter(ctx context.Context) error {
	token := strings.TrimSpace(os.Getenv("COUNCIL_API_TOKEN"))
	if token == "" {
		return nil
	}
	base := strings.TrimRight(os.Getenv("LLM_COUNCIL_API_URL"), "/")
	if base == "" {
		base = "https://llm-council-analysis.fly.dev"
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/api/announcement-router/signals", nil)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	client := &http.Client{Timeout: 10 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return fmt.Errorf("router returned %d", response.StatusCode)
	}
	var scores map[string]float64
	if err = json.NewDecoder(io.LimitReader(response.Body, 1024*1024)).Decode(&scores); err != nil {
		return err
	}
	clean := map[string]float64{}
	for ticker, score := range scores {
		if math.IsNaN(score) || math.IsInf(score, 0) {
			return fmt.Errorf("invalid router score")
		}
		clean[strings.ToUpper(strings.TrimSpace(ticker))] = score
	}
	raw, err := json.Marshal(clean)
	if err != nil {
		return err
	}
	_, err = db.Exec(`INSERT INTO weight_router_cache(id,scores_json,fetched_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET scores_json=excluded.scores_json,fetched_at=excluded.fetched_at`, string(raw), time.Now().UTC().Format(time.RFC3339))
	return err
}

func startWeightPolicyWorker(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for {
			if err := refreshWeightRouter(ctx); err != nil {
				log.Printf("[WEIGHT] Router evidence: %v", err)
			}
			if err := projectOpenDeploymentActions(); err != nil {
				log.Printf("[WEIGHT] Policy evaluation: %v", err)
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}
