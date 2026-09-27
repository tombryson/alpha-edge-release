'use client';

import * as Dialog from '@radix-ui/react-dialog';
import Image from 'next/image';
import { ArrowLeft, ArrowRight, Check, Compass, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getAccessMode } from '@/lib/access-mode';
import { normalizeTerminalRouteTab, readTerminalRoute, requestTerminalTab } from '@/lib/terminal-route';
import { OPEN_WELCOME_GUIDE, WELCOME_GUIDE_STORAGE_KEY, WELCOME_STEPS } from '@/lib/welcome-guide';
import styles from './welcome-guide.module.css';

// Storage may be unavailable. Still avoid repeating the invitation on remount.
const invitedThisSession = new Set<string>();

export function WelcomeGuide() {
    const [welcomeOpen, setWelcomeOpen] = useState(false);
    const [running, setRunning] = useState(false);
    const [index, setIndex] = useState(0);
    const [demo, setDemo] = useState(false);
    const storageKey = useRef('');
    const runningRef = useRef(false);
    const heading = useRef<HTMLHeadingElement>(null);
    const startButton = useRef<HTMLButtonElement>(null);
    const step = WELCOME_STEPS[index];
    const last = index === WELCOME_STEPS.length - 1;

    const remember = (status: 'dismissed' | 'started' | 'completed') => {
        try { localStorage.setItem(storageKey.current, status); } catch { /* Optional presentation preference. */ }
    };
    const closeWelcome = () => { remember('dismissed'); setWelcomeOpen(false); };
    const stop = () => {
        runningRef.current = false;
        setRunning(false);
        document.querySelector<HTMLButtonElement>('[data-testid="header-help"]')?.focus();
    };
    const move = (next: number) => {
        setIndex(next);
        // Re-requesting the selected tab toggles the shell; the guide must not.
        if (readTerminalRoute()?.tab !== WELCOME_STEPS[next].tab) requestTerminalTab(WELCOME_STEPS[next].tab);
    };
    const start = () => {
        remember('started');
        setWelcomeOpen(false);
        runningRef.current = true;
        setRunning(true);
        move(0);
    };

    useEffect(() => {
        const mode = getAccessMode();
        const key = `${WELCOME_GUIDE_STORAGE_KEY}:${mode}`;
        storageKey.current = key;
        setDemo(mode === 'demo');
        const route = readTerminalRoute();
        let seen = invitedThisSession.has(key);
        try { seen ||= Boolean(localStorage.getItem(key)); } catch { /* Use session fallback. */ }
        // Deep links remain uninterrupted; the invitation can always be opened in Help.
        if (!seen && (!route || route.tab === 'POSITIONS')) {
            invitedThisSession.add(key);
            setWelcomeOpen(true);
        }
        const open = () => {
            runningRef.current = false;
            setRunning(false);
            setWelcomeOpen(true);
        };
        const navigate = (event: Event) => {
            if (!runningRef.current) return;
            const tab = normalizeTerminalRouteTab((event as CustomEvent<{ tab?: string }>).detail?.tab);
            const next = WELCOME_STEPS.findIndex(item => item.tab === tab);
            if (next >= 0) setIndex(next);
            else { runningRef.current = false; setRunning(false); }
        };
        window.addEventListener(OPEN_WELCOME_GUIDE, open);
        window.addEventListener('tabChange', navigate);
        return () => {
            window.removeEventListener(OPEN_WELCOME_GUIDE, open);
            window.removeEventListener('tabChange', navigate);
        };
    }, []);

    useEffect(() => { if (running) heading.current?.focus(); }, [running, index]);

    return <>
        <Dialog.Root open={welcomeOpen} onOpenChange={open => { if (!open) closeWelcome(); }}>
            <Dialog.Portal>
                <Dialog.Overlay className={styles.backdrop} />
                <Dialog.Content className={styles.welcome}
                    onOpenAutoFocus={event => { event.preventDefault(); startButton.current?.focus(); }}
                    onCloseAutoFocus={event => {
                        event.preventDefault();
                        if (runningRef.current) heading.current?.focus();
                        else document.querySelector<HTMLButtonElement>('[data-testid="header-help"]')?.focus();
                    }}>
                    <header className={styles.brand}>
                        <Image src="/alpha-edge-header-icon.png" width={40} height={40} alt="" />
                        <span>Alpha Edge</span>
                        <button type="button" className={styles.iconButton} onClick={closeWelcome} aria-label="Close welcome" title="Close"><X size={18} aria-hidden="true" /></button>
                    </header>
                    <div className={styles.introduction}>
                        <span className={styles.greeting}>Hi there!</span>
                        <Dialog.Title className={styles.welcomeTitle}>Welcome to Alpha Edge</Dialog.Title>
                        <Dialog.Description className={styles.description}>
                            Alpha Edge is designed as a modern Investment Advisory application, to help resolve the toughest decisions in portfolio construction and maintenance.
                        </Dialog.Description>
                        <p className={styles.invitation}>Let me guide you through it, from the portfolio you want to the positions you hold.</p>
                    </div>
                    <ol className={styles.outline}>
                        <li><span>01</span><div><strong>Set your direction</strong><p>Start with your approved portfolio shape.</p></div></li>
                        <li><span>02</span><div><strong>Build your conviction</strong><p>Bring research and market evidence together.</p></div></li>
                        <li><span>03</span><div><strong>Manage with discipline</strong><p>Review actions and confirm what changed.</p></div></li>
                    </ol>
                    <div className={styles.boundary}>
                        {demo ? 'You are exploring a read-only demo with simulated holdings. Nothing here places a trade.' : 'You stay in control. Alpha Edge supports decisions; you place orders at your broker.'}
                    </div>
                    <footer className={styles.welcomeFooter}>
                        <button type="button" className={styles.secondary} onClick={closeWelcome}>Explore on my own</button>
                        <button ref={startButton} type="button" className={styles.primary} onClick={start}>Show me around <ArrowRight size={16} aria-hidden="true" /></button>
                    </footer>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
        {running && <section className={styles.guide} aria-label="Getting started guide">
            <div className={styles.guideTop}>
                <span className={styles.stepLabel}><Compass size={15} aria-hidden="true" />Getting started <span>{index + 1} / {WELCOME_STEPS.length}</span></span>
                <button type="button" className={styles.iconButton} onClick={stop} aria-label="Close guide" title="Close guide"><X size={16} aria-hidden="true" /></button>
            </div>
            <div className={styles.guideBody} aria-live="polite" aria-atomic="true">
                <h2 ref={heading} tabIndex={-1}>{step.title}</h2>
                <p>{step.body}</p>
            </div>
            <footer className={styles.guideFooter}>
                <p>{step.reminder}</p>
                <div className={styles.navigation}>
                    <button type="button" className={styles.iconButton} disabled={index === 0} onClick={() => move(index - 1)} aria-label="Previous guide step" title="Previous"><ArrowLeft size={16} aria-hidden="true" /></button>
                    <button type="button" className={styles.primary} onClick={() => {
                        if (last) { remember('completed'); stop(); }
                        else move(index + 1);
                    }}>{last ? 'Finish tour' : 'Next'}{last ? <Check size={16} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}</button>
                </div>
            </footer>
            <div className={styles.progress} aria-hidden="true">{WELCOME_STEPS.map((item, i) => <span key={item.tab} data-reached={i <= index} />)}</div>
        </section>}
    </>;
}
