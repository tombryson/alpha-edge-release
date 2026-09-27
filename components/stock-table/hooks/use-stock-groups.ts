import { useState, useEffect, useMemo, useCallback, type Dispatch, type SetStateAction } from 'react';
import { type Stock } from '@/lib/store';
import { api, type StockGroup, type AssetClass } from '@/lib/api';
import { normalizeAssetClassCode } from '@/lib/asset-class';
import { formatAssetClassName, getAssignableAssetClasses } from '@/lib/asset-classes';
import {
    type TabType,
    type PortfolioMode,
    type PositionsMode,
    type AdjustmentSource,
    type StockGroupAssignments,
} from '@/components/stock-table/types';

export interface UseStockGroupsParams {
    assetClasses: AssetClass[];
    activeTab: TabType;
    portfolioMode: PortfolioMode;
    positionsMode: PositionsMode;
    activeAdjustmentSource: AdjustmentSource;
    stocks: Stock[];
    setAssetClasses: Dispatch<SetStateAction<AssetClass[]>>;
    setPositionStatsTransitionSuppressed: Dispatch<SetStateAction<boolean>>;
}

export function useStockGroups({
    assetClasses,
    activeTab,
    portfolioMode,
    positionsMode,
    activeAdjustmentSource,
    stocks,
    setAssetClasses,
    setPositionStatsTransitionSuppressed,
}: UseStockGroupsParams) {
    const [groups, setGroups] = useState<StockGroup[]>([]);
    const [stockGroupAssignments, setStockGroupAssignments] =
        useState<StockGroupAssignments>({});
    const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
    const [portfolioCollapsedGroupIds, setPortfolioCollapsedGroupIds] =
        useState<Set<string>>(new Set());
    const [showGroupManager, setShowGroupManager] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    const [newCustomGroupQuartile, setNewCustomGroupQuartile] =
        useState('Q1_EXEMPT');
    const [creatingCustomGroup, setCreatingCustomGroup] = useState(false);
    const [deletingCustomClassCode, setDeletingCustomClassCode] = useState<
        string | null
    >(null);
    const [groupManagerError, setGroupManagerError] = useState<string | null>(
        null,
    );
    const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
    const [editingGroupName, setEditingGroupName] = useState('');
    const [groupNameSuggestionTarget, setGroupNameSuggestionTarget] =
        useState<string | null>(null);
    const [groupingEnabled, setGroupingEnabled] = useState(true);
    const [collapsedRegimeGroups, setCollapsedRegimeGroups] = useState<
        Set<string>
    >(new Set());
    const [flattenGroups, setFlattenGroups] = useState(false);
    const [drilldownGroupId, setDrilldownGroupId] = useState<string | null>(
        null,
    );

    // ── Load groups from backend (localStorage fallback) ──────────────────────

    useEffect(() => {
        const loadGroups = async () => {
            try {
                const response = await api.getStockGroups();

                if (
                    response &&
                    response.groups &&
                    Array.isArray(response.groups) &&
                    response.groups.length > 0
                ) {
                    setGroups(response.groups);

                    const assignmentsRecord: StockGroupAssignments = {};
                    if (
                        response.assignments &&
                        Array.isArray(response.assignments)
                    ) {
                        response.assignments.forEach((assignment) => {
                            assignmentsRecord[assignment.company_name] =
                                assignment.group_id;
                        });
                    }
                    setStockGroupAssignments(assignmentsRecord);

                    localStorage.setItem(
                        'terminal-stock-groups',
                        JSON.stringify(response.groups),
                    );
                    localStorage.setItem(
                        'terminal-stock-group-assignments',
                        JSON.stringify(assignmentsRecord),
                    );
                } else {
                    setGroups([]);
                    setStockGroupAssignments({});
                    localStorage.removeItem('terminal-stock-groups');
                    localStorage.removeItem(
                        'terminal-stock-group-assignments',
                    );
                }
            } catch (error) {
                console.error(
                    '[ALPHA EDGE] Failed to load groups from backend:',
                    error,
                );
                setGroups([]);
                setStockGroupAssignments({});
            }
        };

        loadGroups();
    }, []);

    // ── Auto-collapse portfolio groups when entering workflow view ────────────

    useEffect(() => {
        const portfolioWorkflowVisible =
            (activeTab === 'PORTFOLIO' && portfolioMode === 'workflow') ||
            (activeTab === 'POSITIONS' &&
                positionsMode === 'review' &&
                activeAdjustmentSource === 'portfolio_target');
        if (!portfolioWorkflowVisible) return;
        const parentGroupIds = new Set(
            groups
                .map((group) => group.parent_id)
                .filter((parentId): parentId is string =>
                    Boolean(parentId),
                ),
        );
        setPortfolioCollapsedGroupIds(
            new Set(
                groups
                    .filter((group) => !parentGroupIds.has(group.id))
                    .map((group) => group.id),
            ),
        );
    }, [activeAdjustmentSource, activeTab, groups, portfolioMode, positionsMode]);

    // ── Name resolution helpers ───────────────────────────────────────────────

    const canonicalGroupNameOptions = useMemo(() => {
        const configured = getAssignableAssetClasses(assetClasses)
            .map((sleeve) => ({
                code: normalizeAssetClassCode(sleeve.code),
                name: formatAssetClassName(sleeve),
            }))
            .filter((option) => option.code);

        const seen = new Set<string>();
        return configured.filter((option) => {
            if (!option.code || seen.has(option.code)) return false;
            seen.add(option.code);
            return true;
        });
    }, [assetClasses]);

    const customGroupAssetClasses = useMemo(
        () =>
            getAssignableAssetClasses(assetClasses)
                .filter(
                    (sleeve) =>
                        String(sleeve.class_type || '').toUpperCase() ===
                        'CUSTOM',
                )
                .sort((a, b) =>
                    formatAssetClassName(a).localeCompare(
                        formatAssetClassName(b),
                    ),
                ),
        [assetClasses],
    );

    const getGroupNameSuggestions = useCallback(
        (value: string) => {
            const query = value.trim().toLowerCase();
            if (!query) return canonicalGroupNameOptions;
            return canonicalGroupNameOptions.filter(
                (option) =>
                    option.name.toLowerCase().includes(query) ||
                    option.code.toLowerCase().includes(query),
            );
        },
        [canonicalGroupNameOptions],
    );

    const canonicaliseGroupName = useCallback(
        (value: string) => {
            const trimmed = value.trim();
            if (!trimmed) return '';
            const code = normalizeAssetClassCode(trimmed);
            const matchingOption = canonicalGroupNameOptions.find(
                (option) =>
                    option.code === code ||
                    normalizeAssetClassCode(option.name) === code,
            );
            return matchingOption?.name || '';
        },
        [canonicalGroupNameOptions],
    );

    const resolveGroupAssetClassCodeFromName = useCallback(
        (value: string): string | null => {
            const code = normalizeAssetClassCode(value);
            const matchingOption = canonicalGroupNameOptions.find(
                (option) =>
                    option.code === code ||
                    normalizeAssetClassCode(option.name) === code,
            );
            return matchingOption?.code || null;
        },
        [canonicalGroupNameOptions],
    );

    const groupNameIdentity = useCallback(
        (value: string, assetClassCode?: string | null) => {
            const explicitCode = normalizeAssetClassCode(assetClassCode);
            if (explicitCode && explicitCode !== 'UNASSIGNED') {
                return `asset:${explicitCode}`;
            }
            const inferredCode = resolveGroupAssetClassCodeFromName(value);
            if (inferredCode) return `asset:${inferredCode}`;
            const canonical = canonicaliseGroupName(value);
            return `name:${(canonical || value.trim()).toLowerCase()}`;
        },
        [canonicaliseGroupName, resolveGroupAssetClassCodeFromName],
    );

    // ── Backend persistence ───────────────────────────────────────────────────

    const saveGroupsToBackend = useCallback(
        async (
            newGroups: StockGroup[],
            newAssignments: StockGroupAssignments,
            extraAssetClassCodes: Set<string> = new Set(),
        ): Promise<{
            groups: StockGroup[];
            assignments: StockGroupAssignments;
        }> => {
            const parentGroupIds = new Set(
                newGroups
                    .map((group) => group.parent_id)
                    .filter((parentId): parentId is string => Boolean(parentId)),
            );
            const canonicalGroups = newGroups
                .map((group, index): StockGroup | null => {
                    const isDisplayParent = parentGroupIds.has(group.id);
                    const name = group.name.trim();
                    if (!name) return null;
                    if (isDisplayParent) {
                        return {
                            ...group,
                            name,
                            asset_class_code: null,
                            order: group.order ?? index,
                        };
                    }

                    const explicitAssetClassCode = normalizeAssetClassCode(
                        group.asset_class_code,
                    );
                    const assetClassCode =
                        (extraAssetClassCodes.has(explicitAssetClassCode)
                            ? explicitAssetClassCode
                            : null) ||
                        resolveGroupAssetClassCodeFromName(
                            group.asset_class_code || group.name,
                        );
                    if (!assetClassCode) return null;
                    return {
                        ...group,
                        name,
                        asset_class_code: assetClassCode,
                        order: group.order ?? index,
                    };
                })
                .filter((group): group is StockGroup => group !== null);

            const validGroupIds = new Set(canonicalGroups.map((group) => group.id));
            const canonicalAssignments = Object.fromEntries(
                Object.entries(newAssignments).filter(([, groupId]) =>
                    validGroupIds.has(groupId),
                ),
            );

            const assignmentsArray = Object.entries(canonicalAssignments).map(
                ([companyName, groupId]) => ({
                    company_name: companyName,
                    group_id: groupId,
                }),
            );

            try {
                await api.saveStockGroups(canonicalGroups, assignmentsArray);
                if (typeof window !== 'undefined') {
                    localStorage.setItem(
                        'terminal-stock-groups',
                        JSON.stringify(canonicalGroups),
                    );
                    localStorage.setItem(
                        'terminal-stock-group-assignments',
                        JSON.stringify(canonicalAssignments),
                    );
                }
                return {
                    groups: canonicalGroups,
                    assignments: canonicalAssignments,
                };
            } catch (error) {
                console.warn('[ALPHA EDGE] Backend sync failed:', error);
                throw error;
            }
        },
        [resolveGroupAssetClassCodeFromName],
    );

    // ── CRUD operations ───────────────────────────────────────────────────────

    const createGroup = useCallback(async () => {
        const name = canonicaliseGroupName(newGroupName);
        if (!name) return;
        const assetClassCode = resolveGroupAssetClassCodeFromName(newGroupName);
        if (!assetClassCode) return;
        const identity = groupNameIdentity(name, assetClassCode);
        if (
            groups.some(
                (group) =>
                    groupNameIdentity(group.name, group.asset_class_code) ===
                    identity,
            )
        ) {
            setNewGroupName(name);
            setGroupNameSuggestionTarget(null);
            return;
        }

        const newGroup: StockGroup = {
            id: `group-${Date.now()}`,
            name,
            asset_class_code: assetClassCode,
            collapsed: false,
            order: groups.length,
            parent_id: null,
        };

        const updatedGroups = [...groups, newGroup];
        const saved = await saveGroupsToBackend(updatedGroups, stockGroupAssignments);
        setGroups(saved.groups);
        setStockGroupAssignments(saved.assignments);
        setNewGroupName('');
        setGroupNameSuggestionTarget(null);
    }, [
        canonicaliseGroupName,
        resolveGroupAssetClassCodeFromName,
        groupNameIdentity,
        groups,
        newGroupName,
        saveGroupsToBackend,
        stockGroupAssignments,
    ]);

    const createCustomGroup = useCallback(async () => {
        const displayName = newGroupName.trim();
        if (!displayName || resolveGroupAssetClassCodeFromName(displayName)) {
            return;
        }

        try {
            setCreatingCustomGroup(true);
            setGroupManagerError(null);
            const created = await api.createCustomAssetClass({
                display_name: displayName,
                quartile: newCustomGroupQuartile,
                instrument_scope: 'FUND',
            });
            const sleeves = await api.getAssetClasses();
            setAssetClasses(Array.isArray(sleeves) ? sleeves : []);

            const name = formatAssetClassName(created);
            const assetClassCode = normalizeAssetClassCode(created.code);
            const identity = `asset:${assetClassCode}`;
            if (
                groups.some(
                    (group) =>
                        groupNameIdentity(group.name, group.asset_class_code) ===
                        identity,
                )
            ) {
                setNewGroupName('');
                setGroupNameSuggestionTarget(null);
                return;
            }

            const newGroup: StockGroup = {
                id: `group-${Date.now()}`,
                name,
                asset_class_code: assetClassCode,
                collapsed: false,
                order: groups.length,
                parent_id: null,
            };
            const saved = await saveGroupsToBackend(
                [...groups, newGroup],
                stockGroupAssignments,
                new Set([normalizeAssetClassCode(assetClassCode)]),
            );
            setGroups(saved.groups);
            setStockGroupAssignments(saved.assignments);
            setNewGroupName('');
            setGroupNameSuggestionTarget(null);
        } catch (error) {
            setGroupManagerError(
                error instanceof Error
                    ? error.message
                    : 'Failed to create custom asset class',
            );
        } finally {
            setCreatingCustomGroup(false);
        }
    }, [
        newGroupName,
        newCustomGroupQuartile,
        resolveGroupAssetClassCodeFromName,
        groupNameIdentity,
        groups,
        saveGroupsToBackend,
        setAssetClasses,
        stockGroupAssignments,
    ]);

    const deleteCustomAssetClass = useCallback(
        async (code: string) => {
            if (!code || deletingCustomClassCode) return;

            try {
                setDeletingCustomClassCode(code);
                setGroupManagerError(null);
                await api.deleteCustomAssetClass(code);
                const sleeves = await api.getAssetClasses();
                setAssetClasses(Array.isArray(sleeves) ? sleeves : []);
            } catch (error) {
                setGroupManagerError(
                    error instanceof Error
                        ? error.message.trim()
                        : 'Failed to delete custom asset class',
                );
            } finally {
                setDeletingCustomClassCode(null);
            }
        },
        [deletingCustomClassCode, setAssetClasses],
    );

    const renameGroup = useCallback(
        async (groupId: string, newName: string) => {
            const name = newName.trim();
            if (!name) return;
            const existingGroup = groups.find((group) => group.id === groupId);
            if (!existingGroup) return;
            const identity = groupNameIdentity(name, existingGroup.asset_class_code);
            if (
                groups.some(
                    (group) =>
                        group.id !== groupId &&
                        groupNameIdentity(group.name, group.asset_class_code) ===
                            identity,
                )
            ) {
                setEditingGroupName(name);
                setGroupNameSuggestionTarget(null);
                return;
            }
            const updatedGroups = groups.map((g) =>
                g.id === groupId ? { ...g, name } : g,
            );
            const saved = await saveGroupsToBackend(
                updatedGroups,
                stockGroupAssignments,
            );
            setGroups(saved.groups);
            setStockGroupAssignments(saved.assignments);
            setEditingGroupId(null);
            setEditingGroupName('');
            setGroupNameSuggestionTarget(null);
        },
        [groupNameIdentity, groups, saveGroupsToBackend, stockGroupAssignments],
    );

    const deleteGroup = useCallback(
        async (groupId: string) => {
            const updatedGroups = groups.filter((g) => g.id !== groupId);
            const updatedAssignments = Object.fromEntries(
                Object.entries(stockGroupAssignments).filter(
                    ([, gId]) => gId !== groupId,
                ),
            );
            const saved = await saveGroupsToBackend(
                updatedGroups,
                updatedAssignments,
            );
            setGroups(saved.groups);
            setStockGroupAssignments(saved.assignments);
        },
        [groups, saveGroupsToBackend, stockGroupAssignments],
    );

    const assignStockToGroup = useCallback(
        async (stockId: number, groupId: string | null) => {
            const stock = stocks.find((s) => s.id === stockId);
            if (!stock) {
                console.error('[ASSIGN STOCK] Stock not found with ID:', stockId);
                return;
            }

            const updatedAssignments = { ...stockGroupAssignments };
            if (groupId === null) {
                delete updatedAssignments[stock.name];
            } else {
                const targetGroup = groups.find((group) => group.id === groupId);
                const targetHasChildren = groups.some(
                    (group) => group.parent_id === groupId,
                );
                if (
                    !targetGroup ||
                    targetHasChildren ||
                    !resolveGroupAssetClassCodeFromName(
                        targetGroup.asset_class_code || targetGroup.name,
                    )
                ) {
                    return;
                }
                updatedAssignments[stock.name] = groupId;
            }
            const saved = await saveGroupsToBackend(groups, updatedAssignments);
            setGroups(saved.groups);
            setStockGroupAssignments(saved.assignments);
        },
        [
            groups,
            resolveGroupAssetClassCodeFromName,
            saveGroupsToBackend,
            stockGroupAssignments,
            stocks,
        ],
    );

    const toggleGroupCollapsed = useCallback(
        (groupId: string, options: { persist?: boolean } = {}) => {
            const updatedGroups = groups.map((g) =>
                g.id === groupId ? { ...g, collapsed: !g.collapsed } : g,
            );
            setGroups(updatedGroups);
            if (options.persist !== false) {
                saveGroupsToBackend(updatedGroups, stockGroupAssignments);
            }
        },
        [groups, saveGroupsToBackend, stockGroupAssignments],
    );

    const togglePortfolioGroupCollapsed = useCallback((groupId: string) => {
        setPortfolioCollapsedGroupIds((prev) => {
            const next = new Set(prev);
            if (next.has(groupId)) next.delete(groupId);
            else next.add(groupId);
            return next;
        });
    }, []);

    const toggleAllPositionGroupsCollapsed = useCallback((visibleGroupIds?: ReadonlySet<string>) => {
        setPositionStatsTransitionSuppressed(true);
        if (activeTab === 'PORTFOLIO') {
            const allCollapsed = groups.every((g) =>
                portfolioCollapsedGroupIds.has(g.id),
            );
            setPortfolioCollapsedGroupIds(
                allCollapsed ? new Set() : new Set(groups.map((g) => g.id)),
            );
            return;
        }

        const visibleGroups = visibleGroupIds ? groups.filter(g => visibleGroupIds.has(g.id)) : groups;
        if (visibleGroups.length === 0) return;
        const allCollapsed = visibleGroups.every((g) => g.collapsed);
        const updatedGroups = groups.map((g) => ({
            ...g,
            collapsed: !visibleGroupIds || visibleGroupIds.has(g.id) ? !allCollapsed : g.collapsed,
        }));
        setGroups(updatedGroups);
        saveGroupsToBackend(updatedGroups, stockGroupAssignments);
    }, [
        activeTab,
        groups,
        portfolioCollapsedGroupIds,
        saveGroupsToBackend,
        setPositionStatsTransitionSuppressed,
        stockGroupAssignments,
    ]);

    const reorderGroup = useCallback(
        (draggedGroupId: string, targetGroupId: string, insertBefore: boolean) => {
            const draggedGroup = groups.find((g) => g.id === draggedGroupId);
            const targetGroup = groups.find((g) => g.id === targetGroupId);

            if (!draggedGroup || !targetGroup) {
                return;
            }
            if (draggedGroupId === targetGroupId) {
                return;
            }

            const draggedParent = draggedGroup.parent_id || null;
            const targetParent = targetGroup.parent_id || null;

            if (draggedParent !== targetParent) {
                return;
            }

            const siblings = groups
                .filter((g) => (g.parent_id || null) === draggedParent)
                .sort((a, b) => a.order - b.order);

            const draggedIndex = siblings.findIndex((g) => g.id === draggedGroupId);
            const targetIndex = siblings.findIndex((g) => g.id === targetGroupId);

            if (draggedIndex === -1 || targetIndex === -1) {
                return;
            }

            const newSiblings = siblings.filter((g) => g.id !== draggedGroupId);

            let insertIndex = newSiblings.findIndex((g) => g.id === targetGroupId);
            if (!insertBefore) {
                insertIndex++;
            }

            newSiblings.splice(insertIndex, 0, draggedGroup);

            const updatedGroups = groups.map((g) => {
                const newSiblingIndex = newSiblings.findIndex((s) => s.id === g.id);
                if (
                    newSiblingIndex !== -1 &&
                    (g.parent_id || null) === draggedParent
                ) {
                    return { ...g, order: newSiblingIndex };
                }
                return g;
            });

            setGroups(updatedGroups);
            saveGroupsToBackend(updatedGroups, stockGroupAssignments);
        },
        [groups, saveGroupsToBackend, stockGroupAssignments],
    );

    const convertToTopLevel = useCallback(
        (groupId: string) => {
            const group = groups.find((g) => g.id === groupId);
            if (!group || !group.parent_id) return;

            const topLevelGroups = groups.filter((g) => !g.parent_id);
            const maxOrder = Math.max(...topLevelGroups.map((g) => g.order), -1);

            const updatedGroups = groups.map((g) =>
                g.id === groupId
                    ? { ...g, parent_id: null, order: maxOrder + 1 }
                    : g,
            );

            setGroups(updatedGroups);
            saveGroupsToBackend(updatedGroups, stockGroupAssignments);
        },
        [groups, saveGroupsToBackend, stockGroupAssignments],
    );

    const nestGroupAsSubgroup = useCallback(
        (draggedGroupId: string, targetGroupId: string) => {
            const draggedGroup = groups.find((g) => g.id === draggedGroupId);
            const targetGroup = groups.find((g) => g.id === targetGroupId);

            if (!draggedGroup || !targetGroup) {
                return;
            }
            if (draggedGroupId === targetGroupId) {
                return;
            }

            let checkGroup = targetGroup;
            while (checkGroup.parent_id) {
                if (checkGroup.parent_id === draggedGroupId) {
                    return;
                }
                checkGroup =
                    groups.find((g) => g.id === checkGroup.parent_id) || checkGroup;
                if (!checkGroup.parent_id) break;
            }

            const existingChildren = groups.filter(
                (g) => g.parent_id === targetGroupId,
            );
            const maxChildOrder = Math.max(
                ...existingChildren.map((g) => g.order),
                -1,
            );

            const updatedGroups = groups.map((g) =>
                g.id === draggedGroupId
                    ? { ...g, parent_id: targetGroupId, order: maxChildOrder + 1 }
                    : g,
            );

            setGroups(updatedGroups);
            saveGroupsToBackend(updatedGroups, stockGroupAssignments);
        },
        [groups, saveGroupsToBackend, stockGroupAssignments],
    );

    const isDescendantOf = useCallback(
        (groupId: string | null | undefined, potentialAncestorId: string): boolean => {
            if (!groupId) return false;
            if (groupId === potentialAncestorId) return true;
            const group = groups.find((g) => g.id === groupId);
            if (!group) return false;
            return isDescendantOf(group.parent_id, potentialAncestorId);
        },
        [groups],
    );

    const moveGroupToParent = useCallback(
        (groupId: string, newParentId: string | null) => {
            if (
                newParentId &&
                (groupId === newParentId || isDescendantOf(newParentId, groupId))
            ) {
                return;
            }

            const updatedGroups = groups.map((g) =>
                g.id === groupId ? { ...g, parent_id: newParentId } : g,
            );
            setGroups(updatedGroups);
            saveGroupsToBackend(updatedGroups, stockGroupAssignments);
        },
        [groups, isDescendantOf, saveGroupsToBackend, stockGroupAssignments],
    );

    return {
        // State
        groups,
        setGroups,
        stockGroupAssignments,
        setStockGroupAssignments,
        draggedGroupId,
        setDraggedGroupId,
        portfolioCollapsedGroupIds,
        setPortfolioCollapsedGroupIds,
        showGroupManager,
        setShowGroupManager,
        newGroupName,
        setNewGroupName,
        newCustomGroupQuartile,
        setNewCustomGroupQuartile,
        creatingCustomGroup,
        deletingCustomClassCode,
        groupManagerError,
        setGroupManagerError,
        editingGroupId,
        setEditingGroupId,
        editingGroupName,
        setEditingGroupName,
        groupNameSuggestionTarget,
        setGroupNameSuggestionTarget,
        groupingEnabled,
        setGroupingEnabled,
        collapsedRegimeGroups,
        setCollapsedRegimeGroups,
        flattenGroups,
        setFlattenGroups,
        drilldownGroupId,
        setDrilldownGroupId,
        // Derived
        canonicalGroupNameOptions,
        customGroupAssetClasses,
        // Callbacks
        getGroupNameSuggestions,
        canonicaliseGroupName,
        resolveGroupAssetClassCodeFromName,
        groupNameIdentity,
        saveGroupsToBackend,
        createGroup,
        createCustomGroup,
        deleteCustomAssetClass,
        renameGroup,
        deleteGroup,
        assignStockToGroup,
        toggleGroupCollapsed,
        togglePortfolioGroupCollapsed,
        toggleAllPositionGroupsCollapsed,
        reorderGroup,
        convertToTopLevel,
        nestGroupAsSubgroup,
        isDescendantOf,
        moveGroupToParent,
    };
}
