# Media & Publishing Stage 1 Retrieval Brief

This is the prompt to paste into Perplexity Deep Research or another active research UI. It is intentionally retrieval-focused. Use the returned source packet as the attachment/input for the normal enrichment or council flow.

## Copy/Paste Prompt

```text
ASSET_CLASS: media_publishing
EXCHANGE: [EXCHANGE_CODE]
TICKER: [EXCHANGE_CODE]:[TICKER]
COMPANY: [COMPANY_NAME]
TEMPLATE: media_publishing
COMPANY_TYPES: media_publishing

Research [COMPANY_NAME] ([EXCHANGE_CODE]:[TICKER]) for a downstream media & publishing enrichment pipeline.

You are performing source retrieval for a downstream enrichment pipeline.

Your job is to find and organise source material. Do not perform investment analysis.
Do not provide buy/sell/hold recommendations. Do not calculate valuation.
Do not provide price targets, NAV, NPV, rNPV, DCF, fair value, or scenario probabilities.
Do not infer facts not present in named sources.

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
- Run a dedicated sector lane (media/publishing): capture 2-4 recent sources on ad markets, subscriber trends, streaming/linear shifts, print decline, content costs, and platform/regulatory changes; tie each point to scenario assumptions.
- If source documents are not attached, actively retrieve and review primary sources before analysis.
- Source market data from official exchange sources, regulator filings, and reliable market-data providers for the listing venue.
- Source company, project, operating, financial, and industry data from primary regulator filings, official exchange announcements, and company investor materials.
- Prioritise exchange filings, annual/interim reports, quarterly updates, investor presentations, official company materials, regulator filings, and named primary-source documents.
- Use secondary sources only where they add factual context not available in primary filings; label secondary-source facts clearly.
- For every key numeric input used in valuation, Quality, Value, or price targets, provide: 1) value used 2) source URL + document date 3) ESTIMATE tag with one-line justification if inferred.
- Use current listing currency market and sector inputs and relevant base-currency FX conversion where project economics are reported in a different currency where relevant; state source and timestamp.

Target source material that can answer these downstream enrichment questions:
- Evidence for Quality factors: Audience/Brand Quality; Revenue Mix Durability; Cost Discipline; Digital Transition; Balance Sheet; Governance
- Evidence for Value factors: Normalized Earnings vs Market Cap; EV/EBITDA vs Peers; FCF Yield; Subscriber/Audience Value; Strategic Value
- Named operating assets, products, services, customers, contracts, licences, counterparties, approvals, management claims, and financial drivers
- Recent filings or announcements that materially update revenue, margins, cash flow, funding, leverage, capex, project timing, regulation, litigation, or competitive position
- Primary-source facts that either confirm or challenge the company's stated thesis

Output exactly this JSON-compatible structure. The factual_summary arrays may contain detailed bullet strings, but keep them source-grounded.

{
  "company": "[COMPANY_NAME]",
  "ticker": "[EXCHANGE_CODE]:[TICKER]",
  "exchange": "[EXCHANGE_CODE]",
  "asset_class": "media_publishing",
  "retrieval_date": "YYYY-MM-DD",
  "source_count": integer,
  "sources": [
    {
      "title": "string",
      "source_type": "primary_filing | regulator_record | technical_report | company_material | counterparty_document | government_record | registry_record | broker_factual_note | industry_dataset | other",
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
