package main

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
)

type ownerAccessConfig struct {
	enabled   bool
	origin    string
	secure    bool
	setupHash string
	web       *webauthn.WebAuthn
}

var ownerAccess ownerAccessConfig

func configureOwnerAccess() error {
	ownerAccess = ownerAccessConfig{}
	mode := strings.TrimSpace(os.Getenv("APP_ACCESS_MODE"))
	if mode == "" || mode == "legacy" {
		return nil
	}
	if mode != "owner" {
		return fmt.Errorf("backend APP_ACCESS_MODE must be owner or legacy; the public demo has no backend")
	}
	if auth.disabled {
		return fmt.Errorf("owner access cannot run with AUTH_DISABLED")
	}
	raw := strings.TrimSpace(os.Getenv("APP_ORIGIN"))
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" {
		return fmt.Errorf("APP_ORIGIN must be an exact origin without path, query or credentials")
	}
	local := u.Hostname() == "localhost"
	if u.Scheme != "https" && !(local && u.Scheme == "http") {
		return fmt.Errorf("owner access requires HTTPS (except localhost development; passkeys require a domain, not an IP)")
	}
	setup := strings.TrimSpace(os.Getenv("OWNER_SETUP_TOKEN_SHA256"))
	if setup != "" {
		if decoded, e := hex.DecodeString(setup); e != nil || len(decoded) != 32 {
			return fmt.Errorf("OWNER_SETUP_TOKEN_SHA256 must be a SHA-256 hex digest")
		}
	}
	web, err := webauthn.New(&webauthn.Config{
		RPDisplayName: "Alpha Edge", RPID: u.Hostname(), RPOrigins: []string{raw},
		AuthenticatorSelection: protocol.AuthenticatorSelection{ResidentKey: protocol.ResidentKeyRequirementRequired, UserVerification: protocol.VerificationRequired},
	})
	if err != nil {
		return err
	}
	ownerAccess = ownerAccessConfig{true, raw, u.Scheme == "https", setup, web}
	return nil
}

func accessDigest(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
func accessRandom() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func accessCookieName(kind string) string {
	if ownerAccess.secure {
		return "__Host-alpha-edge-" + kind
	}
	return "alpha-edge-local-" + kind
}
func accessCookie(r *http.Request, kind string) string {
	c, err := r.Cookie(accessCookieName(kind))
	if err != nil {
		return ""
	}
	return c.Value
}
func setAccessCookie(w http.ResponseWriter, kind, value string, age int) {
	http.SetCookie(w, &http.Cookie{Name: accessCookieName(kind), Value: value, Path: "/", HttpOnly: true, Secure: ownerAccess.secure, SameSite: http.SameSiteStrictMode, MaxAge: age})
}
func accessJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func accessError(w http.ResponseWriter, status int, message string) {
	accessJSON(w, status, map[string]string{"error": message})
}
func validOwnerOrigin(r *http.Request) bool { return r.Header.Get("Origin") == ownerAccess.origin }
func ownerCSRF(r *http.Request) bool {
	token := accessCookie(r, "session")
	return token != "" && validOwnerOrigin(r) && secureEquals(r.Header.Get("X-CSRF-Token"), accessDigest("csrf:"+token))
}
func ownerSession(r *http.Request) (scope string, created int64, err error) {
	token := accessCookie(r, "session")
	if token == "" || len(token) > 128 {
		return "", 0, sql.ErrNoRows
	}
	now := time.Now().Unix()
	err = db.QueryRowContext(r.Context(), `SELECT scope,created_at FROM owner_sessions WHERE token_hash=? AND expires_at>? AND last_seen>?`, accessDigest(token), now, now-86400).Scan(&scope, &created)
	return
}
func ownerAuthorized(w http.ResponseWriter, r *http.Request) bool {
	scope, _, err := ownerSession(r)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			accessError(w, 503, "Session verification unavailable")
		} else {
			writeUnauthorized(w)
		}
		return false
	}
	if scope != "owner" {
		accessError(w, 403, "Finish account recovery first")
		return false
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead && !ownerCSRF(r) {
		accessError(w, 403, "Request verification failed")
		return false
	}
	w.Header().Set("Cache-Control", "no-store")
	return true
}

