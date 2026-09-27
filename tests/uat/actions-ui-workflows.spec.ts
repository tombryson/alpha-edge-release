import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import {
    baselinePortfolio,
    buildDayAfterPortfolio,
    buildPortfolioFromTargetWeights,
    buildStatementImportPayload,
} from './fixtures/portfolio-states';
import { resetLocalUatDatabaseIfConfigured } from './helpers/local-db';
import {
    acceptOverlayBaseline,
    applyStage1Plan,
    getOverlaySummary,
    getOverlayReconciliation,
    importStatement,
    postQ1Signal,
    postQ4Signal,
    postJson,
    buildStage1PlanFromSummary,
    completeStage2,
    saveStage2Targets,
} from './helpers/overlay-api';
import { assertUatSafety } from './helpers/action-workflows';
import {
    buildManualPortfolioTargetRows,
    createPortfolioRebalance,
    getCurrentPortfolioAdjustmentPlan,
    getCurrentPortfolioMix,
    targetWeightsFromAdjustmentPlan,
} from './helpers/action-workflows';

const nowPlus = (minutes: number): Date =>
    new Date(Date.now() + minutes * 60 * 1000);

const stage2Targets = [
    { asset_class: 'ENERGY', target_pct: 20 },
    { asset_class: 'INSURANCE', target_pct: 10 },
    { asset_class: 'STAPLES', target_pct: 8 },
    { asset_class: 'HEALTHCARE', target_pct: 6 },
];

const resetAndImportBaseline = async ({
    request,
}: {
    request: APIRequestContext;
}) => {
    assertUatSafety();
    resetLocalUatDatabaseIfConfigured();
    await importStatement(
        request,
        buildStatementImportPayload(baselinePortfolio, nowPlus(-30)),
    );
    await postJson(request, '/sync/changes/acknowledge', { change_ids: [] });
};

const dismissSyncModalIfPresent = async (page: Page) => {
    const acknowledgeButton = page
        .getByRole('button', {
            name: /Acknowledge (Reserve Import|Changes)/,
        })
        .first();
    const visible = await acknowledgeButton
        .waitFor({ state: 'visible', timeout: 6500 })
        .then(() => true)
        .catch(() => false);
    if (!visible) return;
    await acknowledgeButton.click();
    await acknowledgeButton
        .waitFor({ state: 'hidden', timeout: 5000 })
        .catch(() => undefined);
};

const openPositionsActions = async (page: Page) => {
    await page.goto('/');
    await page.addStyleTag({
        content: 'nextjs-portal { pointer-events: none !important; }',
    });
    await dismissSyncModalIfPresent(page);
    await page.getByTestId('main-tab-positions').click();
    await expect(page.getByTestId('positions-actions-tab')).toBeEnabled({
        timeout: 20_000,
    });
    await page.getByTestId('positions-actions-tab').click();
    await expect(page.getByRole('navigation', { name: 'Choose portfolio action' })).toBeVisible();
};

const openPortfolioWorkflow = async (page: Page) => {
    await openPositionsActions(page);
    await expect(page.getByText('Portfolio Rebalancing').first()).toBeVisible({
        timeout: 20_000,
    });
};

const createPortfolioRebalanceAndOpen = async ({
    request,
    page,
}: {
    request: APIRequestContext;
    page: Page;
}) => {
    const mix = await getCurrentPortfolioMix(request);
    const targetRows = buildManualPortfolioTargetRows(mix);
    await createPortfolioRebalance(request, targetRows);
    await openPortfolioWorkflow(page);
    await expect(page.getByText('Portfolio Rebalancing').first()).toBeVisible();
};

const commitVisibleSuggestedAdjustments = async (page: Page) => {
    const inputs = adjustmentInputs(page);
    await expect(inputs.first()).toBeVisible({ timeout: 20_000 });

    const count = await inputs.count();
    expect(count, 'expected editable adjustment inputs').toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
        const input = inputs.nth(index);
        await input.scrollIntoViewIfNeeded();
        await input.focus();
        await input.press('Enter');
    }
};

const adjustmentInputs = (page: Page) =>
    page.locator('input[data-position-adjustment-input="true"]:not(:disabled)');

const enterFirstSuggestedAdjustment = async (page: Page): Promise<string> => {
    const input = adjustmentInputs(page).first();
    await expect(input).toBeVisible({ timeout: 20_000 });
    await input.focus();
    await input.press('Enter');
    const value = await input.inputValue();
    expect(Number(value), 'first suggested adjustment should commit').toBeGreaterThan(
        0,
    );
    return value;
};

