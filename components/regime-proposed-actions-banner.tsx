'use client';
import { subscribePoll } from '@/lib/polling';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import type { RegimeProposedAction } from '@/lib/api';

/**
 * Polls for pending regime proposed actions and renders a confirmation banner
 * when any are found. The user must explicitly apply or dismiss each action —
 * no position state changes happen without confirmation.
 */
export function RegimeProposedActionsBanner() {
    const [actions, setActions] = useState<RegimeProposedAction[]>([]);
    const [open, setOpen] = useState(false);
    const [applying, setApplying] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchActions = useCallback(async () => {
        try {
            const res = await api.getRegimeProposedActions();
            setActions(res.proposed_actions ?? []);
        } catch {
            // Silently ignore — badge simply stays hidden on error.
        }
    }, []);

    // Poll every 30 s. Regime webhooks are infrequent; no need for SSE here.
    useEffect(() => {
        return subscribePoll(fetchActions, 30_000);
    }, [fetchActions]);

    if (actions.length === 0) return null;

    const handleApplyAll = async () => {
        setApplying(true);
        setError(null);
        try {
            await api.applyRegimeImpacts(actions.map((a) => a.id));
            setActions([]);
            setOpen(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Apply failed');
        } finally {
            setApplying(false);
        }
    };

    const handleDismissAll = async () => {
        setApplying(true);
        setError(null);
        try {
            await api.applyRegimeImpacts([], actions.map((a) => a.id));
            setActions([]);
            setOpen(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Dismiss failed');
        } finally {
            setApplying(false);
        }
    };

    const handleApplyOne = async (id: number) => {
        setApplying(true);
        setError(null);
        try {
            await api.applyRegimeImpacts([id]);
            setActions((prev) => prev.filter((a) => a.id !== id));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Apply failed');
        } finally {
            setApplying(false);
        }
    };

    const handleDismissOne = async (id: number) => {
        setApplying(true);
        setError(null);
        try {
            await api.applyRegimeImpacts([], [id]);
            setActions((prev) => prev.filter((a) => a.id !== id));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Dismiss failed');
        } finally {
            setApplying(false);
        }
    };

    return (
        <>
            {/* Badge button */}
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex items-center gap-1.5 rounded border border-amber-500/60 bg-amber-500/10 px-2 py-1 text-[11px] font-mono text-amber-200 hover:bg-amber-500/20"
                title="Pending regime actions — click to review"
            >
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                {actions.length} REGIME ACTION{actions.length !== 1 ? 'S' : ''}
            </button>

            {/* Review panel */}
            {open && (
                <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-20 px-4">
                    <div className="w-full max-w-2xl rounded-xl border border-amber-500/30 bg-card shadow-xl">
                        <div className="flex items-center justify-between border-b border-border/50 px-5 py-4">
                            <div>
                                <div className="text-[10px] font-mono tracking-widest text-amber-300">
                                    REGIME SIGNAL
                                </div>
                                <div className="mt-0.5 text-sm font-semibold text-foreground">
                                    Proposed position changes — review before applying
                                </div>
                                <div className="mt-1 text-[11px] text-muted-foreground">
                                    These actions were computed from a regime webhook but have{' '}
                                    <strong>not</strong> been applied. Confirm each one below.
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                className="rounded border border-border/50 px-2 py-1 text-[11px] font-mono text-muted-foreground hover:text-foreground"
                            >
                                CLOSE
                            </button>
                        </div>

                        <div className="max-h-[60vh] overflow-y-auto px-5 py-4 space-y-3">
                            {actions.map((action) => (
                                <div
                                    key={action.id}
                                    className="rounded-lg border border-border/50 bg-background/40 px-4 py-3"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-mono font-semibold text-foreground">
                                                    {action.ticker}
                                                </span>
                                                <span className="rounded border border-border/50 px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground">
                                                    {action.security_type}
                                                </span>
                                                <span
                                                    className={`rounded border px-1.5 py-0.5 text-[9px] font-mono ${
                                                        action.action === 'SELL'
                                                            ? 'border-red-500/50 text-red-300'
                                                            : 'border-sky-500/50 text-sky-300'
                                                    }`}
                                                >
                                                    {action.action}
                                                </span>
                                            </div>
                                            <div className="text-[11px] font-mono text-muted-foreground">
                                                Regime: {action.regime_ticker} →{' '}
                                                <span
                                                    className={
                                                        action.signal === 'SELL'
                                                            ? 'text-red-300'
                                                            : 'text-emerald-300'
                                                    }
                                                >
                                                    {action.signal}
                                                </span>
                                                {' · '}Target: {action.target_position_pct}%
                                                {action.asset_classes_sell.length > 0 && (
                                                    <> · Sell: {action.asset_classes_sell.join(', ')}</>
                                                )}
                                            </div>
                                            <div className="text-[10px] text-muted-foreground/60">
                                                Received{' '}
                                                {new Date(action.created_at).toLocaleString('en-AU')}
                                            </div>
                                        </div>
                                        <div className="flex shrink-0 gap-2">
                                            <button
                                                type="button"
                                                onClick={() => handleApplyOne(action.id)}
                                                disabled={applying}
                                                className="rounded border border-emerald-500/50 bg-emerald-500/10 px-2 py-1 text-[10px] font-mono text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
                                            >
                                                APPLY
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleDismissOne(action.id)}
                                                disabled={applying}
                                                className="rounded border border-border/50 px-2 py-1 text-[10px] font-mono text-muted-foreground hover:text-foreground disabled:opacity-50"
                                            >
                                                DISMISS
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {error && (
                            <div className="border-t border-red-500/30 bg-red-500/10 px-5 py-2 text-[11px] font-mono text-red-300">
                                {error}
                            </div>
                        )}

                        <div className="flex items-center justify-end gap-2 border-t border-border/50 px-5 py-4">
                            <button
                                type="button"
                                onClick={handleDismissAll}
                                disabled={applying}
                                className="rounded border border-border/50 px-3 py-1.5 text-[11px] font-mono text-muted-foreground hover:text-foreground disabled:opacity-50"
                            >
                                DISMISS ALL
                            </button>
                            <button
                                type="button"
                                onClick={handleApplyAll}
                                disabled={applying}
                                className="rounded border border-emerald-500/50 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-mono text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
                            >
                                {applying ? 'APPLYING…' : 'APPLY ALL'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
