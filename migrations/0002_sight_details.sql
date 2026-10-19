-- Sightseeing details for targets. visit_at is an optional local date-time like 2026-11-14T10:30.
ALTER TABLE targets ADD COLUMN directions TEXT NOT NULL DEFAULT '';
ALTER TABLE targets ADD COLUMN tickets    TEXT NOT NULL DEFAULT '';
ALTER TABLE targets ADD COLUMN hours      TEXT NOT NULL DEFAULT '';
ALTER TABLE targets ADD COLUMN visit_at   TEXT;
