DELETE FROM sync_changes;
DELETE FROM sync_history;
DELETE FROM decisions;
DELETE FROM alerts;
DELETE FROM active_alerts;
DELETE FROM security_positions;
DELETE FROM etf_executions;
DELETE FROM etf_rebalance_targets;
DELETE FROM etf_allocations;
DELETE FROM overlay_stage1_sources;
DELETE FROM overlay_event_classes;
DELETE FROM overlay_events;
DELETE FROM overlay_stage1_state_classes;
DELETE FROM overlay_stage1_state;
DELETE FROM q4_crisis_state;
DELETE FROM equity_sizing_history;
DELETE FROM equity_sizing;
DELETE FROM regimes;
DELETE FROM portfolio_mix_snapshot_rows;
DELETE FROM portfolio_mix_snapshots;
DELETE FROM portfolio_rebalance_plan_rows;
DELETE FROM portfolio_rebalance_plans;
DELETE FROM stock_group_assignments;
DELETE FROM stock_groups;
DELETE FROM stock_analysis;
DELETE FROM holdings;
DELETE FROM statement_holdings;
DELETE FROM account_statements;
DELETE FROM company_mappings;

INSERT INTO overlay_signal_state (
  id,
  current_q1_exposure_pct,
  last_applied_q1_exposure_pct,
  spy_q1_exposure_pct,
  xao_q1_exposure_pct,
  governing_source,
  last_signal_changed_at,
  last_applied_at,
  updated_at
) VALUES (
  1,
  100,
  100,
  100,
  100,
  'SPY',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT(id) DO UPDATE SET
  current_q1_exposure_pct = 100,
  last_applied_q1_exposure_pct = 100,
  spy_q1_exposure_pct = 100,
  xao_q1_exposure_pct = 100,
  governing_source = 'SPY',
  last_signal_changed_at = CURRENT_TIMESTAMP,
  last_applied_at = CURRENT_TIMESTAMP,
  updated_at = CURRENT_TIMESTAMP;
