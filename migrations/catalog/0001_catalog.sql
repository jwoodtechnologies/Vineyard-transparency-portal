-- Vineyard Transparency Portal: catalog database (binding CATALOG_DB, name vtp-catalog).
-- Metadata, provenance, crawl state, meetings and relationships. No binaries, no full text.
-- Every statement is idempotent so the migration can be re-applied safely.

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  source_type TEXT NOT NULL,
  authority TEXT NOT NULL,
  discovered_from TEXT,
  crawl_enabled INTEGER NOT NULL DEFAULT 1,
  archive_enabled INTEGER NOT NULL DEFAULT 1,
  document_discovery_enabled INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  notes TEXT NOT NULL DEFAULT '',
  last_checked_at TEXT,
  last_success_at TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  status_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS government_bodies (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  short_name TEXT,
  kind TEXT NOT NULL DEFAULT 'other',
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  government_body_id TEXT,
  government_body_name TEXT,
  meeting_type TEXT NOT NULL DEFAULT 'other',
  meeting_date TEXT,
  start_time TEXT,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  agenda_document_id TEXT,
  packet_document_id TEXT,
  minutes_document_id TEXT,
  minutes_status TEXT NOT NULL DEFAULT 'not_available',
  source_id TEXT NOT NULL,
  source_url TEXT,
  external_id TEXT,
  media_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meetings_date ON meetings(meeting_date);
CREATE INDEX IF NOT EXISTS idx_meetings_body ON meetings(government_body_id, meeting_date);

CREATE TABLE IF NOT EXISTS agenda_items (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  parent_id TEXT,
  number TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  description TEXT,
  item_type TEXT NOT NULL DEFAULT 'other',
  sort INTEGER NOT NULL DEFAULT 0,
  packet_page_start INTEGER,
  packet_page_end INTEGER
);
CREATE INDEX IF NOT EXISTS idx_agenda_items_meeting ON agenda_items(meeting_id, sort);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  document_type TEXT NOT NULL DEFAULT 'other',
  document_number TEXT,
  document_date TEXT,
  year INTEGER,
  government_body_id TEXT,
  government_body_name TEXT,
  meeting_id TEXT,
  agenda_item_id TEXT,
  source_id TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  original_filename TEXT NOT NULL DEFAULT '',
  file_size INTEGER,
  page_count INTEGER,
  sha256 TEXT,
  original_url TEXT,
  canonical_key TEXT,
  archive_key TEXT,
  -- archived | not_archived | quota_deferred | remote_only_large_file | remote_only_media | failed
  archive_status TEXT NOT NULL DEFAULT 'not_archived',
  -- extracted | empty | unsupported | failed | pending
  text_status TEXT NOT NULL DEFAULT 'pending',
  -- not_required | needed | complete | failed
  ocr_status TEXT NOT NULL DEFAULT 'not_required',
  ocr_confidence REAL,
  categories_json TEXT NOT NULL DEFAULT '[]',
  tags_json TEXT NOT NULL DEFAULT '[]',
  currency TEXT NOT NULL DEFAULT 'unknown',
  current_version INTEGER NOT NULL DEFAULT 1,
  search_shard INTEGER,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  character_count INTEGER NOT NULL DEFAULT 0,
  original_available INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_documents_sha ON documents(sha256);
CREATE INDEX IF NOT EXISTS idx_documents_date ON documents(document_date);
CREATE INDEX IF NOT EXISTS idx_documents_type_year ON documents(document_type, year);
CREATE INDEX IF NOT EXISTS idx_documents_meeting ON documents(meeting_id);
CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source_id);
CREATE INDEX IF NOT EXISTS idx_documents_canonical ON documents(canonical_key);

CREATE TABLE IF NOT EXISTS document_sources (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  parent_url TEXT,
  link_text TEXT,
  retrieved_at TEXT NOT NULL,
  last_verified_at TEXT,
  etag TEXT,
  last_modified TEXT,
  http_status INTEGER,
  original_available INTEGER,
  UNIQUE(document_id, canonical_key)
);
CREATE INDEX IF NOT EXISTS idx_document_sources_key ON document_sources(canonical_key);

