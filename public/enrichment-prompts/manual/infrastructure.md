# Infrastructure Stage 1 Retrieval Brief

```text
ASSET_CLASS: infrastructure
EXCHANGE: [EXCHANGE_CODE]
TICKER: [EXCHANGE_CODE]:[TICKER]
COMPANY: [COMPANY_NAME]
TEMPLATE: infrastructure
COMPANY_TYPES: infrastructure

Retrieve source material for [COMPANY_NAME] ([EXCHANGE_CODE]:[TICKER]).
Return a factual source packet, not investment analysis. Do not recommend trades,
calculate valuation, assign scores or price targets, or estimate missing values.
Prefer primary filings, regulator records and named counterparty documents.
Give direct document URLs, document dates and named source bodies. Preserve gaps.

Capture owned assets, concessions, regulatory terms, utilisation, contract duration,
inflation linkage, maintenance and growth capex, cash conversion, leverage,
refinancing dates and distribution coverage. Include 2-4 recent primary industry
sources on regulation, funding and demand where relevant. Distinguish owners and
operators from construction contractors. Reject wrong-company sources explicitly.

Return JSON with exactly this structure:
{
  "company": "[COMPANY_NAME]",
  "ticker": "[EXCHANGE_CODE]:[TICKER]",
  "exchange": "[EXCHANGE_CODE]",
  "asset_class": "infrastructure",
  "retrieval_date": "YYYY-MM-DD",
  "source_count": 0,
  "sources": [{"title":"string", "source_type":"primary_filing", "url":null, "date":"string", "named_source":"string", "factual_summary":["string"], "relevance":"string"}],
  "rejected_sources": [{"title":"string", "url":null, "reason":"string"}],
  "known_gaps": ["string"]
}
Set source_count to the actual number of returned sources. Use null for unavailable
URLs and describe missing evidence in known_gaps; do not fabricate documents.
```
