import { expect, test, type Page } from '@playwright/test';

type NewsRunFixture = {
    id: number;
    run_date: string;
    mode: string;
    status: string;
    model: string;
    source_type: string;
    source_id: string;
    daily_summary: string;
    market_context: {
        top_themes_12m: string[];
        top_performers_12m: string[];
        worst_performers_12m: string[];
        news_themes_1m: string[];
        top_performers_1m: string[];
        worst_performers_1m: string[];
    };
    created_at: string;
    updated_at: string;
};

type NewsBriefFixture = {
    run: NewsRunFixture;
    foundation_run: NewsRunFixture;
    foundation_cohort?: {
        id: number;
        status: string;
        source_type: string;
        source_id: string;
        source_memo_job_id: string;
        run_id: number;
        model: string;
        quality_score: number;
        thesis_count: number;
        candidate_count: number;
        created_at: string;
        activated_at: string;
        updated_at: string;
    };
    foundation_job?: {
        id: string;
        status: string;
        stage: string;
        stage_message: string;
        progress_pct: number;
        mode: string;
        source_type: string;
        source_id: string;
        source_memo_job_id: string;
        foundation_cohort_id?: number;
        run_id?: number;
        model: string;
        quality_score: number;
        thesis_count: number;
        candidate_count: number;
        error_message?: string;
        created_at: string;
        updated_at: string;
    };
    items: Array<{
        id: number;
        run_id: number;
        headline: string;
        summary: string;
        timeframe: string;
        impact_score: number;
        sources: string[];
        asset_classes: string[];
        tags: string[];
        created_at: string;
    }>;
    theses: Array<{
        id: number;
        title: string;
        timeframe: string;
        status: string;
        conviction: number;
        summary: string;
        asset_classes: string[];
        tags: string[];
        created_at: string;
        updated_at: string;
        last_updated_at: string;
    }>;
    updates: Array<{
        id: number;
        thesis_id: number;
        run_id: number;
        relationship: string;
        evidence: string;
        conviction_delta: number;
        sources: string[];
        created_at: string;
    }>;
};

const marketContext = {
    top_themes_12m: ['Inflationary late-cycle expansion', 'Gold and energy leadership'],
    top_performers_12m: ['ENERGY_PRODUCERS', 'GOLD_MINERS'],
    worst_performers_12m: ['REAL_ESTATE_REIT'],
    news_themes_1m: ['Oil supply risk', 'US rates repricing'],
    top_performers_1m: ['BROAD_EQUITY'],
    worst_performers_1m: ['PHYSICAL_GOLD'],
};

const baseRun: NewsRunFixture = {
    id: 41,
    run_date: '2026-06-09T00:00:00Z',
    mode: 'DAILY',
    status: 'COMPLETED',
    model: 'grok-test',
    source_type: '',
    source_id: '',
    daily_summary:
        'Fresh daily summary: oil supply risks and AI earnings evidence update the active macro ledger.',
    market_context: marketContext,
    created_at: '2026-06-09T02:00:00Z',
    updated_at: '2026-06-09T02:00:00Z',
};

const foundationRun: NewsRunFixture = {
    ...baseRun,
    id: 40,
    mode: 'BOOTSTRAP',
    source_type: 'PORTFOLIO_MEMO',
    source_id: 'memo_quality_20260609',
    daily_summary:
        'Foundation seeded from portfolio memo: Q2 overheating, Q3 oil shock tail, energy leadership, gold ballast, and selective AI equities.',
    created_at: '2026-06-08T01:00:00Z',
    updated_at: '2026-06-08T01:00:00Z',
};

