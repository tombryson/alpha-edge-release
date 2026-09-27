package main

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// corsAllowedOrigins is loaded from CORS_ALLOWED_ORIGINS (comma-separated).
// Defaults to local dev origins. "*" may be configured explicitly but is not
// the default.
var corsAllowedOrigins = []string{
	"http://localhost:3000",
	"http://127.0.0.1:3000",
	"http://localhost:3001",
	"http://127.0.0.1:3001",
	"http://localhost:3002",
	"http://127.0.0.1:3002",
	"https://alpha-edge-frontend.fly.dev",
	"https://alpha-edge-uat-frontend.fly.dev",
}

func loadCORSConfig() {
	raw := strings.TrimSpace(os.Getenv("CORS_ALLOWED_ORIGINS"))
	if raw == "" {
		return
	}
	var origins []string
	for _, part := range strings.Split(raw, ",") {
		if origin := strings.TrimSpace(part); origin != "" {
			origins = append(origins, origin)
		}
	}
	if len(origins) > 0 {
		corsAllowedOrigins = origins
	}
}

// resolveCORSOrigin echoes the request origin only when allowlisted.
func resolveCORSOrigin(r *http.Request) string {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return ""
	}
	for _, allowed := range corsAllowedOrigins {
		if allowed == "*" {
			return origin
		}
		if strings.EqualFold(allowed, origin) {
			return origin
		}
	}
	return ""
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := resolveCORSOrigin(r); origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
		}
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func healthCheck(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "ok",
		"time":   time.Now().UTC().Format(time.RFC3339),
	})
}

// The Council proxy validates the user's existing token here, without copying
// the backend secret into another service or querying financial state.
func checkAPICaller(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if auth.disabled {
		http.Error(w, "Caller validation unavailable while authentication is disabled", http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type statusResponseWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusResponseWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *statusResponseWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func slowRequestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		wrapped := &statusResponseWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(wrapped, r)
		elapsed := time.Since(start)
		if elapsed > 2*time.Second {
			log.Printf("[SLOW REQUEST] %s %s status=%d duration=%s", r.Method, r.URL.Path, wrapped.status, elapsed)
		}
	})
}

func withRequestTimeout(timeout time.Duration, handler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), timeout)
		defer cancel()
		handler(w, r.WithContext(ctx))
	}
}

func acknowledgeAndProcessWebhook(w http.ResponseWriter, r *http.Request, name string) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		http.Error(w, "Invalid webhook body", http.StatusBadRequest)
		return
	}

	path := "/"
	if r.URL != nil {
		path = r.URL.EscapedPath()
	}
	id, duplicate, status, err := enqueueWebhook(name, path, body, time.Now())
	if err != nil {
		if status == 503 {
			log.Printf("[WEBHOOK] could not persist %s: %v", name, err)
			http.Error(w, "Signal was not accepted: durable storage unavailable", status)
		} else {
			http.Error(w, err.Error(), status)
		}
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":     "accepted",
		"type":       name,
		"receipt_id": id,
		"duplicate":  duplicate,
	})
	select {
	case webhookInboxWake <- struct{}{}:
	default:
	}
}