CREATE TABLE IF NOT EXISTS document_versions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  previous_sha256 TEXT,
  source_url TEXT NOT NULL,
  file_size INTEGER,
  page_count INTEGER,
  retrieved_at TEXT NOT NULL,
  archive_key TEXT,
  change_status TEXT NOT NULL DEFAULT 'original',
  note TEXT,
  UNIQUE(document_id, version_number)
);

-- relationship_type uses the portal's internal vocabulary:
-- MEETING_HAS_AGENDA, MEETING_HAS_MINUTES, MEETING_HAS_PACKET, AGENDA_ITEM_HAS_ATTACHMENT,
-- RESOLUTION_CONSIDERED_AT, ORDINANCE_CONSIDERED_AT, DOCUMENT_RELATED_TO, DOCUMENT_SUPERSEDES,
-- DOCUMENT_VERSION_OF. The API maps these to the frontend RelationshipType union.
CREATE TABLE IF NOT EXISTS document_relationships (
  id TEXT PRIMARY KEY,
  from_document_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  to_kind TEXT NOT NULL,
  to_id TEXT NOT NULL,
  to_title TEXT NOT NULL DEFAULT '',
  basis TEXT NOT NULL DEFAULT 'source_structure',
  evidence_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(from_document_id, relationship_type, to_kind, to_id)
);
CREATE INDEX IF NOT EXISTS idx_relationships_to ON document_relationships(to_kind, to_id);

CREATE TABLE IF NOT EXISTS crawl_runs (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL DEFAULT 'manual',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  sources_json TEXT NOT NULL DEFAULT '[]',
  discovered INTEGER NOT NULL DEFAULT 0,
  fetched INTEGER NOT NULL DEFAULT 0,
  ingested INTEGER NOT NULL DEFAULT 0,
  unchanged INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  bytes_archived INTEGER NOT NULL DEFAULT 0,
  last_processed_url TEXT,
  message TEXT
);

CREATE TABLE IF NOT EXISTS crawl_queue (
  url_key TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  url TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'document',
  -- pending | done | unchanged | error | skipped | deferred
  status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 100,
  parent_url TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  document_id TEXT,
  etag TEXT,
  last_modified TEXT,
  sha256 TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  next_attempt_at TEXT,
  last_error TEXT,
  run_id TEXT,
  discovered_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_queue_status ON crawl_queue(status, priority, discovered_at);

CREATE TABLE IF NOT EXISTS ingestion_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT,
  source_id TEXT,
  url TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  http_status INTEGER,
  error_type TEXT NOT NULL,
  message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  resolved INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_errors_url ON ingestion_errors(url, resolved);

CREATE TABLE IF NOT EXISTS archive_stats (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  stored_bytes INTEGER NOT NULL DEFAULT 0,
  stored_objects INTEGER NOT NULL DEFAULT 0,
  deferred_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO archive_stats (id, stored_bytes, stored_objects, deferred_count, updated_at)
VALUES (1, 0, 0, 0, '1970-01-01T00:00:00Z');

-- Application-side free-tier accounting per UTC day.
CREATE TABLE IF NOT EXISTS quota_usage (
  day TEXT PRIMARY KEY,
  d1_rows_written INTEGER NOT NULL DEFAULT 0,
  r2_bytes_uploaded INTEGER NOT NULL DEFAULT 0,
  r2_class_a_ops INTEGER NOT NULL DEFAULT 0,
  ai_requests INTEGER NOT NULL DEFAULT 0,
  ai_failures INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- Reader issue reports. Only the submitted fields are stored (no IP, no user agent).
CREATE TABLE IF NOT EXISTS issue_reports (
  id TEXT PRIMARY KEY,
  issue_type TEXT NOT NULL,
  description TEXT NOT NULL,
  context_json TEXT NOT NULL,
  received_at TEXT NOT NULL
);
