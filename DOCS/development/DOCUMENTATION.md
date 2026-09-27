# Documentation Maintenance

Status: current contributor standard, 11 September 2026.

## One Owner Per Concern

System rules belong in the [system ownership map](../system/README.md). API route
inventory is generated from source; human payload semantics remain in the API
reference and contract annotations. User task prose belongs in `DOCS/user`.
Staged decisions belong in `decisions`; superseded references belong in `archive`.
The GitHub README introduces the product and links inward rather than duplicating
all rules.

Current references must distinguish implemented, agreed-but-pending and historical
sections. Do not update an audit date to today after merely moving a file.
Do not infer production deployment from the source branch or a passing local test.

## Change Checklist

1. Identify the rule or workflow owner before editing.
2. Check handler validation, persistence, callers and relevant tests.
3. Update the canonical rule and link to it from dependent guides.
4. For API changes, update `DOCS/api/contracts.json` and relevant payload detail.
5. For user-facing changes, update the shared Markdown guide and regenerate Help.
6. Run generation, audits and focused regressions. Note any coverage that remains untested.

PineScript sources are kept in the private repository. When importing new exports,
follow the source inventory, keep supplied-source hashes and payload examples aligned, distinguish imported
code from intended policy, and run `node --test tests/pinescript-sources.test.mjs`.
Do not label a repository refresh as a live TradingView deployment.

## Commands

```sh
npm run docs:generate
npm run docs:audit
npm run test:docs
```

Generation does not start the application or contact a backend. Go's AST extracts
registered methods and paths; TypeScript's AST extracts Next route methods.
Missing contract annotations, removed routes, duplicate operations and stale
generated files fail the audit. OpenAPI is schema-validated with external
reference resolution disabled; it is not evidence that undocumented responses
are correct.

The audit also checks Markdown file links, heading anchors, source line anchors,
machine-specific links, directory index coverage and Help output freshness.
External websites are not fetched: remote link liveness remains outside the
offline check. Legacy retired-document absence checks must not ban the root README.

## Shared Help

Edit `DOCS/user/*.md`; `sections.json` owns order and navigation labels.
Keep one H1, one introductory paragraph, then H2 sections, paragraphs and flat
lists. The generator rejects unsupported HTML or unsafe links rather than
silently injecting content. In-app rendering uses React nodes, not raw HTML.

`paths.json` owns diagram labels, nodes and results. Its generated SVGs are
readable on GitHub and the same data renders the themed nodes/lines in Help.
Keep diagram meaning and state names aligned with Markets, not retired Markets2.
Generated Help content is committed and rebuilt before development/build.

## Portable Links And Examples

Use repository-relative Markdown links, not local home-directory paths. Source
line links may use `#L123`; prefer function/file references where lines move often.
Use synthetic examples and placeholders for credentials. Do not publish actual
broker statements, holdings exports, tokens or environment files.

Archive old wording rather than erasing useful reasoning. The archive banner must
say it is historical. A design with shipped and unshipped sections is not itself
a release certificate. Put new deployment notes under `operations` by date.
