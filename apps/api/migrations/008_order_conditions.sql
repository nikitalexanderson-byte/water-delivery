ALTER TABLE orders
  ADD COLUMN parking_minutes integer NOT NULL DEFAULT 0 CHECK (parking_minutes BETWEEN 0 AND 120),
  ADD COLUMN has_cart boolean NOT NULL DEFAULT false,
  ADD COLUMN can_deliver_today boolean NOT NULL DEFAULT false,
  ADD COLUMN early_delivery_date date,
  ADD CHECK (can_deliver_today = (early_delivery_date IS NOT NULL));

CREATE INDEX orders_early_delivery_idx ON orders (early_delivery_date, date, id)
  WHERE can_deliver_today AND status='pending' AND origin='office';
