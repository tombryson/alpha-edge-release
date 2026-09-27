'use client';

import { X } from 'lucide-react';
import type { ListingReview } from '@/lib/api';

interface ListingReviewsModalProps {
    open: boolean;
    reviews: ListingReview[];
    loading: boolean;
    error: string | null;
    onClose: () => void;
}

function reviewTitle(review: ListingReview) {
    return review.review_type === 'NAME_CHANGE_CANDIDATE'
        ? 'Name differs'
        : 'Listing unavailable';
}

export function ListingReviewsModal({
    open,
    reviews,
    loading,
    error,
    onClose,
}: ListingReviewsModalProps) {
    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-[220] flex items-center justify-center bg-black/70 p-4"
            onMouseDown={onClose}
        >
            <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="listing-reviews-title"
                className="w-full max-w-[680px] overflow-hidden rounded border border-border bg-card shadow-2xl"
                onMouseDown={(event) => event.stopPropagation()}
            >
                <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
                    <div>
                        <h2
                            id="listing-reviews-title"
                            className="text-sm font-semibold tracking-wide text-foreground"
                        >
                            LISTING REVIEWS
                        </h2>
                        <p className="mt-1 text-xs text-muted-foreground">
                            Provider observations that need a manual identity check.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close listing reviews"
                        title="Close"
                        className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground"
                    >
                        <X size={15} aria-hidden="true" />
                    </button>
                </header>

                <div className="max-h-[60vh] overflow-y-auto">
                    {loading && (
                        <div className="px-5 py-8 text-center text-xs text-muted-foreground">
                            Loading reviews...
                        </div>
                    )}
                    {!loading && error && (
                        <div className="px-5 py-6 text-xs text-destructive">{error}</div>
                    )}
                    {!loading && !error && reviews.length === 0 && (
                        <div className="px-5 py-8 text-center text-xs text-muted-foreground">
                            No listing reviews are open.
                        </div>
                    )}
                    {!loading && !error && reviews.map((review) => (
                        <article
                            key={review.id}
                            className="border-b border-border/60 px-5 py-4 last:border-b-0"
                        >
                            <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-medium text-foreground">
                                        {review.name}
                                    </div>
                                    <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                                        {review.ticker}
                                    </div>
                                </div>
                                <span className="shrink-0 text-[11px] font-medium text-caution">
                                    {reviewTitle(review)}
                                </span>
                            </div>

                            {review.review_type === 'NAME_CHANGE_CANDIDATE' ? (
                                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                                    <div>
                                        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                                            Current
                                        </div>
                                        <div className="mt-0.5 text-foreground">{review.current_name}</div>
                                    </div>
                                    <div>
                                        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                                            Yahoo observed
                                        </div>
                                        <div className="mt-0.5 text-foreground">{review.observed_name}</div>
                                    </div>
                                </div>
                            ) : (
                                <p className="mt-3 text-xs text-muted-foreground">
                                    Yahoo could not resolve this listing on two consecutive checks.
                                </p>
                            )}
                        </article>
                    ))}
                </div>

                <footer className="border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
                    Reviews do not rename securities, retire listings, or change TradingView connections.
                </footer>
            </section>
        </div>
    );
}
