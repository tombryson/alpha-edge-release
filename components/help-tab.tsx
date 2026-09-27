'use client';

import { BookOpen, ChevronRight, Compass } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { pushTerminalRoute, readTerminalRoute } from '@/lib/terminal-route';
import { HELP_SECTIONS } from '@/lib/help-content.generated';
import type { HelpBlock, HelpInline, HelpSection } from '@/lib/help-content';
import { openWelcomeGuide } from '@/lib/welcome-guide';

function Inline({ content }: { content: HelpInline[] }) {
    return content.map((part, index) => {
        if (part.type === 'text') return <span key={index}>{part.text}</span>;
        if (part.type === 'code') return <code key={index} className="font-mono text-foreground">{part.text}</code>;
        if (part.type === 'strong') return <strong key={index} className="font-semibold text-foreground"><Inline content={part.children} /></strong>;
        if (part.type === 'em') return <em key={index}><Inline content={part.children} /></em>;
        if (part.type === 'link') return <a key={index} href={part.href} className="text-foreground underline underline-offset-4 hover:decoration-foreground/50"><Inline content={part.children} /></a>;
        return null;
    });
}

function PathDiagram({ path }: { path: Extract<HelpBlock, { type: 'diagram' }> }) {
    return (
        <div data-testid={`help-${path.id}-diagram`} aria-label={path.label} className="my-[20px] overflow-x-auto py-[5px] [scrollbar-width:thin]">
            <div className="flex w-max items-start gap-0 pr-[6px]">
                {path.nodes.map((label, index) => <div key={label} className="flex items-start">
                    {index > 0 && <span data-help-path-connector="true" className="mt-[6px] block h-[2px] w-[28px] shrink-0 bg-[var(--signal-buy)]" aria-hidden="true" />}
                    <div className="flex w-[88px] shrink-0 flex-col items-center gap-[8px] text-center">
                        <span data-help-path-node="true" className="block h-[14px] w-[14px] rounded-[2px] bg-[var(--signal-buy)]" style={{ boxShadow: '0 0 0 4px color-mix(in srgb, var(--signal-buy) 13%, transparent)' }} aria-hidden="true" />
                        <span className="text-[10px] font-semibold leading-[15px] text-foreground">{label}</span>
                    </div>
                </div>)}
                {path.result && <>
                    <span data-help-path-connector="true" className="mt-[6px] block h-[2px] w-[24px] shrink-0 bg-[var(--signal-buy)]" aria-hidden="true" />
                    <span className="mt-[-6px] border border-[var(--signal-buy)] px-[8px] py-[6px] text-[10px] font-medium leading-[14px] text-[var(--signal-buy)]">{path.result}</span>
                </>}
            </div>
        </div>
    );
}

