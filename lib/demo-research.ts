// Illustrative research only. No provider generated these assessments or targets.
// Keep the simulation label in the saved evidence, not in every table cell.
type Scenario = { thesis: string; catalyst: string; risk: string; drift: number };
const scenarios: Record<string, Scenario> = {
    BHP: { thesis: 'Copper growth diversifies earnings beyond iron ore; capital discipline is the central assumption.', catalyst: 'Copper volume growth and project spending review', risk: 'Weaker iron ore prices offset copper gains.', drift: 2.4 },
    CBA: { thesis: 'A strong deposit franchise supports earnings, but the entry valuation leaves little room for disappointment.', catalyst: 'Net interest margin and arrears update', risk: 'Funding competition compresses margins.', drift: -1.2 },
    NEM: { thesis: 'Portfolio simplification could convert higher gold prices into stronger cash generation.', catalyst: 'Quarterly production and cost guidance', risk: 'Cost inflation absorbs the higher gold margin.', drift: 0.6 },
    WBC: { thesis: 'Operating simplification offers an efficiency path if credit losses remain contained.', catalyst: 'Cost-to-income and lending growth update', risk: 'Restructuring expense delays the efficiency benefit.', drift: 0.9 },
    NAB: { thesis: 'Business banking can support resilient returns through a moderate credit cycle.', catalyst: 'Business lending and impairment results', risk: 'SME credit losses rise faster than revenue.', drift: 0.3 },
    ANZ: { thesis: 'Integration benefits may improve scale, but execution must precede a durable rerating.', catalyst: 'Integration milestones and expense outlook', risk: 'Integration complexity erodes expected savings.', drift: -0.8 },
    MQG: { thesis: 'Infrastructure investment and asset realisations could support a recovery in earnings.', catalyst: 'Asset realisations and funds-under-management update', risk: 'Weak transaction activity delays earnings recovery.', drift: 1.6 },
    CSL: { thesis: 'Plasma collection efficiency offers a recovery path, subject to sustained margin improvement.', catalyst: 'Collection costs and gross margin update', risk: 'Higher costs and a slower product mix recovery persist.', drift: -2.8 },
    WES: { thesis: 'A diversified retail portfolio and disciplined reinvestment support through-cycle cash generation.', catalyst: 'Retail sales and operating margin update', risk: 'Household spending weakens and input costs rise.', drift: 0.7 },
    WDS: { thesis: 'Existing production underpins cash flow, while growth projects require strict capital control.', catalyst: 'Project capex and commissioning milestones', risk: 'Lower energy prices coincide with peak project spending.', drift: -2.1 },
    RIO: { thesis: 'Diversification into growth commodities can improve the earnings mix over time.', catalyst: 'Copper ramp-up and growth capex review', risk: 'Execution delays and iron ore weakness reduce free cash flow.', drift: 1.4 },
    GMG: { thesis: 'Logistics and data infrastructure development may sustain growth if capital remains available.', catalyst: 'Development commitments and leasing update', risk: 'Higher financing costs reduce development returns.', drift: 2.0 },
    FMG: { thesis: 'Low-cost iron ore production offers operating leverage, but commodity weakness limits conviction.', catalyst: 'Realised prices, shipments and cash costs', risk: 'A sustained iron ore downturn overwhelms cost advantages.', drift: -3.5 },
    WOW: { thesis: 'Operational improvement could restore margins without relying on strong sales growth.', catalyst: 'Food sales and productivity progress', risk: 'Price competition and operating costs delay recovery.', drift: -1.5 },
    TCL: { thesis: 'Established toll roads provide recurring cash generation supported by traffic and pricing.', catalyst: 'Traffic volumes and distribution coverage', risk: 'Refinancing costs absorb cash flow growth.', drift: 0 },
    ALL: { thesis: 'Recurring gaming content revenue supports reinvestment and a broader digital mix.', catalyst: 'Content performance and recurring revenue update', risk: 'Content execution or regulation constrains growth.', drift: 2.7 },
    QBE: { thesis: 'Underwriting discipline may sustain insurance returns as claims inflation moderates.', catalyst: 'Combined ratio and renewal pricing', risk: 'Catastrophe losses and reserve strengthening reverse gains.', drift: 1.8 },
    COL: { thesis: 'Supply-chain efficiency could improve cash conversion in a competitive grocery market.', catalyst: 'Distribution-centre productivity and margins', risk: 'Price investment consumes the efficiency gains.', drift: 1.1 },
    NST: { thesis: 'Production growth can compound gold-price strength if expansion costs remain controlled.', catalyst: 'Expansion milestones and unit cost guidance', risk: 'Ramp-up delays reduce expected operating leverage.', drift: 3.2 },
    STO: { thesis: 'New production could improve free cash flow after the investment phase.', catalyst: 'Commissioning progress and capital expenditure', risk: 'Start-up delays coincide with weaker realised prices.', drift: -0.9 },
    EVN: { thesis: 'A steadier production base may translate favourable gold prices into stronger margins.', catalyst: 'Production consistency and debt reduction', risk: 'Operational interruptions disrupt cash generation.', drift: 2.2 },
    S32: { thesis: 'A diversified metals portfolio offers recovery potential with improving commodity demand.', catalyst: 'Operating costs and copper project progress', risk: 'Commodity weakness and project overruns delay recovery.', drift: 1.7 },
    RRL: { thesis: 'Gold-price strength may improve free cash generation if production remains stable.', catalyst: 'Production guidance and sustaining capital', risk: 'Lower grades offset stronger realised gold prices.', drift: 2.5 },
    SFR: { thesis: 'Copper exposure offers operating leverage as mine performance stabilises.', catalyst: 'Copper recoveries and unit cost update', risk: 'Ramp-up setbacks outweigh stronger copper prices.', drift: 2.9 },
    SVL: { thesis: 'Silver project optionality depends on a credible path through approvals and funding.', catalyst: 'Permitting milestones and funding plan', risk: 'Approval delays or dilution reduce project value.', drift: -0.6 },
    BOE: { thesis: 'Uranium production growth could benefit from stronger contracting demand.', catalyst: 'Production ramp-up and contracting update', risk: 'Ramp-up costs rise before contracted sales mature.', drift: 1.9 },
};

