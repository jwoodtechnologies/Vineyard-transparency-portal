-- Vineyard Transparency Portal: full-text search shard (bindings SEARCH_DB_0, SEARCH_DB_1, ...).
-- Each shard holds the chunks of the documents assigned to it (documents.search_shard in the
-- catalog) plus a denormalized copy of the metadata needed for filtering inside the shard.
-- Idempotent.

CREATE TABLE IF NOT EXISTS shard_documents (
  document_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  document_type TEXT NOT NULL,
  document_number TEXT,
  document_date TEXT,
  year INTEGER,
  government_body_id TEXT,
  source_id TEXT NOT NULL,
  meeting_id TEXT,
  categories_json TEXT NOT NULL DEFAULT '[]',
  currency TEXT NOT NULL DEFAULT 'unknown',
  chunk_count INTEGER NOT NULL DEFAULT 0,
  indexed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shard_documents_date ON shard_documents(document_date);

-- Chunk text lives here once; the FTS5 index below is an external-content index over it,
-- so the text is not stored twice.
CREATE TABLE IF NOT EXISTS chunks (
  rowid INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  document_id TEXT NOT NULL,
  doc_title TEXT NOT NULL,
  page_start INTEGER,
  page_end INTEGER,
  section_title TEXT,
  text TEXT NOT NULL,
  character_count INTEGER NOT NULL,
  ocr INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id, page_start);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  doc_title,
  section_title,
  text,
  content = 'chunks',
  content_rowid = 'rowid',
  tokenize = 'porter unicode61 remove_diacritics 2'
);
