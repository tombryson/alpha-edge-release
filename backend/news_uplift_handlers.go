package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
)

// ── Thesis detail ─────────────────────────────────────────────────────────────

type newsThesisDetailResponse struct {
	Thesis           newsThesis                  `json:"thesis"`
	Updates          []newsThesisUpdate          `json:"updates"`
	ConvictionHistory []newsThesisConvictionPoint `json:"conviction_history"`
}

func getNewsThesisDetailHandler(w http.ResponseWriter, r *http.Request) {
	idStr := mux.Vars(r)["id"]
	thesisID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid thesis id", http.StatusBadRequest)
		return
	}

	ctx := r.Context()

	// Load the thesis
	theses, err := loadNewsThesisByID(ctx, thesisID)
	if err != nil || theses == nil {
		http.Error(w, "thesis not found", http.StatusNotFound)
		return
	}

	updates, err := loadAllThesisUpdates(ctx, thesisID)
	if err != nil {
		http.Error(w, "failed to load thesis updates", http.StatusInternalServerError)
		return
	}

	history, err := loadThesisConvictionHistory(ctx, thesisID)
	if err != nil {
		history = []newsThesisConvictionPoint{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(newsThesisDetailResponse{
		Thesis:            *theses,
		Updates:           updates,
		ConvictionHistory: history,
	})
}

func loadNewsThesisByID(ctx context.Context, thesisID int64) (*newsThesis, error) {
	row := db.QueryRowContext(ctx, `
		SELECT id, COALESCE(slug, ''), COALESCE(foundation_cohort_id, 0),
		       title, timeframe, status, conviction, COALESCE(relevance_score, 0), summary,
		       asset_classes_json, tags_json,
		       COALESCE(source_type, ''), COALESCE(source_id, ''), COALESCE(source_excerpt, ''),
		       COALESCE(supporting_evidence, ''), COALESCE(opposing_evidence, ''),
		       COALESCE(invalidation_trigger, ''), COALESCE(invalidation_check_due_at, ''),
		       created_at, updated_at, last_updated_at, COALESCE(resolved_at, '')
		FROM news_theses
		WHERE id = ? AND status != 'SUPERSEDED'
	`, thesisID)

	var thesis newsThesis
	var assetClassesJSON, tagsJSON string
	if err := row.Scan(
		&thesis.ID, &thesis.Slug, &thesis.FoundationCohortID,
		&thesis.Title, &thesis.Timeframe, &thesis.Status, &thesis.Conviction, &thesis.RelevanceScore, &thesis.Summary,
		&assetClassesJSON, &tagsJSON,
		&thesis.SourceType, &thesis.SourceID, &thesis.SourceExcerpt,
		&thesis.SupportingEvidence, &thesis.OpposingEvidence, &thesis.InvalidationTrigger,
		&thesis.InvalidationCheckDueAt,
		&thesis.CreatedAt, &thesis.UpdatedAt, &thesis.LastUpdatedAt, &thesis.ResolvedAt,
	); err != nil {
		return nil, err
	}
	thesis.AssetClasses = parseJSONStringArray(assetClassesJSON)
	thesis.Tags = parseJSONStringArray(tagsJSON)
	if thesis.InvalidationCheckDueAt != "" && thesis.InvalidationTrigger != "" {
		if t, err := time.Parse(time.RFC3339, thesis.InvalidationCheckDueAt); err == nil {
			thesis.StaleInvalidation = time.Now().After(t)
		}
	}
	return &thesis, nil
}

// ── Thesis PATCH ──────────────────────────────────────────────────────────────

type patchNewsThesisRequest struct {
	Title               *string   `json:"title"`
	Status              *string   `json:"status"`
	Conviction          *float64  `json:"conviction"`
	Summary             *string   `json:"summary"`
	InvalidationTrigger *string   `json:"invalidation_trigger"`
	SupportingEvidence  *string   `json:"supporting_evidence"`
	OpposingEvidence    *string   `json:"opposing_evidence"`
	AssetClasses        []string  `json:"asset_classes"`
}

func patchNewsThesisHandler(w http.ResponseWriter, r *http.Request) {
	idStr := mux.Vars(r)["id"]
	thesisID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid thesis id", http.StatusBadRequest)
		return
	}

	var req patchNewsThesisRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	setParts := []string{"updated_at = CURRENT_TIMESTAMP", "last_updated_at = CURRENT_TIMESTAMP"}
	args := []interface{}{}

	if req.Title != nil {
		setParts = append(setParts, "title = ?")
		args = append(args, strings.TrimSpace(*req.Title))
	}
	if req.Status != nil {
		status := normaliseNewsStatus(*req.Status)
		setParts = append(setParts, "status = ?")
		args = append(args, status)
		if status == "RESOLVED" || status == "REJECTED" {
			setParts = append(setParts, "resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP)")
		} else {
			setParts = append(setParts, "resolved_at = NULL")
		}
	}
	if req.Conviction != nil {
		setParts = append(setParts, "conviction = ?")
		args = append(args, clamp01(*req.Conviction))
	}
	if req.Summary != nil {
		setParts = append(setParts, "summary = ?")
		args = append(args, strings.TrimSpace(*req.Summary))
	}
	if req.InvalidationTrigger != nil {
		setParts = append(setParts, "invalidation_trigger = ?")
		args = append(args, strings.TrimSpace(*req.InvalidationTrigger))
		// Reset the invalidation check window
		if strings.TrimSpace(*req.InvalidationTrigger) != "" {
			setParts = append(setParts, "invalidation_check_due_at = ?")
			args = append(args, time.Now().AddDate(0, 0, 7).Format("2006-01-02T15:04:05Z"))
		}
	}
	if req.SupportingEvidence != nil {
		setParts = append(setParts, "supporting_evidence = ?")
		args = append(args, strings.TrimSpace(*req.SupportingEvidence))
	}
	if req.OpposingEvidence != nil {
		setParts = append(setParts, "opposing_evidence = ?")
		args = append(args, strings.TrimSpace(*req.OpposingEvidence))
	}
	if req.AssetClasses != nil {
		normalised := normaliseNewsAssetClassesFuzzy(req.AssetClasses)
		setParts = append(setParts, "asset_classes_json = ?")
		args = append(args, mustJSON(normalised))
		// Recompute relevance
		portfolioWeightMap := loadNewsPortfolioWeightMap()
		setParts = append(setParts, "relevance_score = ?")
		args = append(args, computeThesisRelevanceScore(normalised, portfolioWeightMap))
	}

	if len(setParts) == 2 { // only timestamps — nothing to do
		w.WriteHeader(http.StatusNoContent)
		return
	}

	args = append(args, thesisID)
	query := fmt.Sprintf(`UPDATE news_theses SET %s WHERE id = ? AND status != 'SUPERSEDED'`,
		strings.Join(setParts, ", "))
	if _, err := db.Exec(query, args...); err != nil {
		http.Error(w, "failed to update thesis", http.StatusInternalServerError)
		return
	}

	thesis, err := loadNewsThesisByID(r.Context(), thesisID)
	if err != nil {
		http.Error(w, "failed to reload thesis", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(thesis)
}

// ── Thesis soft-delete ────────────────────────────────────────────────────────

func deleteNewsThesisHandler(w http.ResponseWriter, r *http.Request) {
	idStr := mux.Vars(r)["id"]
	thesisID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid thesis id", http.StatusBadRequest)
		return
	}
	if _, err := db.Exec(`
		UPDATE news_theses
		SET status = 'SUPERSEDED', updated_at = CURRENT_TIMESTAMP
		WHERE id = ? AND status != 'SUPERSEDED'
	`, thesisID); err != nil {
		http.Error(w, "failed to dismiss thesis", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── Deduplication ─────────────────────────────────────────────────────────────

type deduplicateNewsThesesResponse struct {
	Merged   int      `json:"merged"`
	Absorbed []string `json:"absorbed_slugs"`
}

func deduplicateNewsThesesHandler(w http.ResponseWriter, r *http.Request) {
	if err := ensureNewsNarrativeSchema(); err != nil {
		http.Error(w, "schema error", http.StatusInternalServerError)
		return
	}

	rows, err := db.Query(`
		SELECT id, COALESCE(slug, ''), title, timeframe, status, conviction,
		       last_updated_at, asset_classes_json, tags_json
		FROM news_theses
		WHERE status IN ('ACTIVE', 'WATCH')
		ORDER BY last_updated_at DESC
	`)
	if err != nil {
		http.Error(w, "failed to load theses", http.StatusInternalServerError)
		return
	}

	type candidateRow struct {
		id           int64
		slug         string
		title        string
		timeframe    string
		status       string
		conviction   float64
		lastUpdated  string
		assetClasses []string
		tags         []string
	}
	var candidates []candidateRow
	for rows.Next() {
		var c candidateRow
		var acJSON, tagsJSON string
		if err := rows.Scan(&c.id, &c.slug, &c.title, &c.timeframe, &c.status, &c.conviction,
			&c.lastUpdated, &acJSON, &tagsJSON); err != nil {
			continue
		}
		c.assetClasses = parseJSONStringArray(acJSON)
		c.tags = parseJSONStringArray(tagsJSON)
		candidates = append(candidates, c)
	}
	rows.Close()

	// Group by canonical theme key + timeframe
	type groupKey = string
	groups := map[groupKey][]candidateRow{}
	for _, c := range candidates {
		key := c.timeframe + "|" + newsFoundationCanonicalThemeKey(newsNarrativeModelUpdate{
			Title:        c.title,
			Timeframe:    c.timeframe,
			AssetClasses: c.assetClasses,
			Tags:         c.tags,
		})
		groups[key] = append(groups[key], c)
	}

	var mergedCount int
	var absorbedSlugs []string

	for _, group := range groups {
		if len(group) < 2 {
			continue
		}
		// The first entry is the canonical (most recently updated due to ORDER BY)
		canonical := group[0]
		for _, dup := range group[1:] {
			if dup.id == canonical.id {
				continue
			}
			// Merge conviction updates into canonical
			_, _ = db.Exec(`
				UPDATE news_thesis_updates SET thesis_id = ? WHERE thesis_id = ?
			`, canonical.id, dup.id)
			// Merge conviction history
			_, _ = db.Exec(`
				INSERT OR IGNORE INTO news_thesis_conviction_history (thesis_id, run_id, conviction, relationship)
				SELECT ?, run_id, conviction, relationship FROM news_thesis_conviction_history WHERE thesis_id = ?
			`, canonical.id, dup.id)
			// Mark duplicate as SUPERSEDED
			_, _ = db.Exec(`
				UPDATE news_theses SET status = 'SUPERSEDED', updated_at = CURRENT_TIMESTAMP WHERE id = ?
			`, dup.id)
			absorbedSlugs = append(absorbedSlugs, dup.slug)
			mergedCount++
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(deduplicateNewsThesesResponse{
		Merged:   mergedCount,
		Absorbed: absorbedSlugs,
	})
}

// ── Market context history ────────────────────────────────────────────────────

type newsMarketContextHistoryEntry struct {
	RunID     int64            `json:"run_id"`
	RunDate   string           `json:"run_date"`
	Mode      string           `json:"mode"`
	Context   newsMarketContext `json:"context"`
	CreatedAt string           `json:"created_at"`
}

func getNewsMarketContextHistoryHandler(w http.ResponseWriter, r *http.Request) {
	limit := 10
	if lStr := r.URL.Query().Get("limit"); lStr != "" {
		if l, err := strconv.Atoi(lStr); err == nil && l > 0 && l <= 30 {
			limit = l
		}
	}

	rows, err := db.QueryContext(r.Context(), `
		SELECT id, run_date, mode, market_context_json, created_at
		FROM news_runs
		WHERE status = 'COMPLETED'
		ORDER BY created_at DESC
		LIMIT ?
	`, limit)
	if err != nil {
		http.Error(w, "failed to load history", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var entries []newsMarketContextHistoryEntry
	for rows.Next() {
		var entry newsMarketContextHistoryEntry
		var ctxJSON string
		if err := rows.Scan(&entry.RunID, &entry.RunDate, &entry.Mode, &ctxJSON, &entry.CreatedAt); err != nil {
			continue
		}
		_ = json.Unmarshal([]byte(ctxJSON), &entry.Context)
		entries = append(entries, entry)
	}

	// Reverse so oldest first (for trend display)
	for i, j := 0, len(entries)-1; i < j; i, j = i+1, j-1 {
		entries[i], entries[j] = entries[j], entries[i]
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(entries)
}

// ── Conviction history ────────────────────────────────────────────────────────

func getNewsThesisConvictionHistoryHandler(w http.ResponseWriter, r *http.Request) {
	idStr := mux.Vars(r)["id"]
	thesisID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid thesis id", http.StatusBadRequest)
		return
	}
	history, err := loadThesisConvictionHistory(r.Context(), thesisID)
	if err != nil {
		http.Error(w, "failed to load conviction history", http.StatusInternalServerError)
		return
	}
	if history == nil {
		history = []newsThesisConvictionPoint{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(history)
}

// ── Invalidation staleness refresh ───────────────────────────────────────────

// markInvalidationChecked resets the invalidation_check_due_at to 7 days from
// now, acknowledging that the trigger was checked and not yet fired.
func markInvalidationCheckedHandler(w http.ResponseWriter, r *http.Request) {
	idStr := mux.Vars(r)["id"]
	thesisID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid thesis id", http.StatusBadRequest)
		return
	}
	due := time.Now().AddDate(0, 0, 7).Format("2006-01-02T15:04:05Z")
	if _, err := db.Exec(`
		UPDATE news_theses
		SET invalidation_check_due_at = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ? AND status NOT IN ('SUPERSEDED', 'RESOLVED', 'REJECTED')
	`, due, thesisID); err != nil {
		http.Error(w, "failed to update check date", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── Thesis update history (all runs) ─────────────────────────────────────────

func getNewsThesisUpdatesHandler(w http.ResponseWriter, r *http.Request) {
	idStr := mux.Vars(r)["id"]
	thesisID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "invalid thesis id", http.StatusBadRequest)
		return
	}
	updates, err := loadAllThesisUpdates(r.Context(), thesisID)
	if err != nil {
		http.Error(w, "failed to load updates", http.StatusInternalServerError)
		return
	}
	if updates == nil {
		updates = []newsThesisUpdate{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(updates)
}
