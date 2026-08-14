-- A recurring event expands to one instance per occurrence, and every instance
-- carries the same uid. Keyed on uid alone, a weekly meeting collapsed into a
-- single row: 61 events fetched, 55 stored.
--
-- Safe to truncate: this table is a cache of a feed that is re-fetched on the
-- next sync, so nothing here is a source of truth.
TRUNCATE TABLE "CalendarEventCache";

ALTER TABLE "CalendarEventCache" DROP CONSTRAINT "CalendarEventCache_pkey";
ALTER TABLE "CalendarEventCache" ADD CONSTRAINT "CalendarEventCache_pkey" PRIMARY KEY ("uid", "start");