type ownerUser struct {
	handle      []byte
	credentials []webauthn.Credential
}

func (u ownerUser) WebAuthnID() []byte                         { return u.handle }
func (u ownerUser) WebAuthnName() string                       { return "Owner" }
func (u ownerUser) WebAuthnDisplayName() string                { return "Alpha Edge owner" }
func (u ownerUser) WebAuthnCredentials() []webauthn.Credential { return u.credentials }
func loadOwner() (ownerUser, error) {
	var u ownerUser
	if err := db.QueryRow(`SELECT user_handle FROM owner_account WHERE id=1`).Scan(&u.handle); err != nil {
		return u, err
	}
	rows, err := db.Query(`SELECT credential_json FROM owner_credentials ORDER BY created_at`)
	if err != nil {
		return u, err
	}
	defer rows.Close()
	for rows.Next() {
		var raw string
		var c webauthn.Credential
		if err = rows.Scan(&raw); err != nil {
			return u, err
		}
		if err = json.Unmarshal([]byte(raw), &c); err != nil {
			return u, err
		}
		u.credentials = append(u.credentials, c)
	}
	return u, rows.Err()
}

func ownerRateLimit(w http.ResponseWriter, r *http.Request) bool {
	// One private owner; a durable global ceiling also bounds anonymous storage
	// and avoids trusting spoofable forwarding headers for rate-limit identity.
	window := time.Now().Unix() / 60
	var attempts int
	err := db.QueryRowContext(r.Context(), `INSERT INTO owner_auth_limits(bucket,window_start,attempts) VALUES('ceremony',?,1)
        ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN window_start=excluded.window_start THEN attempts+1 ELSE 1 END,window_start=excluded.window_start RETURNING attempts`, window).Scan(&attempts)
	if err != nil {
		accessError(w, 503, "Sign-in temporarily unavailable")
		return false
	}
	if attempts > 30 {
		w.Header().Set("Retry-After", "60")
		accessError(w, 429, "Too many attempts. Try again in a minute.")
		return false
	}
	return true
}
func saveOwnerChallenge(w http.ResponseWriter, r *http.Request, purpose, grant string, data *webauthn.SessionData, options any) {
	raw, err := json.Marshal(data)
	if err != nil {
		accessError(w, 500, "Cannot create sign-in challenge")
		return
	}
	token := accessRandom()
	_, err = db.ExecContext(r.Context(), `INSERT INTO owner_challenges(token_hash,purpose,session_json,grant_hash,expires_at) VALUES(?,?,?,?,?)`, accessDigest(token), purpose, string(raw), grant, time.Now().Add(5*time.Minute).Unix())
	if err != nil {
		accessError(w, 503, "Cannot save sign-in challenge")
		return
	}
	_, _ = db.ExecContext(r.Context(), `DELETE FROM owner_challenges WHERE expires_at<?`, time.Now().Unix())
	setAccessCookie(w, "challenge", token, 300)
	accessJSON(w, 200, options)
}
func takeOwnerChallenge(w http.ResponseWriter, r *http.Request, purpose string) (webauthn.SessionData, string, error) {
	var data webauthn.SessionData
	var raw, grant string
	token := accessCookie(r, "challenge")
	setAccessCookie(w, "challenge", "", -1)
	// Consume before verification: unsuccessful and concurrent replays cannot reuse it.
	err := db.QueryRowContext(r.Context(), `DELETE FROM owner_challenges WHERE token_hash=? AND purpose=? AND expires_at>? RETURNING session_json,grant_hash`, accessDigest(token), purpose, time.Now().Unix()).Scan(&raw, &grant)
	if err == nil {
		err = json.Unmarshal([]byte(raw), &data)
	}
	return data, grant, err
}
func insertOwnerSession(tx *sql.Tx, scope string) (string, error) {
	token := accessRandom()
	now := time.Now().Unix()
	duration := int64(7 * 86400)
	if scope == "recovery" {
		duration = 300
	}
	_, err := tx.Exec(`INSERT INTO owner_sessions(token_hash,scope,created_at,last_seen,expires_at) VALUES(?,?,?,?,?)`, accessDigest(token), scope, now, now, now+duration)
	return token, err
}
func writeOwnerSession(w http.ResponseWriter, token string, codes []string) {
	setAccessCookie(w, "session", token, 7*86400)
	accessJSON(w, 200, map[string]any{"authenticated": true, "csrf_token": accessDigest("csrf:" + token), "recovery_codes": codes})
}
func replaceRecoveryCodes(tx *sql.Tx) ([]string, error) {
	if _, err := tx.Exec(`DELETE FROM owner_recovery_codes`); err != nil {
		return nil, err
	}
	codes := make([]string, 8)
	for i := range codes {
		codes[i] = accessRandom()
		if _, err := tx.Exec(`INSERT INTO owner_recovery_codes(code_hash,created_at) VALUES(?,?)`, accessDigest(codes[i]), time.Now().Unix()); err != nil {
			return nil, err
		}
	}
	return codes, nil
}

