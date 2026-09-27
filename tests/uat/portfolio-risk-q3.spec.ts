import { test, expect } from '@playwright/test';
import {
    getOverlaySummary,
    postQ1Signal,
} from './helpers/overlay-api';
import {
    resetLocalUatDatabaseIfConfigured,
    resetOverlaySignalStateIfConfigured,
} from './helpers/local-db';

test.describe('Q3 portfolio risk signal semantics', () => {
    test.skip(
        process.env.UAT_Q3_SIGNAL_TEST !== '1',
        'destructive Q3 signal tests require UAT_Q3_SIGNAL_TEST=1',
    );

    test.beforeEach(() => {
        resetLocalUatDatabaseIfConfigured();
        expect(
            resetOverlaySignalStateIfConfigured(),
            'set UAT_SIGNAL_RESET_COMMAND or UAT_SQLITE_DB_PATH so the test can start from no signal state',
        ).toBe(true);
    });

    test('first-seen Q3 50 creates a 100 -> 50 risk-off reduction event', async ({
        request,
    }) => {
        await postQ1Signal(request, 'SPY', 50);

        const summary = await getOverlaySummary(request);
        expect(Number(summary.effective_equity_pct)).toBe(50);
        expect(Number(summary.last_applied_q1_exposure_pct)).toBe(100);
        expect(Number(summary.signal_adjustment_ratio)).toBe(0.5);
        expect(summary.active_event_status).toBe('PENDING');
        expect(Number(summary.active_event_from_q1_exposure_pct)).toBe(100);
        expect(Number(summary.active_event_to_q1_exposure_pct)).toBe(50);
        expect(Number(summary.required_de_risk_value || 0)).toBeGreaterThan(0);
        expect(Number(summary.available_headroom_value || 0)).toBe(0);
    });

    test('repeated Q3 50 does not compound the open reduction event', async ({
        request,
    }) => {
        await postQ1Signal(request, 'SPY', 50);
        const first = await getOverlaySummary(request);

        await postQ1Signal(request, 'SPY', 50);
        const repeated = await getOverlaySummary(request);

        expect(repeated.active_event_id).toBe(first.active_event_id);
        expect(Number(repeated.active_event_from_q1_exposure_pct)).toBe(100);
        expect(Number(repeated.active_event_to_q1_exposure_pct)).toBe(50);
        expect(Number(repeated.required_de_risk_value || 0)).toBeCloseTo(
            Number(first.required_de_risk_value || 0),
            2,
        );
    });
});