function Block({ block }: { block: Exclude<HelpBlock, { type: 'heading' }> }) {
    if (block.type === 'diagram') return <PathDiagram path={block} />;
    if (block.type === 'paragraph') return <p className="mt-[10px] text-[13px] leading-[22px] text-foreground/85"><Inline content={block.children} /></p>;
    const Tag = block.ordered ? 'ol' : 'ul';
    return <Tag className={`mt-[12px] space-y-[8px] pl-[20px] text-[13px] leading-[22px] text-foreground/85 ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
        {block.items.map((item, index) => <li key={index}><Inline content={item} /></li>)}
    </Tag>;
}

function ArticleSections({ section }: { section: HelpSection }) {
    const groups: { heading?: Extract<HelpBlock, { type: 'heading' }>; content: ReactNode[] }[] = [{ content: [] }];
    section.blocks.forEach((block, index) => {
        if (block.type === 'heading') groups.push({ heading: block, content: [] });
        else groups[groups.length - 1].content.push(<Block key={index} block={block} />);
    });
    return <>
        {groups.map((group, index) => <section key={index} id={group.heading?.id}
            data-testid={section.id === 'markets' && group.heading?.id === 'direct-commodity-sleeve' ? 'help-market-direct-path' : section.id === 'markets' && group.heading?.id === 'equity-company-then-outperform' ? 'help-market-equity-path' : undefined}
            className={group.heading ? 'mt-[22px] border-t border-border/65 pt-[18px]' : ''}>
            {group.heading && <h3 className="text-[15px] font-medium leading-[22px] text-foreground">{group.heading.text}</h3>}
            {group.content}
        </section>)}
    </>;
}

function Article({ section }: { section: HelpSection }) {
    return <article data-testid={`help-article-${section.id}`}>
        <div className="text-[11px] font-medium text-muted-foreground">Help / {section.label}</div>
        <h2 className="mt-[7px] text-[18px] font-semibold leading-[26px] text-foreground">{section.title}</h2>
        <p className="mt-[10px] text-[13px] leading-[22px] text-muted-foreground">{section.body}</p>
        {section.id !== 'overview' && <ArticleSections section={section} />}
    </article>;
}

export function HelpTab() {
    const [activeId, setActiveId] = useState('overview');
    const scrollArea = useRef<HTMLDivElement>(null);
    const active = HELP_SECTIONS.find(section => section.id === activeId) || HELP_SECTIONS[0];
    const navigate = useCallback((id: string) => {
        pushTerminalRoute({ tab: 'HELP', helpSection: id });
        setActiveId(id);
        scrollArea.current?.scrollTo({ top: 0 });
    }, []);

    useEffect(() => {
        const sync = () => {
            const route = readTerminalRoute();
            const id = route?.tab === 'HELP' ? route.helpSection : 'overview';
            setActiveId(HELP_SECTIONS.some(section => section.id === id) ? id! : 'overview');
            scrollArea.current?.scrollTo({ top: 0 });
        };
        sync();
        window.addEventListener('popstate', sync);
        window.addEventListener('hashchange', sync);
        return () => {
            window.removeEventListener('popstate', sync);
            window.removeEventListener('hashchange', sync);
        };
    }, []);

    return <main className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--panel-bg-alt)] text-foreground" data-testid="help-tab">
        <header className="flex shrink-0 flex-wrap items-start gap-[12px] border-b border-border/70 px-[24px] py-[18px] max-sm:px-[16px]">
            <BookOpen className="mt-[2px] h-[18px] w-[18px] shrink-0 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />
            <div><h1 className="text-[18px] font-semibold leading-[24px]">Help</h1><p className="mt-[5px] text-[12px] leading-[18px] text-muted-foreground">A quick map of the application.</p></div>
            <button type="button" onClick={openWelcomeGuide} className="ml-auto inline-flex min-h-[36px] cursor-pointer items-center gap-[8px] rounded-[4px] border border-border px-[12px] py-[6px] text-[13px] font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-foreground max-sm:min-h-[40px]">
                <Compass size={16} className="text-primary" aria-hidden="true" />Guided tour
            </button>
        </header>
        <div className="flex min-h-0 flex-1 overflow-hidden max-sm:flex-col">
            <aside className="w-[184px] shrink-0 overflow-y-auto border-r border-border/70 px-[12px] py-[16px] max-sm:w-full max-sm:border-b max-sm:border-r-0 max-sm:py-[8px]">
                <div className="px-[8px] pb-[8px] text-[11px] font-medium text-muted-foreground max-sm:hidden">Contents</div>
                <nav aria-label="Help contents" className="space-y-[2px] max-sm:flex max-sm:gap-[4px] max-sm:space-y-0 max-sm:overflow-x-auto">
                    {HELP_SECTIONS.map(section => <button key={section.id} type="button" onClick={() => navigate(section.id)} aria-current={active.id === section.id ? 'page' : undefined}
                        className={`flex min-h-[36px] w-full items-center justify-between gap-[8px] border-l-[2px] px-[8px] py-[7px] text-left text-[12px] max-sm:min-h-[40px] max-sm:w-auto max-sm:shrink-0 max-sm:border-b-[2px] max-sm:border-l-0 ${active.id === section.id ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'}`}>
                        <span>{section.label}</span><ChevronRight className="h-[13px] w-[13px] shrink-0 max-sm:hidden" strokeWidth={1.7} aria-hidden="true" />
                    </button>)}
                </nav>
            </aside>
            <div ref={scrollArea} data-testid="help-scroll-area" className="min-w-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
                <div className="mx-auto max-w-[780px] px-[28px] py-[20px] max-sm:px-[16px]">
                    <Article section={active} />
                    {active.id === 'overview' && <nav aria-label="Overview contents" className="mt-[24px]">
                        {HELP_SECTIONS.filter(section => section.id !== 'overview').map(section => <button key={section.id} type="button" aria-label={`Open ${section.title}`} onClick={() => navigate(section.id)} className="group block w-full border-t border-border/65 py-[18px] text-left">
                            <span className="text-[11px] font-medium text-muted-foreground">{section.label}</span>
                            <span className="mt-[6px] flex items-center justify-between gap-[12px] text-[15px] font-medium leading-[22px] group-hover:underline"><span>{section.title}</span><ChevronRight size={16} aria-hidden="true" /></span>
                            <span className="mt-[8px] block text-[13px] leading-[22px] text-muted-foreground">{section.body}</span>
                        </button>)}
                    </nav>}
                    {active.id === 'overview' && <ArticleSections section={active} />}
                </div>
            </div>
        </div>
    </main>;
}
