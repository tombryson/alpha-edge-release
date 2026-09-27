"use client";

import { useEffect, useRef, useState, type RefObject } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as RadioGroup from '@radix-ui/react-radio-group';
import { Check, RotateCcw, Search, X } from 'lucide-react';
import { api, type AssetClass } from '@/lib/api';
import { assetClassColourKey, assetClassDefaultColor } from '@/lib/asset-class-identity';
import { ASSET_CLASS_COLOUR_PRESETS } from '@/lib/asset-class-colour-presets';
import { useClassColours } from '@/lib/asset-class-colour-store';
import styles from './asset-class-colour-dialog.module.css';

export function AssetClassColourControl({ assetClass, variant = 'list', className }: {
    assetClass: Pick<AssetClass, 'code' | 'display_name'>;
    variant?: 'list' | 'swatch';
    className?: string;
}) {
    const key = assetClassColourKey(assetClass.code);
    const custom = useClassColours(state => state.overrides[key]);
    const ready = useClassColours(state => state.ready);
    const saving = useClassColours(state => state.saving);
    const save = useClassColours(state => state.save);
    const colour = custom || assetClassDefaultColor(key);
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(colour);
    const [error, setError] = useState('');
    const submitting = useRef(false);
    const selected = ASSET_CLASS_COLOUR_PRESETS.find(preset => preset.colour === draft);

    const submit = async (value: string) => {
        if (submitting.current) return;
        submitting.current = true;
        setError('');
        try {
            await save(assetClass.code, value);
            setOpen(false);
        } catch (error) {
            setError(error instanceof Error ? error.message : 'The colour could not be saved.');
        } finally {
            submitting.current = false;
        }
    };

    return (
            <Dialog.Root open={open} onOpenChange={next => {
                if (submitting.current) return;
                if (next) { setDraft(colour); setError(''); }
                setOpen(next);
            }}>
                <Dialog.Trigger asChild>
                    <button className={variant === 'swatch' ? className : styles.colourButton} type="button" disabled={!ready || saving}
                        style={variant === 'swatch' ? { backgroundColor: colour } : undefined}
                        onClick={event => event.stopPropagation()}
                        aria-label={`Change ${assetClass.display_name} colour`} title={`Change ${assetClass.display_name} colour`}>
                        {variant === 'list' && <>
                        <span className={styles.swatch} style={{ backgroundColor: colour }} />
                        <span className={styles.hex}>{colour.toUpperCase()}</span>
                        <span className={styles.custom}>{custom ? 'Custom' : ''}</span>
                        </>}
                    </button>
                </Dialog.Trigger>
                <Dialog.Portal>
                    <Dialog.Overlay className={`${styles.overlay} ${styles.editorOverlay}`} onClick={event => event.stopPropagation()} />
                    <Dialog.Content className={styles.editor} aria-describedby={undefined} onClick={event => event.stopPropagation()}>
                        <form onSubmit={event => { event.preventDefault(); if (selected && !saving && draft !== colour) void submit(draft); }}>
                            <div className={styles.editorHeading}>
                                <Dialog.Title className={styles.editorName}>{assetClass.display_name} colour</Dialog.Title>
                                <Dialog.Close className={styles.close} disabled={saving} aria-label="Close colour selection" title="Close">
                                    <X size={20} aria-hidden="true" />
                                </Dialog.Close>
                            </div>
                            <div className={styles.selection} aria-live="polite">
                                <span className={styles.swatch} style={{ backgroundColor: draft }} aria-hidden="true" />
                                <span>{selected?.name || 'Current colour'}</span>
                            </div>
                            <RadioGroup.Root className={styles.palette} aria-label="Class colour" value={draft} onValueChange={setDraft} disabled={saving}>
                                {ASSET_CLASS_COLOUR_PRESETS.map(preset => (
                                    <RadioGroup.Item className={styles.preset} key={preset.colour} value={preset.colour}
                                        onDoubleClick={event => {
                                            event.stopPropagation();
                                            if (saving || submitting.current) return;
                                            if (preset.colour === colour) setOpen(false);
                                            else void submit(preset.colour);
                                        }}
                                        aria-label={preset.name} title={preset.name} style={{ backgroundColor: preset.colour }}>
                                        <RadioGroup.Indicator className={styles.selectedMark}><Check size={16} strokeWidth={2.5} aria-hidden="true" /></RadioGroup.Indicator>
                                    </RadioGroup.Item>
                                ))}
                            </RadioGroup.Root>
                            {error && <p className={styles.error} role="alert">{error}</p>}
                            <div className={styles.editorActions}>
                                <button className={styles.reset} type="button" title="Restore default colour"
                                    disabled={!custom || saving} onClick={() => void submit('')}>
                                    <RotateCcw size={14} aria-hidden="true" /> Reset
                                </button>
                                <button className={styles.button} type="button" disabled={saving} onClick={() => setOpen(false)}>Cancel</button>
                                <button className={styles.save} type="submit" disabled={!selected || saving || draft === colour}>
                                    <Check size={14} aria-hidden="true" />{saving ? 'Saving...' : 'Save'}
                                </button>
                            </div>
                        </form>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
    );
}

