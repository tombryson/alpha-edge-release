package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// Export only a freshly seeded, in-memory registry, never an owner database.
func TestDemoAssetClassCatalogue(t *testing.T) {
	cleanup := setupSecurityActionTestDB(t)
	defer cleanup()
	catalogue := struct {
		AssetClasses []AssetClass               `json:"assetClasses"`
		Config       []OverlayAssetClassSetting `json:"config"`
	}{loadAssetClasses(), getOverlayAssetClassSettings()}
	if len(catalogue.AssetClasses) < 40 || len(catalogue.Config) < 40 {
		t.Fatal("asset-class registry was not fully seeded")
	}
	data, err := json.MarshalIndent(catalogue, "", "    ")
	if err != nil {
		t.Fatal(err)
	}
	output := append([]byte("// Generated from the backend's seeded defaults. Do not edit by hand.\n// Regenerate: npm run demo:catalogue\nexport const DEMO_ASSET_CLASS_CATALOGUE = "), data...)
	output = append(output, []byte(";\n")...)
	path := filepath.Join("..", "lib", "demo-asset-classes.generated.ts")
	if os.Getenv("UPDATE_DEMO_CATALOGUE") == "1" {
		if err := os.WriteFile(path, output, 0644); err != nil {
			t.Fatal(err)
		}
	}
	stored, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(stored, output) {
		t.Fatal("demo asset-class catalogue differs from backend defaults; run npm run demo:catalogue")
	}
}
