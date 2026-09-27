package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func setTestAuth(t *testing.T, apiToken, webhookSecret string, disabled bool) {
	t.Helper()
	prev := auth
	auth = authConfig{apiToken: apiToken, webhookSecret: webhookSecret, disabled: disabled}
	t.Cleanup(func() { auth = prev })
}

// echoHandler records that the request got through and echoes the body so
// tests can verify the webhook body survives the auth probe.
func authTestHandler(t *testing.T, called *bool) http.Handler {
	t.Helper()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*called = true
		body, _ := io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
	})
}

func runAuth(t *testing.T, req *http.Request) (*httptest.ResponseRecorder, bool) {
	t.Helper()
	called := false
	recorder := httptest.NewRecorder()
	authMiddleware(authTestHandler(t, &called)).ServeHTTP(recorder, req)
	return recorder, called
}

func TestAuthRejectsMissingToken(t *testing.T) {
	setTestAuth(t, "tok123", "hook456", false)
	req := httptest.NewRequest(http.MethodGet, "/api/portfolio", nil)
	rec, called := runAuth(t, req)
	if rec.Code != http.StatusUnauthorized || called {
		t.Fatalf("expected 401 and handler not called, got %d called=%v", rec.Code, called)
	}
}

func TestCouncilCallerCheckUsesExistingAuthentication(t *testing.T) {
	for _, tc := range []struct {
		name, token string
		disabled    bool
		want        int
	}{
		{"missing", "", false, http.StatusUnauthorized},
		{"wrong", "wrong", false, http.StatusUnauthorized},
		{"valid", "tok123", false, http.StatusNoContent},
		{"disabled fails closed", "tok123", true, http.StatusServiceUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setTestAuth(t, "tok123", "hook456", tc.disabled)
			r := httptest.NewRequest(http.MethodGet, "/api/auth/check", nil)
			if tc.token != "" {
				r.Header.Set("Authorization", "Bearer "+tc.token)
			}
			w := httptest.NewRecorder()
			newRouter().ServeHTTP(w, r)
			if w.Code != tc.want {
				t.Fatalf("status %d want %d", w.Code, tc.want)
			}
		})
	}
}

func TestAuthAcceptsValidBearer(t *testing.T) {
	setTestAuth(t, "tok123", "hook456", false)
	req := httptest.NewRequest(http.MethodGet, "/api/portfolio", nil)
	req.Header.Set("Authorization", "Bearer tok123")
	rec, called := runAuth(t, req)
	if rec.Code != http.StatusOK || !called {
		t.Fatalf("expected 200 and handler called, got %d called=%v", rec.Code, called)
	}
}

