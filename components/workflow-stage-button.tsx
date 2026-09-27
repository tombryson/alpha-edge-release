type WorkflowStageButtonProps = {
    label: string;
    badge: string;
    badgeClassName: string;
    caption: string;
    active?: boolean;
    onClick?: () => void;
    variant?: 'card' | 'section';
    testId?: string;
};

export function WorkflowStageButton({
    label,
    badge,
    badgeClassName,
    caption,
    active = false,
    onClick,
    variant = 'card',
    testId,
}: WorkflowStageButtonProps) {
    if (variant === 'section') {
        return (
            <button
                type="button"
                onClick={onClick}
                disabled={!onClick}
                data-testid={testId}
                data-active={active ? 'true' : 'false'}
                className={`grid min-h-[54px] w-full min-w-0 content-center border-b border-border/25 px-3.5 py-2.5 text-left last:border-b-0 ${
                    onClick
                        ? 'cursor-pointer hover:bg-sky-500/[0.04]'
                        : 'cursor-default'
                } ${
                    active
                        ? 'border-l-[3px] border-l-sky-300 bg-sky-500/[0.08]'
                        : 'border-l-[3px] border-l-transparent bg-background/10 opacity-50'
                }`}
            >
                <div className="flex items-center justify-between gap-2">
                    <span
                        className={`truncate text-[10px] font-mono font-semibold uppercase tracking-[0.1em] ${
                            active ? 'text-sky-100' : 'text-muted-foreground'
                        }`}
                    >
                        {label}
                    </span>
                    <span
                        className={`shrink-0 rounded border px-1.5 py-0.5 text-[8px] font-mono uppercase ${
                            active
                                ? badgeClassName
                                : 'border-border/35 bg-background/20 text-muted-foreground'
                        }`}
                    >
                        {badge}
                    </span>
                </div>
                {active && caption && (
                    <div className="mt-1 text-[10px] text-sky-100/80">
                        {caption}
                    </div>
                )}
            </button>
        );
    }

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={!onClick}
            data-testid={testId}
            data-active={active ? 'true' : 'false'}
            className={`w-full min-w-0 rounded-lg border px-2.5 py-2 text-left ${
                onClick
                    ? 'cursor-pointer hover:border-sky-400/45 hover:bg-sky-500/[0.04]'
                    : 'cursor-default'
            } ${
                active
                    ? 'border-sky-300/80 bg-sky-500/[0.14] shadow-[inset_4px_0_0_rgba(56,189,248,0.95)] ring-1 ring-sky-300/45'
                    : 'border-border/35 bg-background/20 opacity-70'
            }`}
        >
            <div className="flex items-center justify-between gap-2">
                <span
                    className={`truncate text-[10px] font-mono uppercase tracking-[0.12em] ${
                        active ? 'text-sky-100' : 'text-muted-foreground'
                    }`}
                >
                    {label}
                </span>
                <span
                    className={`shrink-0 rounded border px-1.5 py-0.5 text-[8px] font-mono uppercase ${
                        active
                            ? badgeClassName
                            : 'border-border/35 bg-background/20 text-muted-foreground'
                    }`}
                >
                    {badge}
                </span>
            </div>
            <div
                className={`mt-1 truncate text-[10px] ${
                    active ? 'text-sky-100/80' : 'text-muted-foreground'
                }`}
            >
                {caption}
            </div>
        </button>
    );
}
