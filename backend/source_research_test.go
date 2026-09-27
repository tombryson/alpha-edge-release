package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/mux"
)

func setupSourceResearch(t *testing.T) func() {
	t.Helper()
	cleanup := setupSecurityActionTestDB(t)
	t.Setenv("PARALLEL_API_KEY", "test-key-not-a-secret")
	_, err := db.Exec(`INSERT INTO stock_analysis(id,name,ticker,primary_asset_class,security_type) VALUES (9101,'Fixture Mining Ltd','ASX:TEST','GOLD_MINERS','STOCK'),(9102,'Second Company','ASX:TWO','GOLD_MINERS','STOCK'),(9103,'Third Company','ASX:THREE','GOLD_MINERS','STOCK'),(9104,'Fourth Company','ASX:FOUR','GOLD_MINERS','STOCK')`)
	if err != nil {
		t.Fatal(err)
	}
	return cleanup
}

func researchTestInput() map[string]any {
	var version string
	for _, template := range researchTemplates() {
		if template.ID == "gold_miner" {
			version = template.Version
		}
	}
	return map[string]any{"analysis_id": 9101, "template_id": "gold_miner", "template_version": version, "request_id": researchNewID(), "accepted_cost_usd": researchEstimateUSD, "expected_ticker": "ASX:TEST"}
}

func createResearchTest(t *testing.T, input map[string]any) (*httptest.ResponseRecorder, sourceResearchJob) {
	t.Helper()
	body, _ := json.Marshal(input)
	w := httptest.NewRecorder()
	createSourceResearchJob(w, httptest.NewRequest("POST", "/api/source-research/jobs", bytes.NewReader(body)))
	var job sourceResearchJob
	_ = json.Unmarshal(w.Body.Bytes(), &job)
	return w, job
}

func savedResearch(t *testing.T, id string) sourceResearchJob {
	t.Helper()
	job, err := scanResearchJob(db.QueryRow(`SELECT `+researchColumns+` FROM source_research_jobs WHERE id=?`, id))
	if err != nil {
		t.Fatal(err)
	}
	return job
}

func researchTestPacket(job sourceResearchJob) map[string]any {
	return map[string]any{"company": job.Company, "ticker": job.Ticker, "exchange": job.Exchange, "asset_class": job.TemplateID, "retrieval_date": "2026-09-17", "source_count": 1,
		"sources": []any{map[string]any{"title": "Quarterly report", "source_type": "primary_filing", "url": "https://example.com/report.pdf", "date": "2026-09-01", "named_source": "Fixture Mining Ltd", "factual_summary": []string{"Reported cash was $10m."}, "relevance": "Funding evidence"}}, "rejected_sources": []any{}, "known_gaps": []string{"No more recent report found."}}
}

func mockResearchProvider(t *testing.T, handler http.HandlerFunc) {
	t.Helper()
	server := httptest.NewServer(handler)
	previousURL, previousHTTP := researchProviderURL, researchHTTP
	researchProviderURL, researchHTTP = server.URL, server.Client()
	t.Cleanup(func() { researchProviderURL, researchHTTP = previousURL, previousHTTP; server.Close() })
}

func TestSourceResearchCatalogue(t *testing.T) {
	templates := researchTemplates()
	if len(templates) != 47 {
		t.Fatalf("template count %d", len(templates))
	}
	seen := map[string]bool{}
	for _, template := range templates {
		if seen[template.ID] || template.Version != researchPromptHash(template.Prompt) || !strings.Contains(template.Prompt, "[COMPANY_NAME]") || !strings.Contains(template.Prompt, `"sources"`) || strings.Contains(template.Prompt, "ESTIMATE tag") {
			t.Fatalf("invalid catalogue entry: %s", template.ID)
		}
		seen[template.ID] = true
	}
}