func TestAuthRejectsWrongBearer(t *testing.T) {
	setTestAuth(t, "tok123", "hook456", false)
	req := httptest.NewRequest(http.MethodGet, "/api/portfolio", nil)
	req.Header.Set("Authorization", "Bearer wrong")
	rec, _ := runAuth(t, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestAuthHealthAndOptionsOpen(t *testing.T) {
	setTestAuth(t, "tok123", "hook456", false)

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rec, called := runAuth(t, req)
	if rec.Code != http.StatusOK || !called {
		t.Fatalf("health: expected open, got %d called=%v", rec.Code, called)
	}

	req = httptest.NewRequest(http.MethodOptions, "/api/portfolio", nil)
	rec, called = runAuth(t, req)
	if rec.Code != http.StatusOK || !called {
		t.Fatalf("OPTIONS: expected open, got %d called=%v", rec.Code, called)
	}
}

func TestWebhookAcceptsBodySecretAndPreservesBody(t *testing.T) {
	setTestAuth(t, "tok123", "hook456", false)
	body := `{"secret":"hook456","ticker":"BHP","signal":"BUY"}`
	req := httptest.NewRequest(http.MethodPost, "/api/webhook/tradingview", strings.NewReader(body))
	rec, called := runAuth(t, req)
	if rec.Code != http.StatusOK || !called {
		t.Fatalf("expected 200 and handler called, got %d called=%v", rec.Code, called)
	}
	if got := rec.Body.String(); got != body {
		t.Fatalf("body not preserved for downstream handler: %q", got)
	}
}

func TestWebhookAcceptsQuerySecret(t *testing.T) {
	setTestAuth(t, "tok123", "hook456", false)
	req := httptest.NewRequest(http.MethodPost, "/api/webhook/regime?secret=hook456", strings.NewReader(`{"x":1}`))
	rec, called := runAuth(t, req)
	if rec.Code != http.StatusOK || !called {
		t.Fatalf("expected 200, got %d called=%v", rec.Code, called)
	}
}

func TestWebhookRejectsWrongOrMissingSecret(t *testing.T) {
	setTestAuth(t, "tok123", "hook456", false)
	for _, body := range []string{`{"secret":"nope","ticker":"BHP"}`, `{"ticker":"BHP"}`, `not json`} {
		req := httptest.NewRequest(http.MethodPost, "/api/webhook/tradingview", strings.NewReader(body))
		rec, called := runAuth(t, req)
		if rec.Code != http.StatusUnauthorized || called {
			t.Fatalf("body %q: expected 401 and handler not called, got %d called=%v", body, rec.Code, called)
		}
	}
}

func TestWebhookAcceptsBearerToken(t *testing.T) {
	setTestAuth(t, "tok123", "hook456", false)
	req := httptest.NewRequest(http.MethodPost, "/api/webhook/tradingview", strings.NewReader(`{"ticker":"BHP"}`))
	req.Header.Set("Authorization", "Bearer tok123")
	rec, called := runAuth(t, req)
	if rec.Code != http.StatusOK || !called {
		t.Fatalf("expected 200 via bearer on webhook, got %d called=%v", rec.Code, called)
	}
}

func TestSSEAcceptsQueryToken(t *testing.T) {
	setTestAuth(t, "tok123", "hook456", false)
	req := httptest.NewRequest(http.MethodGet, "/api/alerts/stream?token=tok123", nil)
	rec, called := runAuth(t, req)
	if rec.Code != http.StatusOK || !called {
		t.Fatalf("expected 200, got %d called=%v", rec.Code, called)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/alerts/stream?token=wrong", nil)
	rec, _ = runAuth(t, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for wrong stream token, got %d", rec.Code)
	}
}

func TestQueryTokenNotAcceptedOnOtherRoutes(t *testing.T) {
	setTestAuth(t, "tok123", "hook456", false)
	req := httptest.NewRequest(http.MethodGet, "/api/portfolio?token=tok123", nil)
	rec, _ := runAuth(t, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("query token must only work for SSE route, got %d", rec.Code)
	}
}

func TestEmptyConfiguredTokenNeverMatches(t *testing.T) {
	setTestAuth(t, "", "", false)
	req := httptest.NewRequest(http.MethodGet, "/api/portfolio", nil)
	req.Header.Set("Authorization", "Bearer ")
	rec, _ := runAuth(t, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("blank configured token must fail closed, got %d", rec.Code)
	}
}

func TestAuthDisabledPassesEverything(t *testing.T) {
	setTestAuth(t, "", "", true)
	req := httptest.NewRequest(http.MethodPost, "/api/webhook/tradingview", strings.NewReader(`{}`))
	rec, called := runAuth(t, req)
	if rec.Code != http.StatusOK || !called {
		t.Fatalf("expected open when disabled, got %d called=%v", rec.Code, called)
	}
}

func TestCORSAllowlist(t *testing.T) {
	prev := corsAllowedOrigins
	corsAllowedOrigins = []string{"https://terminal.example.com"}
	t.Cleanup(func() { corsAllowedOrigins = prev })

	handler := corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	req.Header.Set("Origin", "https://terminal.example.com")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://terminal.example.com" {
		t.Fatalf("allowlisted origin not echoed, got %q", got)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/health", nil)
	req.Header.Set("Origin", "https://evil.example.com")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("non-allowlisted origin must not be echoed, got %q", got)
	}
}

func TestDefaultCORSAllowlistIncludesLocalAndFlyFrontends(t *testing.T) {
	handler := corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	for _, origin := range []string{
		"http://localhost:3001",
		"http://127.0.0.1:3001",
		"http://localhost:3002",
		"http://127.0.0.1:3002",
		"https://alpha-edge-frontend.fly.dev",
		"https://alpha-edge-uat-frontend.fly.dev",
	} {
		req := httptest.NewRequest(http.MethodOptions, "/api/sizing/allocations", nil)
		req.Header.Set("Origin", origin)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != origin {
			t.Fatalf("default allowlist did not echo %s, got %q", origin, got)
		}
	}
}

func TestCORSPreflightAllowsCorePolicyPutFromUAT(t *testing.T) {
	handler := corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodOptions, "/api/etf/core-policies/SILVER_MINERS", nil)
	req.Header.Set("Origin", "https://alpha-edge-uat-frontend.fly.dev")
	req.Header.Set("Access-Control-Request-Method", http.MethodPut)
	req.Header.Set("Access-Control-Request-Headers", "authorization,content-type")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("preflight status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://alpha-edge-uat-frontend.fly.dev" {
		t.Fatalf("allow origin = %q", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Methods"); !strings.Contains(got, http.MethodPut) {
		t.Fatalf("PUT missing from Access-Control-Allow-Methods: %q", got)
	}
}