const briefFixture = (summary = baseRun.daily_summary): NewsBriefFixture => ({
    run: { ...baseRun, daily_summary: summary },
    foundation_run: foundationRun,
    foundation_cohort: {
        id: 9,
        status: 'ACTIVE',
        source_type: 'PORTFOLIO_MEMO',
        source_id: 'memo_quality_20260609',
        source_memo_job_id: 'memo_quality_20260609',
        run_id: 40,
        model: 'grok-test',
        quality_score: 0.86,
        thesis_count: 2,
        candidate_count: 2,
        created_at: '2026-06-08T01:00:00Z',
        activated_at: '2026-06-08T01:00:00Z',
        updated_at: '2026-06-08T01:00:00Z',
    },
    items: [
        {
            id: 501,
            run_id: 41,
            headline: 'Oil supply risk lifts energy leadership',
            summary: 'WTI strength supports energy producers while challenging rate-sensitive property.',
            timeframe: '1D',
            impact_score: 0.83,
            sources: ['mock://oil'],
            asset_classes: ['ENERGY_PRODUCERS', 'REAL_ESTATE_REIT'],
            tags: ['energy'],
            created_at: '2026-06-09T02:01:00Z',
        },
    ],
    theses: [
        {
            id: 101,
            title: 'Energy leadership persists',
            timeframe: '1Y',
            status: 'ACTIVE',
            conviction: 0.81,
            summary: 'Energy producers retain macro support from tight supply and sticky inflation.',
            asset_classes: ['ENERGY_PRODUCERS', 'GOLD_MINERS'],
            tags: ['inflation'],
            created_at: '2026-06-08T01:00:00Z',
            updated_at: '2026-06-09T02:01:00Z',
            last_updated_at: '2026-06-09T02:01:00Z',
        },
        {
            id: 102,
            title: 'Property remains under pressure',
            timeframe: '1M',
            status: 'ACTIVE',
            conviction: 0.55,
            summary: 'Higher long-end yields keep listed property under pressure.',
            asset_classes: ['REAL_ESTATE_REIT'],
            tags: ['rates'],
            created_at: '2026-06-08T01:00:00Z',
            updated_at: '2026-06-09T02:02:00Z',
            last_updated_at: '2026-06-09T02:02:00Z',
        },
    ],
    updates: [
        {
            id: 901,
            thesis_id: 101,
            run_id: 41,
            relationship: 'CONFIRMS',
            evidence: 'Oil price strength confirms the energy leadership thesis.',
            conviction_delta: 0.06,
            sources: ['mock://energy'],
            created_at: '2026-06-09T02:01:00Z',
        },
        {
            id: 902,
            thesis_id: 102,
            run_id: 41,
            relationship: 'CHALLENGES',
            evidence: 'US REITs continue to lag as yields stay elevated.',
            conviction_delta: -0.08,
            sources: ['mock://property'],
            created_at: '2026-06-09T02:02:00Z',
        },
    ],
});

const latestMemo = {
    memo: {
        id: 7,
        memo_job_id: 'memo_quality_20260609',
        run_id: 'quality_job_20260609',
        mode: 'council',
        status: 'completed',
        model: 'grok-test',
        analysis_date: '2026-06-09',
        primary_theme: 'Inflationary late-cycle expansion',
        secondary_theme: 'Q3 oil shock tail',
        overall_conviction: 'high',
        executive_summary: 'Energy and gold leadership with selective AI-linked equity exposure.',
        analyst_memo_markdown: 'Memo body',
        chairman_memo_markdown: 'Chair memo',
        asset_class_targets: [],
        created_at: '2026-06-09T01:00:00Z',
        updated_at: '2026-06-09T01:00:00Z',
    },
};

