package main

import (
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

	"github.com/go-webauthn/webauthn/webauthn"
	databasepkg "trading-backend/internal/database"
)

const testSetupToken = "test-only-setup-token-with-at-least-32-characters"

func setupOwnerTest(t *testing.T) string {
	t.Helper()
	oldDB, oldAccess := db, ownerAccess
	setTestAuth(t, "machine-token", "webhook-token", false)
	t.Setenv("APP_ACCESS_MODE", "owner")
	t.Setenv("APP_ORIGIN", "http://localhost:3311")
	t.Setenv("OWNER_SETUP_TOKEN_SHA256", accessDigest(testSetupToken))
	if err := configureOwnerAccess(); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "owner.db")
	var err error
	db, err = sql.Open("sqlite3", path+"?_busy_timeout=3000&_journal_mode=WAL")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = databasepkg.Migrate(context.Background(), db, databasepkg.Options{}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close(); db = oldDB; ownerAccess = oldAccess })
	return path
}

func ownerTestRequest(method, path, body, token string, csrf bool) *http.Request {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", ownerAccess.origin)
	if token != "" {
		r.AddCookie(&http.Cookie{Name: accessCookieName("session"), Value: token})
	}
	if csrf {
		r.Header.Set("X-CSRF-Token", accessDigest("csrf:"+token))
	}
	return r
}
func ownerCall(r *http.Request) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	newRouter().ServeHTTP(w, r)
	return w
}
func testOwnerSession(t *testing.T, scope string) string {
	t.Helper()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	token, err := insertOwnerSession(tx, scope)
	if err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return token
}

func TestOwnerSessionCSRFExpiryAndRestart(t *testing.T) {
	path := setupOwnerTest(t)
	token := testOwnerSession(t, "owner")
	db.Close()
	var err error
	db, err = sql.Open("sqlite3", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		method, token string
		csrf          bool
		want          int
	}{
		{"GET", token, false, 204}, {"POST", token, false, 403}, {"POST", token, true, 204}, {"GET", "fake", false, 401}, {"GET", "", false, 401},
	} {
		w := ownerCall(ownerTestRequest(tc.method, "/api/auth/check", "{}", tc.token, tc.csrf))
		if w.Code != tc.want {
			t.Fatalf("%+v got %d %s", tc, w.Code, w.Body.String())
		}
	}
	r := ownerTestRequest("POST", "/api/auth/check", "{}", token, true)
	r.Header.Set("Origin", "https://evil.example")
	if w := ownerCall(r); w.Code != 403 {
		t.Fatalf("foreign origin accepted: %d", w.Code)
	}
	for _, column := range []string{"last_seen", "expires_at"} {
		token = testOwnerSession(t, "owner")
		if _, err := db.Exec("UPDATE owner_sessions SET "+column+"=1 WHERE token_hash=?", accessDigest(token)); err != nil {
			t.Fatal(err)
		}
		if w := ownerCall(ownerTestRequest("GET", "/api/auth/check", "", token, false)); w.Code != 401 {
			t.Fatalf("expired %s accepted", column)
		}
	}
}

func TestOwnerRecoveryIsSingleUseAndLimited(t *testing.T) {
	setupOwnerTest(t)
	tx, _ := db.Begin()
	codes, err := replaceRecoveryCodes(tx)
	if err != nil {
		t.Fatal(err)
	}
	tx.Commit()
	var stored string
	db.QueryRow("SELECT code_hash FROM owner_recovery_codes LIMIT 1").Scan(&stored)
	for _, code := range codes {
		if stored == code {
			t.Fatal("plaintext recovery code stored")
		}
	}
	body, _ := json.Marshal(map[string]string{"code": codes[0]})
	w := ownerCall(ownerTestRequest("POST", "/api/auth/recover", string(body), "", false))
	if w.Code != 200 {
		t.Fatalf("recovery: %d %s", w.Code, w.Body.String())
	}
	cookies := w.Result().Cookies()
	token := cookies[0].Value
	if !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode || cookies[0].MaxAge != 300 {
		t.Fatal("unsafe recovery cookie")
	}
	for _, endpoint := range []string{"/api/portfolio", "/api/auth/check", "/api/auth/refresh", "/api/auth/revoke-all"} {
		method := "GET"
		if strings.Contains(endpoint, "refresh") || strings.Contains(endpoint, "revoke-all") {
			method = "POST"
		}
		if w := ownerCall(ownerTestRequest(method, endpoint, "{}", token, true)); w.Code != 403 {
			t.Fatalf("recovery grant authorized %s: %d", endpoint, w.Code)
		}
	}
	if w := ownerCall(ownerTestRequest("POST", "/api/auth/recover", string(body), "", false)); w.Code != 401 {
		t.Fatal("reused recovery code accepted")
	}
}

