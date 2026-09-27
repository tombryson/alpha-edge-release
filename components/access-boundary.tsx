"use client";

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { Download, Fingerprint, KeyRound, LogOut, ShieldCheck, X } from 'lucide-react';
import { ApiTokenGate } from './api-token-gate';
import { API_UNAUTHORIZED_EVENT, clearApiToken } from '@/lib/api';
import { configureAccess, clearPrivateBrowserCache, getSessionCSRF, type AccessMode } from '@/lib/access-mode';
import '@/styles/access.css';

type Session = { authenticated: boolean; enrolled: boolean; recovery?: boolean; csrf_token?: string };
const AccessContext = createContext<{ mode: AccessMode; manage: () => void }>({ mode: 'legacy', manage: () => {} });

async function authRequest(path: string, body?: unknown) {
    const response = await fetch(`/api/terminal/auth/${path}`, {
        method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getSessionCSRF() },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to complete sign-in. Try again.');
    return data;
}

export function AccountAccessControl() {
    const { mode, manage } = useContext(AccessContext);
    if (mode === 'demo') return <span className="access-demo" title="Invented portfolio. Read-only. No live services.">Demo</span>;
    if (mode !== 'owner') return null;
    return <button type="button" className="terminal-header-icon-button" aria-label="Manage owner session" title="Owner session" onClick={manage}><ShieldCheck aria-hidden="true" /></button>;
}

export function AccessBoundary({ mode, children }: { mode: AccessMode; children: React.ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [ready, setReady] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [recovery, setRecovery] = useState(false);
    const [secret, setSecret] = useState('');
    const [codes, setCodes] = useState<string[]>([]);
    const [saved, setSaved] = useState(false);
    const [manage, setManage] = useState(false);
    const [notice, setNotice] = useState('');
    const dialog = useRef<HTMLDialogElement>(null);
    const previousFocus = useRef<HTMLElement | null>(null);

    const acceptSession = (next: Session) => {
        if (!next.authenticated) clearPrivateBrowserCache();
        configureAccess(mode, next.authenticated, next.csrf_token || '');
        setSession(next);
        setReady(true);
    };
    useEffect(() => {
        configureAccess(mode, mode !== 'owner');
        if (mode === 'legacy') { setReady(true); return; }
        // Session mode never reads a legacy token or a previous portfolio snapshot.
        clearApiToken();
        localStorage.removeItem('terminal-cached-data');
        if (mode === 'demo') { clearPrivateBrowserCache(); setReady(true); return; }
        let active = true;
        authRequest('session').then(value => { if (active) acceptSession(value); }).catch(() => {
            if (active) { setError('The secure connection is unavailable. Retry when the server is reachable.'); setReady(true); }
        });
        const lock = () => {
            clearApiToken(); clearPrivateBrowserCache(); configureAccess('owner', false);
            setSession({ authenticated: false, enrolled: true }); setManage(false); setCodes([]);
            setError('Your session has ended. Sign in again.');
        };
        window.addEventListener(API_UNAUTHORIZED_EVENT, lock);
        return () => { active = false; window.removeEventListener(API_UNAUTHORIZED_EVENT, lock); };
    }, [mode]);

    useEffect(() => {
        if (mode !== 'owner' || !session?.authenticated) return;
        // Do not extend idle sessions in background tabs.
        const refresh = () => {
            if (document.visibilityState === 'visible') void authRequest('refresh', {}).catch(() => {
                void authRequest('session').then(acceptSession).catch(() => {});
            });
        };
        const timer = window.setInterval(refresh, 5 * 60 * 1000);
        document.addEventListener('visibilitychange', refresh);
        return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
    }, [mode, session?.authenticated]);

    useEffect(() => {
        if (manage && dialog.current && !dialog.current.open) {
            previousFocus.current = document.activeElement as HTMLElement;
            dialog.current.showModal();
        }
        if (!manage && dialog.current?.open) { dialog.current.close(); previousFocus.current?.focus(); }
    }, [manage]);

    const run = async (task: () => Promise<void>) => {
        if (busy) return;
        setBusy(true); setError(''); setNotice('');
        try { await task(); } catch (err) {
            setError(err instanceof Error ? (err.name === 'NotAllowedError' ? 'Passkey request cancelled. You can try again.' : err.message) : 'Sign-in failed.');
        } finally { setBusy(false); setSecret(''); }
    };
    const register = () => run(async () => {
        const options = await authRequest('register/start', { setup_token: secret });
        const credential = await startRegistration({ optionsJSON: options.publicKey });
        const result = await authRequest('register/finish', credential);
        if (result.recovery_codes?.length) { setCodes(result.recovery_codes); setSaved(false); }
        acceptSession(await authRequest('session'));
        setNotice('Passkey added.');
    });
    const login = () => run(async () => {
        const options = await authRequest('login/start', {});
        const credential = await startAuthentication({ optionsJSON: options.publicKey });
        await authRequest('login/finish', credential);
        acceptSession(await authRequest('session'));
        setRecovery(false);
    });
    const recover = () => run(async () => {
        await authRequest('recover', { code: secret.trim() });
        acceptSession(await authRequest('session'));
        setRecovery(false);
    });
    const logout = (all = false) => run(async () => {
        await authRequest(all ? 'revoke-all' : 'logout', {});
        clearApiToken(); clearPrivateBrowserCache(); configureAccess('owner', false);
        // Clear all in-memory portfolio stores as well as the browser cache.
        window.location.reload();
    });
    const downloadCodes = () => {
        const file = new Blob([`Alpha Edge recovery codes\n${location.origin}\nKeep offline. Each code works once.\n\n${codes.join('\n')}\n`], { type: 'text/plain' });
        const url = URL.createObjectURL(file); const link = document.createElement('a');
        link.href = url; link.download = 'alpha-edge-recovery-codes.txt'; link.click(); URL.revokeObjectURL(url);
    };

    const authenticated = session?.authenticated && codes.length === 0;
    const content = <>
        {error && <p className="access-error" role="alert">{error}</p>}
        {notice && <p className="access-notice" role="status">{notice}</p>}
        {!ready ? <p role="status">Connecting securely...</p> : codes.length ? <>
            <h2>Keep your recovery codes</h2><p>Store these offline. Each code works once and lets you replace a lost passkey. They will not be shown again.</p>
            <ul className="access-codes">{codes.map(code => <li key={code}><code>{code}</code></li>)}</ul>
            <button type="button" onClick={downloadCodes}><Download size={16} /> Download codes</button>
            <label className="access-check"><input type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)} /> I have stored these safely</label>
            <button className="access-primary" disabled={!saved} onClick={() => { setCodes([]); setManage(false); }}>Continue</button>
        </> : authenticated ? <>
            <h2>Owner access</h2><p>To change passkeys or end all sessions, sign in again within the last 10 minutes.</p>
            <button disabled={busy} onClick={login}><Fingerprint size={18} /> Verify with passkey</button>
            <button disabled={busy} onClick={register}><KeyRound size={18} /> Add a backup passkey</button>
            <button disabled={busy} onClick={() => logout()}><LogOut size={18} /> Sign out</button>
            <button disabled={busy} onClick={() => logout(true)}>Sign out everywhere</button>
        </> : session?.recovery ? <>
            <h2>Replace your passkey</h2><p>Register a replacement now. This revokes the old passkeys, sessions and recovery codes.</p>
            <button className="access-primary" disabled={busy} onClick={register}><Fingerprint size={18} /> Register replacement</button>
        </> : session === null ? <button className="access-primary" disabled={busy} onClick={() => run(async () => acceptSession(await authRequest('session')))}>Retry connection</button>
            : !session.enrolled ? <form onSubmit={event => { event.preventDefault(); void register(); }}>
                <h2>Set up owner access</h2><p>Enter your offline setup token to register your first passkey.</p>
                <label>Setup token<input type="password" autoComplete="off" required value={secret} onChange={event => setSecret(event.target.value)} /></label>
                <button className="access-primary" disabled={busy || !secret}><Fingerprint size={18} /> Register passkey</button>
            </form> : recovery ? <form onSubmit={event => { event.preventDefault(); void recover(); }}>
                <h2>Recover access</h2><p>A recovery code can only register a replacement passkey. It cannot open your portfolio.</p>
                <label>Recovery code<input type="password" autoComplete="off" required value={secret} onChange={event => setSecret(event.target.value)} /></label>
                <button className="access-primary" disabled={busy || !secret}>Use recovery code</button>
                <button type="button" onClick={() => { setRecovery(false); setSecret(''); }}>Back to sign in</button>
            </form> : <>
                <h2>Private portfolio</h2><p>Sign in with your passkey.</p>
                <button className="access-primary" disabled={busy} onClick={login}><Fingerprint size={20} /> {busy ? 'Waiting for passkey...' : 'Sign in'}</button>
                <button disabled={busy} onClick={() => setRecovery(true)}><KeyRound size={16} /> Use a recovery code</button>
            </>}
    </>;

    return <AccessContext.Provider value={{ mode, manage: () => { setError(''); setNotice(''); setManage(true); } }}>
        {mode === 'legacy' ? <><ApiTokenGate />{children}</> : (ready && (mode === 'demo' || authenticated)) ? <>
            {children}
            {mode === 'owner' && <dialog ref={dialog} className="access-dialog" onCancel={event => { if (busy) event.preventDefault(); else setManage(false); }} aria-label="Owner access">
                <button className="access-close" disabled={busy} aria-label="Close owner access" onClick={() => setManage(false)}><X size={20} /></button>
                {content}
            </dialog>}
        </> : <main className="access-screen"><section className="access-panel">
            <div className="access-brand"><img src="/alpha-edge-header-icon.png" alt="" width={38} height={38} /><h1>Alpha Edge</h1></div>
            {content}
        </section></main>}
    </AccessContext.Provider>;
}
