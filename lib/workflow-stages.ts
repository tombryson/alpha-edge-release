export type ReviewWorkflowStage = 'reduce' | 'confirm_cash' | 'complete';

export type PortfolioRebalanceWorkflowStage =
    | 'target'
    | 'reduce'
    | 'confirm_cash';

export const reviewWorkflowStageOrder: ReviewWorkflowStage[] = [
    'reduce',
    'confirm_cash',
    'complete',
];

export const portfolioRebalanceWorkflowStageOrder: PortfolioRebalanceWorkflowStage[] =
    ['target', 'reduce', 'confirm_cash'];

export function resolveActiveWorkflowStage<T extends string>(
    stageOrder: readonly T[],
    currentStage: T,
    selectedStage: T | null | undefined,
    terminalStage?: T,
): T {
    if (terminalStage && currentStage === terminalStage) return terminalStage;

    const currentIndex = stageOrder.indexOf(currentStage);
    const selectedIndex = selectedStage ? stageOrder.indexOf(selectedStage) : -1;
    if (selectedStage && selectedIndex >= 0 && selectedIndex <= currentIndex) {
        return selectedStage;
    }
    return currentStage;
}

export function canSelectWorkflowStage<T extends string>(
    stageOrder: readonly T[],
    candidateStage: T,
    activeStage: T,
    currentStage: T,
    terminalStage?: T,
): boolean {
    if (terminalStage && currentStage === terminalStage) {
        return candidateStage === terminalStage;
    }
    return stageOrder.indexOf(candidateStage) <= stageOrder.indexOf(activeStage);
}
