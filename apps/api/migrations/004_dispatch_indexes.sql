CREATE INDEX shifts_by_day ON shifts(date,driver_id);
CREATE INDEX orders_by_trip ON orders(trip_id,position) WHERE trip_id IS NOT NULL;
CREATE INDEX inventory_by_trip ON inventory(trip_id);