const completeStage1ThroughUi = async ({
    page,
    request,
}: {
    page: Page;
    request: APIRequestContext;
}) => {
    const reviewTotals = page.getByTestId('risk-review-totals');
    await expect(reviewTotals).toBeDisabled();

    await commitVisibleSuggestedAdjustments(page);

    await expect(page.getByTestId('risk-dock-recorded')).not.toHaveText('$0');
    await expect
        .poll(async () => reviewTotals.isEnabled(), { timeout: 20_000 })
        .toBe(true);

    await reviewTotals.click();
    const confirmReserveMove = page.getByTestId('risk-confirm-reserve-move');
    await expect(confirmReserveMove).toBeVisible();
    await confirmReserveMove.click();

    await expect
        .poll(
            async () => (await getOverlaySummary(request)).active_event_status,
            { timeout: 20_000 },
        )
        .toBe('STAGE1_DONE');
};

const confirmPortfolioRebalanceThroughUi = async ({
    page,
    request,
}: {
    page: Page;
    request: APIRequestContext;
}) => {
    await commitVisibleSuggestedAdjustments(page);
    await expect(page.getByTestId('portfolio-dock-recorded')).not.toHaveText('$0');
    await expect
        .poll(
            async () =>
                page.getByTestId('portfolio-confirm-position-actions').isEnabled(),
            { timeout: 20_000 },
        )
        .toBe(true);
    await page.getByTestId('portfolio-confirm-position-actions').click();
    await expect
        .poll(async () => (await getCurrentPortfolioAdjustmentPlan(request)).stage, {
            timeout: 20_000,
        })
        .toBe('confirm_statement');
};

const importCorrectStatementForPlan = async (
    request: APIRequestContext,
    plan: ReturnType<typeof buildStage1PlanFromSummary>,
) => {
    const dayAfter = buildDayAfterPortfolio({
        cashAud: plan.expectedReserve,
        mode: 'success',
        sources: plan.sources,
    });
    await importStatement(
        request,
        buildStatementImportPayload(dayAfter, nowPlus(5)),
    );
};

const importIncorrectStatementForPlan = async (
    request: APIRequestContext,
    plan: ReturnType<typeof buildStage1PlanFromSummary>,
) => {
    const dayAfter = buildDayAfterPortfolio({
        cashAud: plan.baselineReserve,
        mode: 'no-reduction',
        sources: plan.sources,
    });
    await importStatement(
        request,
        buildStatementImportPayload(dayAfter, nowPlus(5)),
    );
};

const importWrongHoldingsStatementForPlan = async (
    request: APIRequestContext,
    plan: ReturnType<typeof buildStage1PlanFromSummary>,
) => {
    const dayAfter = buildDayAfterPortfolio({
        cashAud: plan.expectedReserve,
        mode: 'wrong-holdings',
        sources: plan.sources,
    });
    await importStatement(
        request,
        buildStatementImportPayload(dayAfter, nowPlus(5)),
    );
};

const finaliseRiskWorkflowThroughApi = async (
    request: APIRequestContext,
    plan: ReturnType<typeof buildStage1PlanFromSummary>,
) => {
    await applyStage1Plan(request, plan);
    await importCorrectStatementForPlan(request, plan);
    await expect
        .poll(async () => (await getOverlaySummary(request)).cash_confirmation_status, {
            timeout: 20_000,
        })
        .toBe('CONFIRMED');
    await saveStage2Targets(request, stage2Targets);
    await completeStage2(request);
    await acceptOverlayBaseline(request);
};

const expectConfirmedStatementUi = async ({
    page,
    request,
}: {
    page: Page;
    request: APIRequestContext;
}) => {
    await page.goto('/');
    await page.addStyleTag({
        content: 'nextjs-portal { pointer-events: none !important; }',
    });
    await expect(page.getByText('Reserve import review')).toBeVisible({
        timeout: 10_000,
    });
    await expect(
        page.getByRole('heading', {
            name: 'Broker import checked against the locked reserve move',
        }),
    ).toBeVisible();
    await expect(page.getByText('Confirmed').first()).toBeVisible();
    await expect
        .poll(async () => (await getOverlaySummary(request)).cash_confirmation_status, {
            timeout: 20_000,
        })
        .toBe('CONFIRMED');
    await page.getByRole('button', { name: 'Acknowledge Reserve Import' }).click();
    await expect(page.getByTestId('positions-actions-tab')).toBeDisabled({
        timeout: 20_000,
    });
};

