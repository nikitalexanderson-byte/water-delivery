ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK(status IN ('pending','assigned','delivered','cancelled','failed'));
-- Find the membership constraint by its referenced columns, independent of the generated name.
DO $$
DECLARE membership text;
BEGIN
  SELECT conname INTO STRICT membership FROM pg_constraint
    WHERE conrelid='orders'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%trip_id%' AND pg_get_constraintdef(oid) LIKE '%status%';
  EXECUTE format('ALTER TABLE orders DROP CONSTRAINT %I',membership);
END $$;
ALTER TABLE orders ADD CONSTRAINT orders_trip_membership CHECK((status IN ('assigned','delivered','failed'))=(trip_id IS NOT NULL));
ALTER TABLE orders ADD COLUMN failure_reason text NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN origin text NOT NULL DEFAULT 'office' CHECK(origin IN ('office','on_site'));
ALTER TABLE orders ADD COLUMN source_order_id int REFERENCES orders;
ALTER TABLE orders ADD COLUMN rescheduled_to int UNIQUE REFERENCES orders;
