ALTER TABLE orders
  ADD COLUMN latitude double precision,
  ADD COLUMN longitude double precision,
  ADD CONSTRAINT orders_coordinate_pair CHECK ((latitude IS NULL) = (longitude IS NULL)),
  ADD CONSTRAINT orders_latitude_range CHECK (latitude BETWEEN -90 AND 90),
  ADD CONSTRAINT orders_longitude_range CHECK (longitude BETWEEN -180 AND 180);