func TestSourceResearchWorkflowAndIdempotency(t *testing.T) {
	defer setupSourceResearch(t)()
	input := researchTestInput()
	w, job := createResearchTest(t, input)
	if w.Code != 202 || job.Status != "queued" {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	w, second := createResearchTest(t, input)
	if w.Code != 200 || second.ID != job.ID {
		t.Fatal("idempotent retry created different run")
	}
	if w, _ := createResearchTest(t, researchTestInput()); w.Code != 409 {
		t.Fatal("accepted duplicate active research")
	}
	posts := 0
	mockResearchProvider(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "test-key-not-a-secret" {
			t.Error("missing provider auth")
		}
		switch {
		case r.Method == "POST":
			posts++
			var body struct {
				Input     string            `json:"input"`
				Processor string            `json:"processor"`
				Metadata  map[string]string `json:"metadata"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body.Processor != "ultra4x" || body.Metadata["local_job_id"] != job.ID || strings.Contains(body.Input, "[COMPANY_NAME]") || !strings.Contains(body.Input, "ASX:TEST") {
				t.Error("incorrect request")
			}
			_, _ = w.Write([]byte(`{"run_id":"trun_fixture1234","status":"queued"}`))
		case strings.Contains(r.URL.Path, "/result"):
			packet, _ := json.Marshal(researchTestPacket(job))
			_ = json.NewEncoder(w).Encode(map[string]any{"output": map[string]any{"content": map[string]any{"answer": string(packet)}}})
		default:
			_, _ = w.Write([]byte(`{"status":"completed"}`))
		}
	})
	if err := processSourceResearch(context.Background()); err != nil {
		t.Fatal(err)
	}
	if savedResearch(t, job.ID).Status != "running" {
		t.Fatal("provider ID not persisted")
	}
	// The worker has no in-memory job state: the next sweep also models a restart.
	if err := processSourceResearch(context.Background()); err != nil {
		t.Fatal(err)
	}
	complete := savedResearch(t, job.ID)
	if complete.Status != "succeeded" || len(complete.Packet) == 0 {
		t.Fatalf("result not saved: %+v", complete)
	}
	w, same := createResearchTest(t, input)
	if w.Code != 200 || same.ID != job.ID || posts != 1 {
		t.Fatal("completed request charged twice")
	}
	var council, raw string
	_ = db.QueryRow(`SELECT COALESCE(council_run_id,'') FROM stock_analysis WHERE id=9101`).Scan(&council)
	_ = db.QueryRow(`SELECT provider_result_json FROM source_research_jobs WHERE id=?`, job.ID).Scan(&raw)
	if council != "" || raw == "" {
		t.Fatal("retrieval changed Council or lost provider evidence")
	}
}

func TestSourceResearchSubmissionAmbiguityAndRecovery(t *testing.T) {
	defer setupSourceResearch(t)()
	_, job := createResearchTest(t, researchTestInput())
	posts := 0
	mockResearchProvider(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			posts++
			w.WriteHeader(502)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "running", "processor": "ultra4x", "metadata": map[string]string{"local_job_id": job.ID}})
	})
	for i := 0; i < 3; i++ {
		if err := processSourceResearch(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if posts != 1 || savedResearch(t, job.ID).Status != "uncertain" {
		t.Fatal("ambiguous submission was retried")
	}
	r := httptest.NewRequest("POST", "/recover", strings.NewReader(`{"provider_run_id":"trun_recovered123"}`))
	r = mux.SetURLVars(r, map[string]string{"id": job.ID})
	w := httptest.NewRecorder()
	recoverSourceResearchJob(w, r)
	if w.Code != 200 || savedResearch(t, job.ID).ProviderRunID != "trun_recovered123" || posts != 1 {
		t.Fatal("recovery did not reuse existing provider job")
	}
	_, _ = db.Exec(`UPDATE source_research_jobs SET status='submitting',provider_run_id='',updated_at=? WHERE id=?`, time.Now().UTC().Add(-5*time.Minute).Format(time.RFC3339Nano), job.ID)
	if err := processSourceResearch(context.Background()); err != nil {
		t.Fatal(err)
	}
	if posts != 1 || savedResearch(t, job.ID).Status != "uncertain" {
		t.Fatal("restart resubmitted a paid request")
	}
}

func TestSourceResearchPreflightAndCapacity(t *testing.T) {
	defer setupSourceResearch(t)()
	for _, test := range []struct {
		key   string
		value any
	}{{"template_id", "unknown"}, {"template_version", "old"}, {"accepted_cost_usd", 0}, {"analysis_id", 0}, {"request_id", "bad"}, {"expected_ticker", "ASX:OLD"}} {
		input := researchTestInput()
		input[test.key] = test.value
		if w, _ := createResearchTest(t, input); w.Code < 400 {
			t.Fatalf("accepted invalid %s", test.key)
		}
	}
	_, _ = db.Exec(`UPDATE stock_analysis SET ticker='TEST' WHERE id=9101`)
	if w, _ := createResearchTest(t, researchTestInput()); w.Code != 400 {
		t.Fatal("accepted missing exchange")
	}
	_, _ = db.Exec(`UPDATE stock_analysis SET ticker='ASX:TEST',security_type='ETF' WHERE id=9101`)
	if w, _ := createResearchTest(t, researchTestInput()); w.Code != 400 {
		t.Fatal("accepted ETF as company research")
	}
	_, _ = db.Exec(`UPDATE stock_analysis SET security_type='STOCK' WHERE id=9101`)
	for id := 9101; id <= 9104; id++ {
		input := researchTestInput()
		input["analysis_id"] = id
		input["expected_ticker"] = map[int]string{9101: "ASX:TEST", 9102: "ASX:TWO", 9103: "ASX:THREE", 9104: "ASX:FOUR"}[id]
		w, _ := createResearchTest(t, input)
		if (id < 9104 && w.Code != 202) || (id == 9104 && w.Code != 409) {
			t.Fatalf("capacity guard: id %d code %d", id, w.Code)
		}
	}
}

func TestSourceResearchHTTPContractAndRestart(t *testing.T) {
	original := db
	path := filepath.Join(t.TempDir(), "research.db")
	open := func() {
		var err error
		db, err = sql.Open("sqlite3", path+"?_busy_timeout=15000&_journal_mode=WAL")
		if err != nil {
			t.Fatal(err)
		}
		initDB()
	}
	open()
	t.Cleanup(func() { db.Close(); db = original })
	t.Setenv("PARALLEL_API_KEY", "fixture-key")
	setTestAuth(t, "research-token", "research-secret", false)
	if _, err := db.Exec(`INSERT INTO stock_analysis(id,name,ticker,primary_asset_class,security_type) VALUES(9101,'Fixture Mining Ltd','ASX:TEST','GOLD_MINERS','STOCK')`); err != nil {
		t.Fatal(err)
	}
	router := newRouter()
	var captures []map[string]any
	request := func(method, path string, input any, code int) sourceResearchJob {
		t.Helper()
		raw, _ := json.Marshal(input)
		r := httptest.NewRequest(method, path, bytes.NewReader(raw))
		r.Header.Set("Authorization", "Bearer research-token")
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != code {
			t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body.String())
		}
		captures = append(captures, map[string]any{"method": method, "path": path, "request": json.RawMessage(raw), "status": w.Code, "content_type": w.Header().Get("Content-Type"), "response": w.Body.String()})
		var job sourceResearchJob
		_ = json.Unmarshal(w.Body.Bytes(), &job)
		return job
	}
	request("GET", "/api/source-research/templates", nil, 200)
	request("GET", "/api/source-research/jobs?analysis_id=9101", nil, 200)
	request("GET", "/api/source-research/jobs", nil, 400)
	request("GET", "/api/source-research/jobs/missing", nil, 404)
	input := researchTestInput()
	job := request("POST", "/api/source-research/jobs", input, 202)
	posts := 0
	mockResearchProvider(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			posts++
			_ = json.NewEncoder(w).Encode(map[string]string{"run_id": "trun_durable_fixture"})
		} else if strings.HasSuffix(r.URL.Path, "/result") {
			_ = json.NewEncoder(w).Encode(map[string]any{"output": map[string]any{"content": researchTestPacket(job)}})
		} else {
			_ = json.NewEncoder(w).Encode(map[string]any{"status": "completed", "processor": researchProcessor, "metadata": map[string]string{"local_job_id": job.ID}})
		}
	})
	if err := processSourceResearch(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	open()
	// Reopening SQLite and rebuilding the router must not resubmit provider POST.
	router = newRouter()
	if err := processSourceResearch(context.Background()); err != nil {
		t.Fatal(err)
	}
	complete := request("GET", "/api/source-research/jobs/"+job.ID, nil, 200)
	if complete.Status != "succeeded" || len(complete.Packet) == 0 || posts != 1 {
		t.Fatal("restart lost the packet or resubmitted research")
	}
	request("POST", "/api/source-research/jobs", input, 200)
	request("GET", "/api/source-research/jobs?analysis_id=9101", nil, 200)
	job = request("POST", "/api/source-research/jobs", researchTestInput(), 202)
	if err := researchSetStatus(job.ID, "uncertain", "Interrupted fixture submission"); err != nil {
		t.Fatal(err)
	}
	request("POST", "/api/source-research/jobs/"+job.ID+"/recover", map[string]string{"provider_run_id": "trun_recovery_fixture"}, 200)
	if posts != 1 {
		t.Fatal("recovery created a new provider run")
	}
	if directory := os.Getenv("ALPHA_EDGE_CONTRACT_CAPTURE_DIR"); directory != "" {
		raw, err := json.Marshal(captures)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(directory, "source-research.json"), raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestSourceResearchPacketValidation(t *testing.T) {
	job := sourceResearchJob{Company: "Fixture Mining Ltd", Ticker: "ASX:TEST", Exchange: "ASX", TemplateID: "gold_miner"}
	for _, mode := range []string{"object", "string", "answer", "fence", "wrong-company", "count", "unsafe-url", "empty"} {
		t.Run(mode, func(t *testing.T) {
			packet := researchTestPacket(job)
			switch mode {
			case "wrong-company":
				packet["ticker"] = "ASX:OTHER"
			case "count":
				packet["source_count"] = 10
			case "unsafe-url":
				packet["sources"].([]any)[0].(map[string]any)["url"] = "javascript:alert(1)"
			case "empty":
				packet["sources"] = []any{}
				packet["source_count"] = 0
			}
			var content any = packet
			b, _ := json.Marshal(packet)
			if mode == "string" {
				content = string(b)
			}
			if mode == "answer" {
				content = map[string]string{"answer": string(b)}
			}
			if mode == "fence" {
				content = "```json\n" + string(b) + "\n```"
			}
			raw, _ := json.Marshal(map[string]any{"output": map[string]any{"content": content}})
			_, err := validateResearchPacket(raw, job)
			wantError := mode == "wrong-company" || mode == "count" || mode == "unsafe-url" || mode == "empty"
			if (err != nil) != wantError {
				t.Fatalf("validation: %v", err)
			}
		})
	}
}
