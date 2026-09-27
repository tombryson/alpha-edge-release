CREATE TABLE weight_policy (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    epoch INTEGER NOT NULL DEFAULT 0,
    changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO weight_policy (id) VALUES (1);

CREATE TABLE weight_observations (
    epoch INTEGER NOT NULL,
    subject TEXT NOT NULL,
    observed_date TEXT NOT NULL,
    statement_id INTEGER NOT NULL,
    qualifies INTEGER NOT NULL,
    evidence_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (epoch, subject, observed_date)
);
CREATE TABLE weight_action_evidence (
    action_id INTEGER PRIMARY KEY REFERENCES security_actions(id),
    epoch INTEGER NOT NULL,
    subject TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    closed_reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_weight_evidence_subject ON weight_action_evidence(epoch, subject, action_id);

CREATE TABLE weight_router_cache (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    scores_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL
);
