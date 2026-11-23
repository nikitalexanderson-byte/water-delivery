-- Информация для конкретной доставки. Изменение карточки клиента её не затрагивает.
ALTER TABLE orders
  ADD COLUMN alt_phone text NOT NULL DEFAULT '' CHECK (
    length(alt_phone)<=24 AND (alt_phone='' OR (
      alt_phone ~ '^[+]?[0-9 ()-]+$' AND length(regexp_replace(alt_phone,'[^0-9]','','g')) BETWEEN 6 AND 15
    ))
  ),
  ADD COLUMN entrance text NOT NULL DEFAULT '' CHECK (length(entrance)<=40),
  ADD COLUMN unit text NOT NULL DEFAULT '' CHECK (length(unit)<=40),
  ADD COLUMN intercom text NOT NULL DEFAULT '' CHECK (length(intercom)<=80),
  ADD COLUMN access_instructions text NOT NULL DEFAULT '' CHECK (length(access_instructions)<=1000),
  ADD COLUMN paid_entry boolean NOT NULL DEFAULT false;