function ClassColourRow({ assetClass }: { assetClass: AssetClass }) {
    return <div className={styles.row} data-class-colour={assetClass.code}>
        <div className={styles.name}>{assetClass.display_name}</div>
        <AssetClassColourControl assetClass={assetClass} />
    </div>;
}

export function AssetClassColourDialog({ open, onOpenChange, returnFocusRef }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
    const [classes, setClasses] = useState<AssetClass[]>([]);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(false);
    const [classError, setClassError] = useState('');
    const [reload, setReload] = useState(0);
    const error = useClassColours(state => state.error);
    const refreshing = useClassColours(state => state.refreshing);
    const saving = useClassColours(state => state.saving);
    const refresh = useClassColours(state => state.refresh);

    useEffect(() => {
        if (!open) return;
        let active = true;
        setSearch('');
        setLoading(true);
        setClassError('');
        void refresh();
        api.getAssetClasses().then(rows => {
            if (active) setClasses(rows.filter(row => row.active && row.allow_target_weight)
                .sort((a, b) => a.display_name.localeCompare(b.display_name)));
        }).catch(() => { if (active) setClassError('The asset class list could not be loaded.'); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [open, reload, refresh]);

    const filtered = classes.filter(row => `${row.display_name} ${row.code}`.toLowerCase().includes(search.toLowerCase().trim()));
    return (
        <Dialog.Root open={open} onOpenChange={next => { if (!saving) onOpenChange(next); }}>
            <Dialog.Portal>
                <Dialog.Overlay className={styles.overlay} />
                <Dialog.Content className={styles.dialog} aria-describedby={undefined}
                    onCloseAutoFocus={event => { event.preventDefault(); returnFocusRef.current?.focus(); }}>
                    <header className={styles.header}>
                        <Dialog.Title className={styles.title}>Asset class colours</Dialog.Title>
                        <Dialog.Close className={styles.close} disabled={saving} aria-label="Close asset class colours" title="Close">
                            <X size={20} aria-hidden="true" />
                        </Dialog.Close>
                    </header>
                    <div className={styles.search}>
                        <Search size={17} aria-hidden="true" />
                        <input aria-label="Find asset class" placeholder="Find asset class..." value={search}
                            onChange={event => setSearch(event.target.value)} />
                    </div>
                    {(classError || error) && <div className={styles.failure}>
                        <span role="alert">{classError || error}</span>
                        <button className={styles.button} disabled={loading || refreshing} onClick={() => setReload(count => count + 1)}>Retry</button>
                    </div>}
                    <div className={styles.list} aria-busy={loading}>
                        {loading ? <p className={styles.empty}>Loading asset classes...</p> : filtered.map(row => <ClassColourRow key={row.code} assetClass={row} />)}
                        {!loading && !classError && filtered.length === 0 && <p className={styles.empty}>{search ? 'No matching asset classes.' : 'No asset classes available.'}</p>}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
