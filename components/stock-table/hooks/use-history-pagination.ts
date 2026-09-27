import { useEffect, useRef, useState } from 'react';

export const HISTORY_PAGE_SIZE = 100;

export function useHistoryPagination<T>(records: T[], query: string) {
    const [selection, setSelection] = useState({ query, page: 0 });
    const scrollRef = useRef<HTMLDivElement>(null);
    const total = records.length;
    const pageCount = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
    const page = Math.min(selection.query === query ? selection.page : 0, pageCount - 1);
    const start = page * HISTORY_PAGE_SIZE;
    const end = Math.min(start + HISTORY_PAGE_SIZE, total);

    useEffect(() => {
        if (selection.query !== query || selection.page !== page) {
            setSelection({ query, page });
        }
    }, [query, page, selection]);

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }, [page, query]);

    return {
        records: records.slice(start, end),
        scrollRef,
        page,
        pageCount,
        start,
        end,
        total,
        setPage: (nextPage: number) => setSelection({
            query,
            page: Math.max(0, Math.min(nextPage, pageCount - 1)),
        }),
    };
}
