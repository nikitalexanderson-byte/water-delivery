CREATE TABLE trip_locations (
  trip_id integer PRIMARY KEY REFERENCES trips ON DELETE CASCADE,
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon double precision NOT NULL CHECK (lon BETWEEN -180 AND 180),
  accuracy double precision NOT NULL CHECK (accuracy BETWEEN 0 AND 10000),
  bearing double precision CHECK (bearing >= 0 AND bearing < 360),
  observed_at timestamptz NOT NULL
);
