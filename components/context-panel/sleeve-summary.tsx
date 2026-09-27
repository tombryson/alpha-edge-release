'use client';

import { useEffect, useState } from 'react';
import { CircleDotDashed, List, Minus, PanelBottom, PieChart, Plus } from 'lucide-react';
import { PortfolioGroupDial } from '@/components/portfolio-group-dial';
import { usePanelData } from './panel-data';
import styles from './sleeve-summary.module.css';

export function SleeveSummary({ positionShapeWidgetVisible = false, onTogglePositionShapeWidget }: {
    positionShapeWidgetVisible?: boolean;
    onTogglePositionShapeWidget?: () => void;
}) {
    const { current: portfolioMix, approved: approvedPortfolioMix, loading, errors } = usePanelData();
    const [preferredMode, setWidgetMode] = useState<'shape' | 'compare'>('shape');
    const hasApproved = Boolean(approvedPortfolioMix?.snapshot?.approved_at && approvedPortfolioMix.rows?.length);
    const widgetMode = hasApproved ? preferredMode : 'shape';
    const currentStale = Boolean(portfolioMix?.as_of && Date.now() - new Date(portfolioMix.as_of).getTime() > 7 * 86400000);
    const currentAvailable = Boolean(portfolioMix) && !errors.current && !currentStale;
    const [widgetCollapsed, setWidgetCollapsed] = useState(false);
    const [widgetLegendVisible, setWidgetLegendVisible] = useState(true);
    const [isClient, setIsClient] = useState(false);
    useEffect(() => { setIsClient(true); }, []);
    return (
      <section className={styles.summary} data-testid="sleeve-summary" aria-label="Portfolio summary">
        <div className={styles.header}>
          <h2 className={styles.title}>Portfolio summary</h2>
          <button
            type="button"
            onClick={() => setWidgetCollapsed((value) => !value)}
            className={styles.control}
            title={widgetCollapsed ? 'Expand widget' : 'Minimise widget'}
            aria-label={widgetCollapsed ? 'Expand widget' : 'Minimise widget'}
            aria-expanded={!widgetCollapsed}
          >
            {widgetCollapsed ? <Plus /> : <Minus />}
          </button>
        </div>
        {!widgetCollapsed && (
          <>
            <div className={styles.toolbar}>
                <div className={styles.modes} role="group" aria-label="Summary view">
                  {(['shape', 'compare'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setWidgetMode(mode)}
                      className={styles.control}
                      aria-pressed={widgetMode === mode}
                      disabled={mode === 'compare' && !hasApproved}
                      title={
                        mode === 'shape'
                          ? 'Show current portfolio shape'
                          : 'Compare with current allocation'
                      }
                      aria-label={
                        mode === 'shape'
                          ? 'Show current portfolio shape'
                          : 'Compare with current allocation'
                      }
                    >
                      {mode === 'shape' ? (
                        <PieChart />
                      ) : (
                        <CircleDotDashed />
                      )}
                    </button>
                  ))}
                </div>
                <div className={styles.options} role="group" aria-label="Summary options">
                {onTogglePositionShapeWidget && (
                  <button
                    type="button"
                    onClick={onTogglePositionShapeWidget}
                    className={styles.control}
                    title={positionShapeWidgetVisible ? 'Hide Positions shape strip' : 'Show Positions shape strip'}
                    aria-label={positionShapeWidgetVisible ? 'Hide Positions shape strip' : 'Show Positions shape strip'}
                    aria-pressed={positionShapeWidgetVisible}
                  >
                    <PanelBottom />
                  </button>
                )}
                  <button
                    type="button"
                    onClick={() => setWidgetLegendVisible((visible) => !visible)}
                    className={styles.control}
                    title={widgetLegendVisible ? 'Hide summary list' : 'Show summary list'}
                    aria-label={widgetLegendVisible ? 'Hide summary list' : 'Show summary list'}
                    aria-pressed={widgetLegendVisible}
                  >
                    <List />
                  </button>
                </div>
            </div>
            <div className={styles.body}>
            {isClient && !loading && hasApproved && <div className={styles.reference} role="status">
                <span>Approved v{approvedPortfolioMix!.snapshot!.id} · {new Date(approvedPortfolioMix!.snapshot!.approved_at!).toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                {errors.approved && <span>Approval refresh unavailable</span>}
                {widgetMode === 'compare' && !currentAvailable && <span>{currentStale ? 'Holdings out of date' : 'Current holdings unavailable'}</span>}
            </div>}
            {isClient && hasApproved && (
              <PortfolioGroupDial
                currentRows={widgetMode === 'compare' && currentAvailable ? portfolioMix?.rows || [] : []}
                approvedRows={approvedPortfolioMix?.rows || []}
                showLegend={widgetLegendVisible}
                compareHoldings={widgetMode === 'compare'}
              />
            )}

            {isClient && !hasApproved && (
              <div className="flex min-h-0 items-center justify-center py-6 text-center text-[10px] text-muted-foreground">
                {loading ? 'Loading portfolio shape...' : errors.approved ? 'Approved shape unavailable' : 'No approved shape'}
              </div>
            )}
            </div>
          </>
        )}
      </section>
    );
}
