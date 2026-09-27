export type ResearchIdentity = { name: string; ticker: string; exchange: string };

// Retrieval and valuation have different contracts, even when they share a sector rubric.
export function sourceOnlyInstructions(prompt: string, templateId?: string): string {
    let result = prompt
        .replace(/^- For every key numeric input used in valuation, Quality, Value, or price targets, provide:.*$/gm,
            '- For every factual numeric input, give the reported value, source URL and document date. Do not estimate missing values; list them under known_gaps.')
        .replace(/tie each point to scenario assumptions/g, 'identify the factual industry drivers relevant to this company')
        .replace(/actively retrieve and review primary sources before analysis/g, 'actively retrieve and review primary sources before compiling the source packet')
        .replace(/Replace every bracketed placeholder before running this prompt\. If any required placeholder is still unresolved, stop and ask for the missing value\./g,
            'Use the security identity above. If its identity cannot be verified, report the gap instead of substituting a different company.')
        .replace(/\[(?!COMPANY_NAME\]|EXCHANGE_CODE\]|TICKER\])[A-Z_]+\]/g, 'not supplied; establish from named sources or report a gap')
        .replace(/^([A-Z_]+): \[([^\]\n]+)\]$/gm, (line, field) =>
            ['COMPANY', 'EXCHANGE', 'TICKER'].includes(field) ? line : `${field}: establish from named sources or report a gap`);
    if (templateId) {
        result = result.replace(/^ASSET_CLASS:.*$/m, `ASSET_CLASS: ${templateId}`)
            .replace(/"asset_class":\s*"[^"]*"/, `"asset_class": "${templateId}"`);
        if (!/^TEMPLATE:/m.test(result)) result = `TEMPLATE: ${templateId}\n${result}`;
    }
    return result;
}

export function fillResearchPrompt(prompt: string, identity?: ResearchIdentity): string {
    if (!identity) return prompt;
    const ticker = identity.ticker.split(':').pop() || '';
    return prompt.replace(/\[COMPANY_NAME\]|\[EXCHANGE_CODE\]|\[TICKER\]/g, token => ({
        '[COMPANY_NAME]': identity.name,
        '[EXCHANGE_CODE]': identity.exchange,
        '[TICKER]': ticker,
    })[token]!);
}

export function fillWebUIResearchPrompt(prompt: string, identity?: ResearchIdentity): string {
    if (!identity) return prompt;
    let result = fillResearchPrompt(prompt, identity);
    const ticker = identity.ticker.split(':').pop() || '';
    // Some exported rubrics omit the ticker even though it identifies the listing.
    if (ticker && identity.exchange && !/^- Ticker:/m.test(result)) {
        const line = `- Ticker: ${identity.exchange}:${ticker}.`;
        result = /^- Company name:.*$/m.test(result)
            ? result.replace(/^- Company name:.*$/m, match => `${match}\n${line}`)
            : `${line}\n${result}`;
    }
    if (identity.exchange) {
        result = result.replace('Exchange profile: listing venue not preselected.',
            () => `Exchange profile: ${identity.exchange}.`);
    }
    return result;
}