export const demoRouterScores = Object.fromEntries(
    Object.entries(scenarios).map(([ticker, scenario]) => [`ASX:${ticker}`, scenario.drift]),
);

export function demoResearch(ticker: string, name: string, price: number, index: number, date: string) {
    const scenario = scenarios[ticker.split(':').pop()!];
    if (!scenario) return {};
    const quality = 68 + index % 6 * 3;
    const value = 72 - index % 5 * 3;
    const target = Math.round(price * (1.24 + index % 4 * 0.06) * 100) / 100;
    return {
        council_quality: quality, council_value: value, council_pt: target,
        council_source_input_at: date,
        thesis: scenario.thesis, catalysts: scenario.catalyst,
        council_source_output: [
            `# ${name} (${ticker})`,
            'Synthetic demo research. These assumptions, scores and targets are invented, not actual Council output or investment advice.',
            `## Investment thesis\n${scenario.thesis}`,
            `## Next catalyst\n${scenario.catalyst}`,
            `## What would invalidate it\n${scenario.risk}`,
            `## Illustrative assessment\nQuality: ${quality}/100\nValue: ${value}/100\n24-month target: A$${target.toFixed(2)}`,
            `## Thesis delta\n${scenario.drift > 0 ? '+' : ''}${scenario.drift.toFixed(1)}. Simulated evidence reassessment; no real announcement is claimed.\n\nAs of ${date.slice(0, 10)}.`,
        ].join('\n\n'),
    };
}
