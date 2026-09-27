type EmbedCallbacks = {
    title: string;
    onLoad?: () => void;
    onError?: () => void;
};

// Run the provider in its own document so unmounting cancels pending scripts
// and removes its message listeners, rather than leaving a detached DOM target.
export function mountTradingViewEmbed(
    host: HTMLElement,
    settings: Record<string, unknown>,
    { title, onLoad, onError }: EmbedCallbacks,
): () => void {
    const frame = document.createElement('iframe');
    frame.title = title;
    frame.style.cssText = 'display:block;width:100%;height:100%;border:0';
    let failed = false;
    const receiveError = (event: MessageEvent) => {
        if (event.source !== frame.contentWindow || event.data?.type !== 'alpha-edge:chart-load-error') return;
        failed = true;
        onError?.();
    };
    window.addEventListener('message', receiveError);
    frame.onload = () => { if (!failed) onLoad?.(); };
    const config = JSON.stringify(settings).replace(/</g, '\\u003c');
    frame.srcdoc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
html,body,.tradingview-widget-container,.tradingview-widget-container__widget{margin:0;width:100%;height:100%;overflow:hidden}
iframe{display:block;width:100%;height:100%;border:0}
</style></head><body><div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div>
<script src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js" async
onerror="parent.postMessage({type:'alpha-edge:chart-load-error'}, '*')">${config}</script>
</div></body></html>`;
    host.replaceChildren(frame);
    return () => {
        window.removeEventListener('message', receiveError);
        frame.onload = null;
        frame.remove();
    };
}
