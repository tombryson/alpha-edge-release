'use client';

import * as Popover from '@radix-ui/react-popover';
import { ShieldCheck } from 'lucide-react';
import { useWeightPolicy, setWeightManagement } from '@/lib/use-weight-policy';

export function WeightPolicyControl() {
    const { data, error, saving } = useWeightPolicy();
    return <span onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} draggable={false}>
        <Popover.Root>
            <Popover.Trigger asChild>
                <button type="button" aria-label="Weight management" title={`Weight management: ${error || !data ? 'unavailable' : data.enabled ? 'On' : 'Off'}`}
                    className={`inline-flex size-[20px] shrink-0 cursor-pointer items-center justify-center align-middle hover:text-primary ${data?.enabled ? 'text-primary' : 'text-muted-foreground'}`}>
                    <ShieldCheck size={14} aria-hidden="true" />
                </button>
            </Popover.Trigger>
            <Popover.Portal><Popover.Content align="end" sideOffset={6} className="z-[120] w-[260px] max-w-[calc(100vw-24px)] rounded border border-border bg-popover p-[12px] text-[13px] leading-[1.45] font-normal text-popover-foreground shadow-lg">
                <label className="flex cursor-pointer items-center justify-between gap-[12px] font-medium">
                    Weight management
                    <input type="checkbox" role="switch" aria-label="Weight management enabled" checked={data?.enabled ?? false}
                        disabled={!data || saving || !!error || data.read_only} onChange={event => void setWeightManagement(event.target.checked)} className="size-[16px] shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed" />
                </label>
                <p className="mt-[8px] text-[12px] text-muted-foreground">{data?.enabled ? 'Limits additions to Ideal wt and flags sustained excess for review.' : 'Ideal wt is advisory. Class budgets and risk rules still apply.'}</p>
                {data?.read_only && <p className="mt-[8px] text-[12px] text-muted-foreground">Read-only demonstration</p>}
                {error && <p role="alert" className="mt-[8px] text-[12px] text-destructive">{error}</p>}
                <a href="#/help/positions" className="mt-[8px] inline-block text-[12px] text-primary hover:underline">Policy in Help</a>
            </Popover.Content></Popover.Portal>
        </Popover.Root>
    </span>;
}
