# Manual Perplexity Enrichment Prompts

These markdown files are Stage 1 retrieval briefs for Perplexity Deep Research or equivalent active research UIs.

Source of truth:
- Existing specialist briefs are synced from `docs/perplexity-enrichment-prompts/manual/*.md` in the separate Alpha Edge Intelligence repository.
- New companion briefs are generated from that repository's `docs/copy-paste-analysis-prompts/*.yaml` metadata and sourcing rules.

Rules for this folder:
- The root `*.md` files are retrieval-first prompts.
- They should not ask Perplexity to enforce the full extraction schema.
- They should return a source packet, not an investment memo.
- They should exclude recommendations, price targets, NAV, NPV, rNPV, DCF, fair value, and analyst opinions.
- Replace all bracketed placeholders before running.
- Preserve wrong-company or unsupported material under `rejected_sources`.

Current UI retrieval template coverage: 44 template IDs.
Generated companion brief files for new templates: 16.
