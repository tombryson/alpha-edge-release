export type PositionGridColumnKey =
    | 'name'
    | 'classPercent'
    | 'modelWeight'
    | 'asset'
    | 'cdf'
    | 'atr'
    | 'dca'
    | 'price'
    | 'bookValue'
    | 'mktValue'
    | 'targetAdjustment'
    | 'targetMovePct'
    | 'reduction'
    | 'remaining'
    | 'expected'
    | 'imported'
    | 'variance'
    | 'reduce'
    | 'exposurePercent'
    | 'qty'
    | 'plDollar'
    | 'plPercent'
    | 'portfolioPercent'
    | 'currentReduction';

export type ResizableGridColumn<K extends string = string> = {
    key: K;
    widthPx: number;
    minWidthPx?: number;
    manualMinWidthPx?: number;
    maxWidthPx?: number;
    fillMaxWidthPx?: number;
    fillWeight?: number;
    manualMaxWidthPx?: number;
    growWeight?: number;
    resizable?: boolean;
};

export type PositionGridColumn = ResizableGridColumn<PositionGridColumnKey>;

export const defaultPositionVisibleColumns = {
    asset: false,
    price: false,
    bookValue: false,
    mktValue: true,
    targetAdjustment: true,
    targetAdjustmentPercent: true,
    cash: false,
    reduce: true,
    exposurePercent: false,
    qty: false,
    plDollar: false,
    plPercent: true,
    classPercent: true,
    modelWeight: true,
    portfolioPercent: true,
    trend: true,
    action: true,
    dca: true,
};

export type PositionVisibleColumns = typeof defaultPositionVisibleColumns;

export const defaultPortfolioVisibleColumns: PositionVisibleColumns = {
    ...defaultPositionVisibleColumns,
    modelWeight: false,
    asset: true,
    price: true,
    bookValue: true,
    cash: true,
    qty: true,
    plDollar: true,
};

export const defaultNormalPositionColumnOrder: PositionGridColumnKey[] = [
    'name',
    'cdf',
    'atr',
    'dca',
    'mktValue',
    'reduce',
    'plPercent',
    'classPercent',
    'modelWeight',
    'portfolioPercent',
    'asset',
    'price',
    'bookValue',
    'targetAdjustment',
    'targetMovePct',
    'reduction',
    'expected',
    'imported',
    'variance',
    'exposurePercent',
    'qty',
    'plDollar',
    'currentReduction',
];

export const defaultAnalysisVisibleColumns = {
    ticker: true,
    tags: true,
    assetClass: false,
    price: true,
    performance6m: true,
    performance12m: false,
    quality: true,
    value: true,
    gemini: false,
    perplexity: false,
    gpt: false,
    claude: false,
    council: true,
    tvPt: false,
    total: true,
    avgPt: true,
    upside: false,
    modelIncluded: true,
    suggestedAllocation: true,
    classPercent: false,
    signal: true,
    thesisDrift: true,
    chart: false,
    thesis: false,
    nextCatalyst: false,
};

export type AnalysisVisibleColumns = typeof defaultAnalysisVisibleColumns;

export type AnalysisGridColumnKey = 'name' | keyof AnalysisVisibleColumns;

export type AnalysisGridColumn = ResizableGridColumn<AnalysisGridColumnKey>;

export const POSITION_COLUMN_WIDTHS_STORAGE_KEY =
    'terminal-position-column-widths-v4';
export const LEGACY_POSITION_COLUMN_WIDTHS_STORAGE_KEY =
    'terminal-position-column-width-deltas-v3';
