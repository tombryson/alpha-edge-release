# Mining Services Stage 1 Retrieval Brief

This is the prompt to paste into Perplexity Deep Research or another active research UI. It is intentionally retrieval-focused. Use the returned source packet as the attachment/input for the normal enrichment or council flow.

## Copy/Paste Prompt

```text
ASSET_CLASS: mining_services
EXCHANGE: [EXCHANGE_CODE]
TICKER: [EXCHANGE_CODE]:[TICKER]
COMPANY: [COMPANY_NAME]
PRIMARY_SERVICE_LINE: [PRIMARY_SERVICE_LINE]
TEMPLATE: mining_services
COMPANY_TYPES: mining_services

Research [COMPANY_NAME] ([EXCHANGE_CODE]:[TICKER]) for a downstream mining services enrichment pipeline.

You are performing source retrieval for a downstream enrichment pipeline.

Your job is to find and organise source material. Do not perform investment analysis.
Do not provide buy/sell/hold recommendations. Do not calculate valuation.
Do not provide price targets, NAV, NPV, rNPV, DCF, fair value, or scenario probabilities.
Do not infer facts not present in named sources.

Use this brief for contract mining, mineral drilling, blasting/explosives, mining equipment hire, maintenance, mine-site services, camps/logistics, and mining EPCM. Do not treat the company as a miner unless it owns the resource, mine, or commodity production economics.

Replace every bracketed placeholder before running this prompt. If any required placeholder is still unresolved, stop and ask for the missing value.

Retrieval requirements:
- Prefer primary filings and regulator records before company marketing pages.
- Include direct URLs where available, not homepages.
- Include source dates and named source bodies.
- Capture factual details useful for a downstream extractor.
- Preserve uncertainty and gaps. Do not guess.
- Broker or analyst material is allowed only for factual references; exclude recommendations, targets, valuation outputs, and opinions.
- If you find likely wrong-company contamination, list it under rejected_sources with the reason.

Return a source packet, not an investment memo.

Source priorities for this asset class:
- Exchange filings, annual/interim reports, quarterly updates, investor presentations, contract announcements, tender/backlog updates, customer disclosures, safety/regulator records, debt/facility documents, fleet/capex disclosures, acquisition documents, and industry data on mining capex, exploration drilling, production activity, equipment utilisation, labour availability, and customer commodity budgets.
- Company evidence on revenue split by service line, geography, commodity exposure, customer concentration, contract duration, renewal/repricing cadence, order book/backlog, tender pipeline, utilisation, fleet age/intensity, working capital, safety performance, cash conversion, debt, lease liabilities, and maintenance capex.
- Customer-cycle evidence showing whether miners are expanding, deferring, cancelling, or repricing work across the company's exposed commodities and jurisdictions.

Target source material that can answer these downstream enrichment questions:
- Evidence for Quality factors: Revenue Visibility; Contract Quality; Utilisation and Execution; Cash Conversion; Balance Sheet; Customer and Commodity Diversification
- Evidence for Value factors: Normalized Earnings vs Market Cap; EV/EBITDA vs Cycle and Peers; FCF Yield; Fleet/Asset Replacement Value; Strategic Value
- Named customers, contracts, service lines, fleet/assets, counterparties, renewals, tenders, safety incidents, labour constraints, margin drivers, and financial drivers
- Recent filings or announcements that materially update revenue, margins, cash flow, funding, leverage, capex, project timing, customer budgets, regulation, litigation, or competitive position
- Primary-source facts that either confirm or challenge the company's stated thesis

Output exactly this JSON-compatible structure. The factual_summary arrays may contain detailed bullet strings, but keep them source-grounded.

{
  "company": "[COMPANY_NAME]",
  "ticker": "[EXCHANGE_CODE]:[TICKER]",
  "exchange": "[EXCHANGE_CODE]",
  "asset_class": "mining_services",
  "retrieval_date": "YYYY-MM-DD",
  "source_count": integer,
  "sources": [
    {
      "title": "string",
      "source_type": "primary_filing | regulator_record | company_material | counterparty_document | customer_disclosure | government_record | industry_dataset | broker_factual_note | other",
      "url": "string | null",
      "date": "string",
      "named_source": "string",
      "factual_summary": ["string"],
      "relevance": "string"
    }
  ],
  "rejected_sources": [
    {
      "title": "string",
      "url": "string | null",
      "reason": "wrong company | unsupported claim | valuation opinion | duplicate | low relevance | inaccessible"
    }
  ],
  "known_gaps": ["string"]
}
```