const expectVarianceStatementUi = async ({
    page,
    request,
}: {
    page: Page;
    request: APIRequestContext;
}) => {
    await openPositionsActions(page);
    await expect
        .poll(async () => (await getOverlaySummary(request)).cash_confirmation_status, {
            timeout: 20_000,
        })
        .toBe('VARIANCE');
    await expect(page.getByTestId('risk-workflow-stage-confirm_cash')).toHaveAttribute(
        'data-active',
        'true',
    );
    await expect(page.getByRole('heading', { name: 'Review statement differences' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review and reopen' })).toBeVisible();
};

test.describe('UAT action workflows UI', () => {
    test.skip(
        process.env.UAT_ACTION_WORKFLOW_UI_TEST !== '1',
        'destructive browser workflow tests require UAT_ACTION_WORKFLOW_UI_TEST=1',
    );

    test.setTimeout(120_000);
    test.beforeEach(resetAndImportBaseline);

    test('Q3 reduction confirms the correct statement through Positions Actions UI', async ({
        request,
        page,
    }) => {
        await postQ1Signal(request, 'SPY', 30);

        const summary = await getOverlaySummary(request);
        expect(summary.portfolio_risk?.mode).toBe('Q3_THROTTLE');
        expect(Number(summary.required_de_risk_value || 0)).toBeGreaterThan(0);
        const plan = buildStage1PlanFromSummary(summary);

        await openPositionsActions(page);
        await expect(page.getByText('Portfolio Risk').first()).toBeVisible();
        await completeStage1ThroughUi({ page, request });
        await importCorrectStatementForPlan(request, plan);
        await expectConfirmedStatementUi({ page, request });
    });

    test('Q4 crisis reduction confirms the correct statement through Positions Actions UI', async ({
        request,
        page,
    }) => {
        await postQ4Signal(request, 'SELL');

        const summary = await getOverlaySummary(request);
        expect(summary.portfolio_risk?.mode).toBe('Q4_CRISIS');
        expect(summary.portfolio_risk?.target_pct).toBe(10);
        expect(Number(summary.required_de_risk_value || 0)).toBeGreaterThan(0);
        const plan = buildStage1PlanFromSummary(summary);

        await openPositionsActions(page);
        await expect(page.getByText('Q4 Crisis').first()).toBeVisible();
        await completeStage1ThroughUi({ page, request });
        await importCorrectStatementForPlan(request, plan);
        await expectConfirmedStatementUi({ page, request });
    });

    test('Q3 reduction shows statement variance when the broker statement is wrong', async ({
        request,
        page,
    }) => {
        await postQ1Signal(request, 'SPY', 30);

        const summary = await getOverlaySummary(request);
        expect(summary.portfolio_risk?.mode).toBe('Q3_THROTTLE');
        expect(Number(summary.required_de_risk_value || 0)).toBeGreaterThan(0);
        const plan = buildStage1PlanFromSummary(summary);

        await openPositionsActions(page);
        await completeStage1ThroughUi({ page, request });
        await importIncorrectStatementForPlan(request, plan);
        await expectVarianceStatementUi({ page, request });
    });

    test('Q3 risk-on shows allocation available action rather than adjustment cells', async ({
        request,
        page,
    }) => {
        await postQ1Signal(request, 'SPY', 30);
        const reductionSummary = await getOverlaySummary(request);
        const plan = buildStage1PlanFromSummary(reductionSummary);
        await finaliseRiskWorkflowThroughApi(request, plan);

        await postQ1Signal(request, 'SPY', 80);
        const headroomSummary = await getOverlaySummary(request);
        expect(headroomSummary.portfolio_risk?.mode).toBe('Q3_THROTTLE');
        expect(headroomSummary.portfolio_risk?.target_pct).toBe(80);
        expect(Number(headroomSummary.required_de_risk_value || 0)).toBe(0);
        expect(Number(headroomSummary.available_headroom_value || 0)).toBeGreaterThan(
            0,
        );

	        await openPositionsActions(page);
	        await expect(page.getByText('Q3 allocation available')).toBeVisible();
	        await expect(page.getByRole('button', { name: 'Review Portfolio Shape' })).toBeVisible();
	        await expect(page.getByRole('button', { name: 'Mark Reviewed' })).toBeVisible();
	        await expect(adjustmentInputs(page)).toHaveCount(0);
	    });

    test('risk Reopen Actions unlocks adjustment fields after statement variance', async ({
        request,
        page,
    }) => {
        await postQ1Signal(request, 'SPY', 30);
        const summary = await getOverlaySummary(request);
        const plan = buildStage1PlanFromSummary(summary);

        await openPositionsActions(page);
        await completeStage1ThroughUi({ page, request });
        await importIncorrectStatementForPlan(request, plan);
        await expectVarianceStatementUi({ page, request });

        await page.getByRole('button', { name: 'Review and reopen' }).click();
        const dialog = page.getByRole('alertdialog', { name: 'Reopen Actions?' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText('This will lapse the current statement wait and reopen the adjustment fields.')).toBeVisible();
        await expect(dialog.getByText(/next statement/i)).toHaveCount(0);
        await dialog.getByRole('button', { name: 'Reopen Actions' }).click();

        await expect(page.getByTestId('risk-workflow-stage-reduce')).toHaveAttribute(
            'data-active',
            'true',
            { timeout: 20_000 },
        );
        await expect(adjustmentInputs(page).first()).toBeEnabled({
            timeout: 20_000,
        });
        await expect
            .poll(async () => (await getOverlaySummary(request)).active_event_status, {
                timeout: 20_000,
            })
            .not.toBe('STAGE1_DONE');
    });

    test('risk workflow shows variance when cash arrives from the wrong holdings', async ({
        request,
        page,
    }) => {
        await postQ1Signal(request, 'SPY', 30);
        const summary = await getOverlaySummary(request);
        const plan = buildStage1PlanFromSummary(summary);

        await openPositionsActions(page);
        await completeStage1ThroughUi({ page, request });
        await importWrongHoldingsStatementForPlan(request, plan);

        await expect
            .poll(async () => (await getOverlayReconciliation(request)).overall_status, {
                timeout: 20_000,
            })
            .toBe('VARIANCE');
        await openPositionsActions(page);
        await expect(page.getByRole('heading', { name: 'Review statement differences' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Review and reopen' })).toBeVisible();
    });

    test('portfolio rebalancing completes through the Positions action workflow UI', async ({
        request,
        page,
    }) => {
        await createPortfolioRebalanceAndOpen({ request, page });
        await confirmPortfolioRebalanceThroughUi({ page, request });

        const locked = await getCurrentPortfolioAdjustmentPlan(request);
        const targetPortfolio = buildPortfolioFromTargetWeights({
            targetWeights: targetWeightsFromAdjustmentPlan(locked),
        });
        await importStatement(
            request,
            buildStatementImportPayload(targetPortfolio, nowPlus(5)),
        );

        await openPortfolioWorkflow(page);
        await expect(
            page.getByTestId('portfolio-workflow-stage-confirm_cash'),
        ).toContainText('Matched', { timeout: 20_000 });
        await expect(page.getByTestId('portfolio-approve-baseline')).toBeEnabled({
            timeout: 20_000,
        });
        await page.getByTestId('portfolio-approve-baseline').click();
        await expect(page.getByTestId('portfolio-approve-baseline')).toBeHidden({
            timeout: 20_000,
        });
    });

    test('new portfolio target starts from current visible asset classes without Add rows', async ({
        page,
    }) => {
        await page.goto('/');
        await page.addStyleTag({
            content: 'nextjs-portal { pointer-events: none !important; }',
        });
        await dismissSyncModalIfPresent(page);
        await page.getByTestId('main-tab-portfolio').click();

        const newTarget = page.getByRole('button', {
            name: 'New Portfolio Target',
        });
        await expect(newTarget).toBeEnabled({ timeout: 20_000 });
        await newTarget.click();

        await expect(page.getByText('Target Allocation').first()).toBeVisible({
            timeout: 20_000,
        });
        await expect(page.getByTestId('portfolio-target-unmatched-label')).toHaveCount(
            0,
        );
        await expect(page.getByRole('button', { name: 'Lock Target Mix' })).toBeVisible();
    });

    test('portfolio rebalancing draft survives reload and can be cleared', async ({
        request,
        page,
    }) => {
        await createPortfolioRebalanceAndOpen({ request, page });
        const committedValue = await enterFirstSuggestedAdjustment(page);

        await expect(page.getByTestId('portfolio-save-draft')).toBeEnabled();
        await page.getByTestId('portfolio-save-draft').click();

        await openPortfolioWorkflow(page);
        await expect(adjustmentInputs(page).first()).toHaveValue(committedValue);

        await expect(page.getByTestId('portfolio-clear-draft')).toBeEnabled();
        await page.getByTestId('portfolio-clear-draft').click();
        await expect(adjustmentInputs(page).first()).toHaveValue('');
        await expect(page.getByTestId('portfolio-dock-recorded')).toHaveText('$0');
    });

    test('portfolio Confirm Position Actions stays disabled when underfilled', async ({
        request,
        page,
    }) => {
        await createPortfolioRebalanceAndOpen({ request, page });
        const input = adjustmentInputs(page).first();
        await expect(input).toBeVisible({ timeout: 20_000 });
        await input.fill('1');

        await expect(page.getByTestId('portfolio-dock-recorded')).toHaveText('$1');
        await expect(
            page.getByTestId('portfolio-confirm-position-actions'),
        ).toBeDisabled();
    });

    test('portfolio Confirm Position Actions stays disabled when overfilled', async ({
        request,
        page,
    }) => {
        await createPortfolioRebalanceAndOpen({ request, page });
        const inputs = adjustmentInputs(page);
        const count = await inputs.count();
        expect(count, 'expected editable portfolio adjustment inputs').toBeGreaterThan(
            0,
        );

        for (let index = 0; index < count; index += 1) {
            const input = inputs.nth(index);
            const max = Number(await input.getAttribute('max'));
            await input.scrollIntoViewIfNeeded();
            await input.fill(String(Number.isFinite(max) && max > 0 ? max : 999999));
        }

        await expect(page.getByTestId('portfolio-dock-recorded')).not.toHaveText(
            '$0',
        );
        await expect(page.getByTestId('portfolio-dock-progress')).toHaveClass(
            /review-dock-progress-over/,
        );
        await expect(
            page.getByTestId('portfolio-confirm-position-actions'),
        ).toBeDisabled();
    });

    test('risk adjustment draft survives reload and can be cleared', async ({
        request,
        page,
    }) => {
        await postQ1Signal(request, 'SPY', 30);

        await openPositionsActions(page);
        const committedValue = await enterFirstSuggestedAdjustment(page);
        await expect(page.getByTestId('risk-save-draft')).toBeEnabled();
        await page.getByTestId('risk-save-draft').click();

        await openPositionsActions(page);
        await expect(adjustmentInputs(page).first()).toHaveValue(committedValue);

        await expect(page.getByTestId('risk-clear-draft')).toBeEnabled();
        await page.getByTestId('risk-clear-draft').click();
        await expect(adjustmentInputs(page).first()).toHaveValue('');
        await expect(page.getByTestId('risk-dock-recorded')).toHaveText('$0');
    });

    test('risk Review Totals stays disabled when adjustments are underfilled', async ({
        request,
        page,
    }) => {
        await postQ1Signal(request, 'SPY', 30);

        await openPositionsActions(page);
        const input = adjustmentInputs(page).first();
        await expect(input).toBeVisible({ timeout: 20_000 });
        await input.fill('1');

        await expect(page.getByTestId('risk-dock-recorded')).toHaveText('$1');
        await expect(page.getByTestId('risk-review-totals')).toBeDisabled();
    });

    test('risk Review Totals stays disabled when adjustments are overfilled', async ({
        request,
        page,
    }) => {
        await postQ1Signal(request, 'SPY', 30);

        await openPositionsActions(page);
        const inputs = adjustmentInputs(page);
        const count = await inputs.count();
        expect(count, 'expected editable adjustment inputs').toBeGreaterThan(0);

        for (let index = 0; index < count; index += 1) {
            const input = inputs.nth(index);
            const max = Number(await input.getAttribute('max'));
            await input.scrollIntoViewIfNeeded();
            await input.fill(String(Number.isFinite(max) && max > 0 ? max : 999999));
        }

        await expect(
            page.getByText('Draft adjustments exceed target beyond tolerance.'),
        ).toBeVisible();
        await expect(page.getByTestId('risk-review-totals')).toBeDisabled();
    });
});
