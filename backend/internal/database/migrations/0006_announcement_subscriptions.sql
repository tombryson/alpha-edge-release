CREATE TABLE security_announcement_subscriptions (
    security_id INTEGER PRIMARY KEY REFERENCES security_identities(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('HOTCOPPER', 'SEEKING_ALPHA')),
    exchange_prefix TEXT NOT NULL,
    ticker TEXT NOT NULL,
    confirmed_at TEXT,
    updated_at TEXT NOT NULL
);
