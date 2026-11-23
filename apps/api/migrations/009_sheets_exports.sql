-- A settled shift occupies one stable row in the integration worksheet.
CREATE TABLE sheet_exports (
  settlement_id integer PRIMARY KEY REFERENCES settlements(id),
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt timestamptz NOT NULL DEFAULT now(),
  lease uuid,
  sent_at timestamptz,
  last_error text
);
CREATE INDEX sheet_exports_pending ON sheet_exports(next_attempt) WHERE sent_at IS NULL;