func TestOwnerLogoutAndRevokeAll(t *testing.T) {
	setupOwnerTest(t)
	a, b := testOwnerSession(t, "owner"), testOwnerSession(t, "owner")
	if w := ownerCall(ownerTestRequest("POST", "/api/auth/logout", "{}", a, true)); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w := ownerCall(ownerTestRequest("GET", "/api/auth/check", "", a, false)); w.Code != 401 {
		t.Fatal("logout did not revoke")
	}
	if w := ownerCall(ownerTestRequest("GET", "/api/auth/check", "", b, false)); w.Code != 204 {
		t.Fatal("logout revoked another session")
	}
	db.Exec("UPDATE owner_sessions SET created_at=? WHERE token_hash=?", time.Now().Unix()-700, accessDigest(b))
	if w := ownerCall(ownerTestRequest("POST", "/api/auth/revoke-all", "{}", b, true)); w.Code != 403 {
		t.Fatal("stale session changed access")
	}
	c := testOwnerSession(t, "owner")
	if w := ownerCall(ownerTestRequest("POST", "/api/auth/revoke-all", "{}", c, true)); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w := ownerCall(ownerTestRequest("GET", "/api/auth/check", "", b, false)); w.Code != 401 {
		t.Fatal("revoke-all did not revoke other session")
	}
}

func TestOwnerEnrollmentChallengesAndConfig(t *testing.T) {
	setupOwnerTest(t)
	if w := ownerCall(ownerTestRequest("POST", "/api/auth/register/start", `{"setup_token":"bad"}`, "", false)); w.Code != 401 {
		t.Fatal("bad setup accepted")
	}
	body, _ := json.Marshal(map[string]string{"setup_token": testSetupToken})
	w := ownerCall(ownerTestRequest("POST", "/api/auth/register/start", string(body), "", false))
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var opts struct {
		PublicKey struct {
			AuthenticatorSelection struct {
				UserVerification string `json:"userVerification"`
			} `json:"authenticatorSelection"`
		} `json:"publicKey"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &opts); err != nil || opts.PublicKey.AuthenticatorSelection.UserVerification != "required" {
		t.Fatal("user verification not required")
	}
	cookie := w.Result().Cookies()[0]
	r := ownerTestRequest("POST", "/api/auth/register/finish", "{}", "", false)
	r.AddCookie(cookie)
	data, _, err := takeOwnerChallenge(httptest.NewRecorder(), r, "register")
	if err != nil || len(data.UserID) == 0 {
		t.Fatal(err)
	}
	if _, _, err = takeOwnerChallenge(httptest.NewRecorder(), r, "register"); err == nil {
		t.Fatal("challenge replay accepted")
	}
	db.Exec("INSERT INTO owner_account VALUES(1,?,?)", []byte("owner"), time.Now().Unix())
	if w := ownerCall(ownerTestRequest("POST", "/api/auth/register/start", string(body), "", false)); w.Code != 401 {
		t.Fatal("setup token reused after enrollment")
	}
	for _, origin := range []string{"http://example.com", "https://example.com/path", "https://user:pass@example.com", ""} {
		t.Setenv("APP_ORIGIN", origin)
		if configureOwnerAccess() == nil {
			t.Fatalf("bad origin accepted %s", origin)
		}
	}
	t.Setenv("APP_ORIGIN", "https://private.example.com")
	if err := configureOwnerAccess(); err != nil {
		t.Fatal(err)
	}
	w = httptest.NewRecorder()
	setAccessCookie(w, "session", "test", 600)
	cookie = w.Result().Cookies()[0]
	if !cookie.Secure || !cookie.HttpOnly || cookie.Domain != "" || cookie.Path != "/" || !strings.HasPrefix(cookie.Name, "__Host-") {
		t.Fatal("unsafe production cookie")
	}
}

func TestOwnerRateLimitAndExpiredChallenge(t *testing.T) {
	setupOwnerTest(t)
	for i := 0; i < 30; i++ {
		if !ownerRateLimit(httptest.NewRecorder(), httptest.NewRequest("POST", "/", nil)) {
			t.Fatal("premature rate limit")
		}
	}
	w := httptest.NewRecorder()
	if ownerRateLimit(w, httptest.NewRequest("POST", "/", nil)) || w.Code != 429 {
		t.Fatal("rate limit missing")
	}
	saveOwnerChallenge(httptest.NewRecorder(), httptest.NewRequest("POST", "/", nil), "login", "", &webauthn.SessionData{}, map[string]string{})
	db.Exec("UPDATE owner_challenges SET expires_at=1")
	if _, _, err := takeOwnerChallenge(httptest.NewRecorder(), httptest.NewRequest("POST", "/", nil), "login"); err == nil {
		t.Fatal("expired challenge accepted")
	}
}

// Only the browser integration harness enables this isolated, temporary server.
// No schedulers, provider clients, production DBs or real credentials are used.
func TestOwnerBrowserServer(t *testing.T) {
	if os.Getenv("OWNER_BROWSER_TEST") != "1" {
		t.Skip("browser harness only")
	}
	setupOwnerTest(t)
	address := os.Getenv("OWNER_BROWSER_ADDRESS")
	if !strings.HasPrefix(address, "127.0.0.1:") {
		t.Fatal("loopback required")
	}
	t.Log("Isolated owner browser test server ready")
	t.Fatal(http.ListenAndServe(address, newRouter()))
}