func ownerAccessHandler(w http.ResponseWriter, r *http.Request) {
	if !ownerAccess.enabled {
		accessError(w, 404, "Owner sessions not enabled")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	action := strings.TrimPrefix(r.URL.Path, "/api/auth/")
	if r.Method == http.MethodGet && action == "session" {
		scope, _, err := ownerSession(r)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			accessError(w, 503, "Session verification unavailable")
			return
		}
		var count int
		if e := db.QueryRow(`SELECT count(*) FROM owner_account`).Scan(&count); e != nil {
			accessError(w, 503, "Owner access unavailable")
			return
		}
		result := map[string]any{"authenticated": err == nil && scope == "owner", "recovery": err == nil && scope == "recovery", "enrolled": count > 0}
		if err == nil {
			result["csrf_token"] = accessDigest("csrf:" + accessCookie(r, "session"))
		}
		accessJSON(w, 200, result)
		return
	}
	if r.Method != http.MethodPost {
		accessError(w, 405, "Method not allowed")
		return
	}
	if !validOwnerOrigin(r) {
		accessError(w, 403, "Request origin rejected")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	if action == "logout" || action == "refresh" || action == "revoke-all" {
		scope, created, err := ownerSession(r)
		if err != nil {
			writeUnauthorized(w)
			return
		}
		if !ownerCSRF(r) {
			accessError(w, 403, "Request verification failed")
			return
		}
		tokenHash := accessDigest(accessCookie(r, "session"))
		switch action {
		case "refresh":
			if scope != "owner" {
				accessError(w, 403, "Recovery must be completed")
				return
			}
			_, err = db.ExecContext(r.Context(), `UPDATE owner_sessions SET last_seen=? WHERE token_hash=?`, time.Now().Unix(), tokenHash)
		case "revoke-all":
			if scope != "owner" || time.Now().Unix()-created > 600 {
				accessError(w, 403, "Sign in again before changing account access")
				return
			}
			_, err = db.ExecContext(r.Context(), `DELETE FROM owner_sessions`)
		default:
			_, err = db.ExecContext(r.Context(), `DELETE FROM owner_sessions WHERE token_hash=?`, tokenHash)
		}
		if err != nil {
			accessError(w, 503, "Session update failed")
			return
		}
		if action != "refresh" {
			setAccessCookie(w, "session", "", -1)
		}
		accessJSON(w, 200, map[string]bool{"ok": true})
		return
	}
	if !ownerRateLimit(w, r) {
		return
	}
	switch action {
	case "register/start":
		ownerRegisterStart(w, r)
	case "register/finish":
		ownerRegisterFinish(w, r)
	case "login/start":
		u, err := loadOwner()
		if err != nil {
			accessError(w, 401, "Owner sign-in unavailable")
			return
		}
		opts, data, err := ownerAccess.web.BeginLogin(u, webauthn.WithUserVerification(protocol.VerificationRequired))
		if err != nil {
			accessError(w, 500, "Cannot start passkey sign-in")
			return
		}
		saveOwnerChallenge(w, r, "login", "", data, opts)
	case "login/finish":
		ownerLoginFinish(w, r)
	case "recover":
		ownerRecover(w, r)
	default:
		accessError(w, 404, "Unknown authentication operation")
	}
}

func ownerRegisterStart(w http.ResponseWriter, r *http.Request) {
	u, err := loadOwner()
	purpose := "register"
	grant := "bootstrap"
	if errors.Is(err, sql.ErrNoRows) {
		var body struct {
			SetupToken string `json:"setup_token"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil || len(body.SetupToken) < 32 || !secureEquals(accessDigest(body.SetupToken), ownerAccess.setupHash) {
			writeUnauthorized(w)
			return
		}
		u.handle = []byte(accessRandom())
	} else if err != nil {
		accessError(w, 503, "Owner access unavailable")
		return
	} else {
		scope, created, e := ownerSession(r)
		if e != nil {
			writeUnauthorized(w)
			return
		}
		if !ownerCSRF(r) || (scope != "recovery" && time.Now().Unix()-created > 600) {
			accessError(w, 403, "Sign in again before adding a passkey")
			return
		}
		grant = accessDigest(accessCookie(r, "session"))
		if scope == "recovery" {
			u.credentials = nil
		}
	}
	opts, data, err := ownerAccess.web.BeginRegistration(u, webauthn.WithExclusions(webauthn.Credentials(u.credentials).CredentialDescriptors()))
	if err != nil {
		accessError(w, 500, "Cannot start passkey registration")
		return
	}
	saveOwnerChallenge(w, r, purpose, grant, data, opts)
}

func ownerRegisterFinish(w http.ResponseWriter, r *http.Request) {
	data, grant, err := takeOwnerChallenge(w, r, "register")
	if err != nil {
		accessError(w, 401, "Passkey challenge expired or already used")
		return
	}
	u := ownerUser{handle: data.UserID}
	credential, err := ownerAccess.web.FinishRegistration(u, data, r)
	if err != nil {
		accessError(w, 401, "Passkey registration could not be verified")
		return
	}
	tx, err := db.BeginTx(r.Context(), nil)
	if err != nil {
		accessError(w, 503, "Registration unavailable")
		return
	}
	defer tx.Rollback()
	var codes []string
	if grant == "bootstrap" {
		_, err = tx.Exec(`INSERT INTO owner_account(id,user_handle,created_at) VALUES(1,?,?)`, data.UserID, time.Now().Unix())
		if err != nil {
			accessError(w, 409, "Owner already enrolled")
			return
		}
		codes, err = replaceRecoveryCodes(tx)
	} else {
		var scope string
		var handle []byte
		var created int64
		err = tx.QueryRow(`SELECT scope,created_at FROM owner_sessions WHERE token_hash=? AND expires_at>? AND last_seen>?`, grant, time.Now().Unix(), time.Now().Unix()-86400).Scan(&scope, &created)
		if err != nil || (scope == "owner" && time.Now().Unix()-created > 600) || !secureEquals(grant, accessDigest(accessCookie(r, "session"))) || !ownerCSRF(r) {
			accessError(w, 401, "Registration permission expired")
			return
		}
		if err = tx.QueryRow(`SELECT user_handle FROM owner_account WHERE id=1`).Scan(&handle); err != nil || !secureEquals(string(handle), string(data.UserID)) {
			accessError(w, 401, "Owner mismatch")
			return
		}
		if scope == "recovery" {
			if _, err = tx.Exec(`DELETE FROM owner_credentials; DELETE FROM owner_sessions; DELETE FROM owner_challenges;`); err == nil {
				codes, err = replaceRecoveryCodes(tx)
			}
		} else {
			_, err = tx.Exec(`DELETE FROM owner_sessions WHERE token_hash=?`, grant)
		}
	}
	if err != nil {
		accessError(w, 503, "Cannot save recovery codes")
		return
	}
	raw, err := json.Marshal(credential)
	if err == nil {
		_, err = tx.Exec(`INSERT INTO owner_credentials(id,credential_json,created_at) VALUES(?,?,?)`, base64.RawURLEncoding.EncodeToString(credential.ID), string(raw), time.Now().Unix())
	}
	if err != nil {
		accessError(w, 409, "Passkey could not be saved")
		return
	}
	token, err := insertOwnerSession(tx, "owner")
	if err != nil || tx.Commit() != nil {
		accessError(w, 503, "Session could not be saved")
		return
	}
	writeOwnerSession(w, token, codes)
}

func ownerLoginFinish(w http.ResponseWriter, r *http.Request) {
	data, _, err := takeOwnerChallenge(w, r, "login")
	if err != nil {
		accessError(w, 401, "Sign-in challenge expired or already used")
		return
	}
	u, err := loadOwner()
	if err != nil {
		accessError(w, 503, "Owner unavailable")
		return
	}
	credential, err := ownerAccess.web.FinishLogin(u, data, r)
	if err != nil || credential.Authenticator.CloneWarning {
		accessError(w, 401, "Passkey could not be verified")
		return
	}
	raw, err := json.Marshal(credential)
	if err != nil {
		accessError(w, 500, "Passkey update failed")
		return
	}
	tx, err := db.BeginTx(r.Context(), nil)
	if err != nil {
		accessError(w, 503, "Sign-in unavailable")
		return
	}
	defer tx.Rollback()
	var previous []byte
	for _, candidate := range u.credentials {
		if secureEquals(string(candidate.ID), string(credential.ID)) {
			previous, err = json.Marshal(candidate)
			break
		}
	}
	// Reject concurrent updates instead of rolling an authenticator counter back.
	result, err := tx.Exec(`UPDATE owner_credentials SET credential_json=? WHERE id=? AND credential_json=?`, string(raw), base64.RawURLEncoding.EncodeToString(credential.ID), string(previous))
	if err != nil {
		accessError(w, 503, "Passkey update failed")
		return
	}
	count, _ := result.RowsAffected()
	if count != 1 {
		writeUnauthorized(w)
		return
	}
	if old := accessCookie(r, "session"); old != "" {
		if _, err = tx.Exec(`DELETE FROM owner_sessions WHERE token_hash=?`, accessDigest(old)); err != nil {
			accessError(w, 503, "Session rotation failed")
			return
		}
	}
	if _, err = tx.Exec(`DELETE FROM owner_sessions WHERE expires_at<? OR last_seen<?`, time.Now().Unix(), time.Now().Unix()-86400); err != nil {
		accessError(w, 503, "Session cleanup failed")
		return
	}
	token, err := insertOwnerSession(tx, "owner")
	if err != nil || tx.Commit() != nil {
		accessError(w, 503, "Session could not be saved")
		return
	}
	writeOwnerSession(w, token, nil)
}

func ownerRecover(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Code string `json:"code"`
	}
	if json.NewDecoder(r.Body).Decode(&body) != nil || len(body.Code) > 128 {
		accessError(w, 400, "Enter a recovery code")
		return
	}
	tx, err := db.BeginTx(r.Context(), nil)
	if err != nil {
		accessError(w, 503, "Recovery unavailable")
		return
	}
	defer tx.Rollback()
	result, err := tx.Exec(`DELETE FROM owner_recovery_codes WHERE code_hash=?`, accessDigest(strings.TrimSpace(body.Code)))
	if err != nil {
		accessError(w, 503, "Recovery unavailable")
		return
	}
	count, _ := result.RowsAffected()
	if count != 1 {
		writeUnauthorized(w)
		return
	}
	token, err := insertOwnerSession(tx, "recovery")
	if err != nil || tx.Commit() != nil {
		accessError(w, 503, "Recovery could not be started")
		return
	}
	setAccessCookie(w, "session", token, 300)
	accessJSON(w, 200, map[string]any{"recovery": true, "csrf_token": accessDigest("csrf:" + token)})
}
