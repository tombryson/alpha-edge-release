package main

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
)

// authConfig holds runtime authentication settings.
//
// API_TOKEN        — bearer token required on all non-webhook API routes.
// WEBHOOK_SECRET   — shared secret required on webhook POSTs (JSON "secret"
//
//	field or ?secret= query param; TradingView cannot send
//	custom headers, so the secret travels in the alert body).
//
// AUTH_DISABLED    — set to "true" to run without auth (local dev only).
//
// Fail-closed: if auth is enabled and either value is missing, the server
// refuses to start (see requireAuthConfig, called from main).
type authConfig struct {
	apiToken      string
	webhookSecret string
	disabled      bool
}

var auth authConfig

func loadAuthConfig() {
	auth.apiToken = strings.TrimSpace(os.Getenv("API_TOKEN"))
	auth.webhookSecret = strings.TrimSpace(os.Getenv("WEBHOOK_SECRET"))
	auth.disabled = strings.EqualFold(strings.TrimSpace(os.Getenv("AUTH_DISABLED")), "true")
}

func requireAuthConfig() {
	if auth.disabled {
		log.Println("[AUTH] WARNING: authentication is DISABLED (AUTH_DISABLED=true). Do not run this in production.")
		return
	}
	if auth.apiToken == "" || auth.webhookSecret == "" {
		log.Fatal("[AUTH] API_TOKEN and WEBHOOK_SECRET must be set. For local development only, set AUTH_DISABLED=true.")
	}
}

// secureEquals compares a provided credential against an expected one in
// constant time. An empty expected value never matches: a misconfigured
// (blank) token must not become a skeleton key.
func secureEquals(provided, expected string) bool {
	if expected == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) == 1
}

func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if len(h) > len(prefix) && strings.EqualFold(h[:len(prefix)], prefix) {
		return strings.TrimSpace(h[len(prefix):])
	}
	return ""
}

func writeUnauthorized(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"code":    "unauthorized",
		"message": "missing or invalid credentials",
	})
}

// authMiddleware enforces authentication on every route except /api/health
// and CORS preflights.
//
// Route classes:
//   - /api/webhook/* POST — accept the webhook secret (JSON "secret" field or
//     ?secret= query param) or a valid bearer token (used by UAT fixtures).
//   - /api/alerts/stream — browsers' EventSource cannot send headers, so a
//     valid ?token= query param is accepted in addition to a bearer header.
//   - everything else — Authorization: Bearer <API_TOKEN>.
func authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if auth.disabled || r.Method == http.MethodOptions || r.URL.Path == "/api/health" {
			next.ServeHTTP(w, r)
			return
		}

		if ownerAccess.enabled && strings.HasPrefix(r.URL.Path, "/api/auth/") && r.URL.Path != "/api/auth/check" {
			next.ServeHTTP(w, r)
			return
		}
		if ownerAccess.enabled && accessCookie(r, "session") != "" {
			if ownerAuthorized(w, r) {
				next.ServeHTTP(w, r)
			}
			return
		}

		// Bearer token is accepted everywhere, webhooks included.
		if secureEquals(bearerToken(r), auth.apiToken) {
			next.ServeHTTP(w, r)
			return
		}

		if strings.HasPrefix(r.URL.Path, "/api/webhook/") && r.Method == http.MethodPost {
			if webhookRequestAuthorized(w, r) {
				next.ServeHTTP(w, r)
			} else {
				writeUnauthorized(w)
			}
			return
		}

		if r.URL.Path == "/api/alerts/stream" && secureEquals(r.URL.Query().Get("token"), auth.apiToken) {
			next.ServeHTTP(w, r)
			return
		}

		writeUnauthorized(w)
	})
}

// webhookRequestAuthorized validates the shared webhook secret. The request
// body is read for the probe and then restored so downstream handlers (and
// acknowledgeAndProcessWebhook) can re-read it.
func webhookRequestAuthorized(w http.ResponseWriter, r *http.Request) bool {
	if secureEquals(r.URL.Query().Get("secret"), auth.webhookSecret) {
		return true
	}

	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		return false
	}
	r.Body = io.NopCloser(bytes.NewReader(body))

	var probe struct {
		Secret string `json:"secret"`
	}
	if err := json.Unmarshal(body, &probe); err != nil {
		return false
	}
	return secureEquals(strings.TrimSpace(probe.Secret), auth.webhookSecret)
}
