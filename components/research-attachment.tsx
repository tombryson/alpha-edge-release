'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { Check, ClipboardPaste, Paperclip, Upload, X } from 'lucide-react';
import styles from './research-library.module.css';

type Props = {
    ticker: string;
    attachment?: File | null;
    onChange: (file: File | null) => void;
    renderFooter: (primaryAction?: ReactNode) => ReactNode;
};

const maxBytes = 20 * 1024 * 1024;

export function ResearchAttachment({ ticker, attachment, onChange, renderFooter }: Props) {
    const input = useRef<HTMLInputElement>(null);
    const textId = useId();
    const errorId = useId();
    const [pasting, setPasting] = useState(false);
    const [text, setText] = useState('');
    const [error, setError] = useState('');

    const attach = (file: File) => {
        if (!/\.(pdf|md|txt|json)$/i.test(file.name)) {
            setError('Choose a PDF, Markdown, text or JSON document.');
            return;
        }
        if (!file.size || file.size > maxBytes) {
            setError(file.size ? 'The document exceeds the 20 MB limit.' : 'The document is empty.');
            return;
        }
        onChange(file);
        setError(''); setText(''); setPasting(false);
    };

    const attachText = () => {
        if (!text.trim()) return;
        const name = `sources-${ticker.replace(/[^a-z0-9-]/gi, '-') || 'security'}.txt`;
        attach(new File([text], name, { type: 'text/plain' }));
    };

    return <section className={styles.panel} aria-label="Council sources">
        <div className={`${styles.body} ${styles.attachmentBody}`} data-research-scroll>
        <div className={styles.sectionToolbar}>
            <div className={styles.actions}>
                <button type="button" className={styles.button} aria-expanded={pasting} aria-controls={textId}
                    onClick={() => { setPasting(value => !value); if (pasting) setText(''); setError(''); }}>
                    {pasting ? <X size={15} /> : <ClipboardPaste size={15} />}{pasting ? 'Cancel' : 'Paste'}
                </button>
                <button type="button" className={styles.button} onClick={() => input.current?.click()}>
                    <Upload size={15} />Upload
                </button>
                <input ref={input} type="file" accept=".pdf,.md,.txt,.json" hidden aria-label="Upload Council sources"
                    onChange={event => {
                        const file = event.currentTarget.files?.[0];
                        if (file) attach(file);
                        event.currentTarget.value = '';
                    }} />
            </div>
            {!pasting && <span className={styles.meta}>PDF, Markdown, text or JSON</span>}
        </div>
        {attachment && !pasting ? <div className={styles.attachmentRow} role="status">
            <Paperclip size={16} aria-hidden="true" />
            <div className={styles.attachmentIdentity}>
                <span>{attachment.name}</span>
                <span className={styles.meta}>Attached for the next Council run</span>
            </div>
            <button type="button" className={styles.iconButton} aria-label="Remove Council attachment" title="Remove attachment"
                onClick={() => { onChange(null); setError(''); }}><X size={16} /></button>
        </div> : null}
        <div id={textId} hidden={!pasting} className={styles.pasteEditor}>
            <label htmlFor={`${textId}-text`} className="sr-only">Source text</label>
            <textarea id={`${textId}-text`} value={text} rows={7} aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined} placeholder="Paste source material"
                onChange={event => { setText(event.target.value); setError(''); }} />
        </div>
        {error && <p className={styles.error} id={errorId} role="alert">{error}</p>}
        </div>
        {renderFooter(pasting ? <button type="button" className={`${styles.button} ${styles.retrieveButton}`} disabled={!text.trim()} onClick={attachText}>
            <Check size={15} />{attachment ? 'Replace attachment' : 'Attach sources'}
        </button> : undefined)}
    </section>;
}
