package main

import (
	"net/http"
	"regexp"
	"strings"
)

const assetClassColourSettingPrefix = "asset_class_colour:"

var assetClassColourCodePattern = regexp.MustCompile(`^[A-Z][A-Z0-9_]{0,119}$`)
var assetClassColourHexPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// Colours are presentation settings, separate from seeded alert metadata and class budgets.
func validateAssetClassColourSettings(updates map[string]string) (int, string) {
	for key, value := range updates {
		if !strings.HasPrefix(key, assetClassColourSettingPrefix) {
			continue
		}
		code := strings.TrimPrefix(key, assetClassColourSettingPrefix)
		if !assetClassColourCodePattern.MatchString(code) {
			return http.StatusBadRequest, "Invalid asset-class colour key"
		}
		value = strings.TrimSpace(value)
		if value != "" && !assetClassColourHexPattern.MatchString(value) {
			return http.StatusBadRequest, "Class colour must be #RRGGBB or empty to restore the default"
		}
		var exists bool
		if err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM asset_classes WHERE code = ?)`, code).Scan(&exists); err != nil {
			return http.StatusInternalServerError, "Unable to verify asset class"
		}
		if !exists {
			return http.StatusBadRequest, "Unknown asset class"
		}
		updates[key] = strings.ToLower(value)
	}
	return 0, ""
}