async function mockNewsAPIs(page: Page) {
    let currentBrief = briefFixture();
    const foundationJobBodies: unknown[] = [];

    await page.route('**/api/news/brief', async (route) => {
        await route.fulfill({ json: currentBrief });
    });
    await page.route('**/api/news/foundation-jobs', async (route) => {
        foundationJobBodies.push(JSON.parse(route.request().postData() || '{}'));
        await route.fulfill({
            status: 202,
            json: {
                id: 'news_foundation_test',
                status: 'RUNNING',
                stage: 'extracting_candidates',
                stage_message: 'Extracting thesis candidates from the portfolio memo',
                progress_pct: 25,
                mode: 'BOOTSTRAP',
                source_type: 'PORTFOLIO_MEMO',
                source_id: 'memo_quality_20260609',
                source_memo_job_id: 'memo_quality_20260609',
                model: 'grok-test',
                quality_score: 0,
                thesis_count: 0,
                candidate_count: 0,
                created_at: '2026-06-09T02:02:00Z',
                updated_at: '2026-06-09T02:02:00Z',
            },
        });
    });
    await page.route('**/api/news/foundation-jobs/news_foundation_test', async (route) => {
        currentBrief = briefFixture('Fresh run result: memo-seeded foundation refreshed the ledger.');
        await route.fulfill({
            json: {
                id: 'news_foundation_test',
                status: 'SUCCEEDED',
                stage: 'promoted',
                stage_message: 'Foundation ledger promoted',
                progress_pct: 100,
                mode: 'BOOTSTRAP',
                source_type: 'PORTFOLIO_MEMO',
                source_id: 'memo_quality_20260609',
                source_memo_job_id: 'memo_quality_20260609',
                foundation_cohort_id: 10,
                run_id: 42,
                model: 'grok-test',
                quality_score: 0.88,
                thesis_count: 12,
                candidate_count: 14,
                created_at: '2026-06-09T02:02:00Z',
                updated_at: '2026-06-09T02:02:03Z',
            },
        });
    });
    await page.route('**/api/news/run', async (route) => {
        currentBrief = briefFixture('Fresh run result: memo-seeded foundation refreshed the ledger.');
        await route.fulfill({ json: currentBrief });
    });
    await page.route('**/api/portfolio-memos/latest', async (route) => {
        await route.fulfill({ json: latestMemo });
    });
    await page.route('**/api/asset-classes', async (route) => {
        await route.fulfill({
            json: [
                {
                    code: 'ENERGY_PRODUCERS',
                    asset_class_code: 'ENERGY_PRODUCERS',
                    display_name: 'Energy Producers',
                    active: true,
                    allow_grouping: true,
                    class_type: 'ALLOCATION',
                    analysis_eligible: true,
                    instrument_scope: 'BOTH',
                    risk_bucket: 'Q1',
                    quartile: 'Q1',
                    display_order: 10,
                },
                {
                    code: 'GOLD_MINERS',
                    asset_class_code: 'GOLD_MINERS',
                    display_name: 'Gold Miners',
                    active: true,
                    allow_grouping: true,
                    class_type: 'ALLOCATION',
                    analysis_eligible: true,
                    instrument_scope: 'BOTH',
                    risk_bucket: 'Q1',
                    quartile: 'Q1',
                    display_order: 20,
                },
                {
                    code: 'REAL_ESTATE_REIT',
                    asset_class_code: 'REAL_ESTATE_REIT',
                    display_name: 'Listed Property',
                    active: true,
                    allow_grouping: true,
                    class_type: 'ALLOCATION',
                    analysis_eligible: true,
                    instrument_scope: 'BOTH',
                    risk_bucket: 'Q1_EXEMPT',
                    quartile: 'Q1_EXEMPT',
                    display_order: 30,
                },
                {
                    code: 'PHYSICAL_GOLD',
                    asset_class_code: 'PHYSICAL_GOLD',
                    display_name: 'Physical Gold',
                    active: true,
                    allow_grouping: true,
                    class_type: 'ALLOCATION',
                    analysis_eligible: false,
                    instrument_scope: 'FUND',
                    risk_bucket: 'Q1_EXEMPT',
                    quartile: 'Q1_EXEMPT',
                    display_order: 40,
                },
                {
                    code: 'BROAD_EQUITY',
                    asset_class_code: 'BROAD_EQUITY',
                    display_name: 'Broad Equity',
                    active: true,
                    allow_grouping: true,
                    class_type: 'ALLOCATION',
                    analysis_eligible: true,
                    instrument_scope: 'BOTH',
                    risk_bucket: 'Q1',
                    quartile: 'Q1',
                    display_order: 50,
                },
            ],
        });
    });

    return { foundationJobBodies };
}

async function openNewsTab(page: Page) {
    await page.goto('/');
    await page.getByRole('button', { name: /^NEWS$/ }).click();
    await expect(page.getByText('Macro Narrative')).toBeVisible();
}

test.describe('News narrative UI', () => {
    test('renders memo-seeded narratives with readable taxonomy and selected evidence', async ({
        page,
    }) => {
        await mockNewsAPIs(page);
        await openNewsTab(page);

        await expect(page.getByText('Memo source')).toBeVisible();
        await expect(page.getByText('Daily brief')).toBeVisible();
        await expect(page.getByText('Narrative changes')).toBeVisible();
        await expect(page.getByText('Narrative ledger')).toBeVisible();

        await expect(page.getByText('Energy Producers').first()).toBeVisible();
        await expect(page.getByText('Listed Property').first()).toBeVisible();
        await expect(page.getByText('REAL_ESTATE_REIT')).toHaveCount(0);

        await page.getByRole('button', { name: /Property remains under pressure/ }).click();
        const selectedEvidence = page
            .locator('section')
            .filter({ hasText: 'Selected evidence' });
        await expect(selectedEvidence).toBeVisible();
        await expect(
            selectedEvidence.getByText(
                'US REITs continue to lag as yields stay elevated.',
            ),
        ).toBeVisible();

        await page.getByRole('button', { name: /^1Y$/ }).click();
        const ledger = page.locator('aside').filter({ hasText: 'Narrative ledger' });
        await expect(ledger.getByText('Energy leadership persists')).toBeVisible();
        await expect(ledger.getByText('Property remains under pressure')).toHaveCount(0);
    });

    test('sends the saved portfolio memo id when running the foundation pass', async ({
        page,
    }) => {
        const { foundationJobBodies } = await mockNewsAPIs(page);
        await openNewsTab(page);

        await expect(page.getByText('Memo source')).toBeVisible();
        await page.getByRole('button', { name: 'Run Foundation' }).click();

        await expect(page.getByText('Fresh run result: memo-seeded foundation refreshed the ledger.')).toBeVisible();
        expect(foundationJobBodies).toContainEqual({
            source_memo_job_id: 'memo_quality_20260609',
        });
    });
});
