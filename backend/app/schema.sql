CREATE TABLE IF NOT EXISTS account (
    id uuid PRIMARY KEY,
    consent_at timestamptz,
    usual_length smallint CHECK (usual_length BETWEEN 15 AND 90),
    irregular boolean NOT NULL DEFAULT false,
    revision bigint NOT NULL DEFAULT 0,
    prediction_revision bigint,
    prediction jsonb,
    deleting boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS cycle (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    start_date date NOT NULL,
    UNIQUE (account_id, start_date)
);

CREATE TABLE IF NOT EXISTS outbox (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('cycles.changed', 'account.deletion.requested')),
    queued_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz
);

CREATE INDEX IF NOT EXISTS outbox_unpublished ON outbox (queued_at) WHERE published_at IS NULL;
CREATE INDEX IF NOT EXISTS outbox_account ON outbox (account_id);
