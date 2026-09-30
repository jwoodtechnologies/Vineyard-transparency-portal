# Search

Primary retrieval is **SQLite FTS5 in D1** plus metadata filters. No `LIKE '%q%'` scans.

## Index

Each search shard (`vtp-search-N`) holds:

* `chunks`: chunk id (`doc_…:c00012`), document id, page start/end, section title, text, OCR flag.
* `chunks_fts`: FTS5 **external-content** index over `chunks(doc_title, section_title, text)`,
  tokenizer `porter unicode61 remove_diacritics 2`. Text is stored once.
* `shard_documents`: denormalized filter metadata (type, date, year, body, source, meeting, currency).

Ranking: `bm25(chunks_fts, 10, 4, 1)` (title, section, body), a bonus for an exact document-number
match, and a small boost for several matching chunks in one document. `snippet()` produces excerpts;
its markers are converted to `[start, end)` highlight offsets.

## Query handling (`worker/search/query.ts`)

Every term and phrase is emitted as an FTS5 string literal, so FTS operators, column filters and
parentheses typed by users are plain words (tested in `tests/worker-search-query.test.ts`).
`match=all|any|phrase`, `title=1` (title only), quoted phrases, `term*` prefixes, and hyphenated
numbers ("2026-07") are supported. Document numbers, years and document types are detected and
reported in `interpretation` without silently filtering.

Results are documents (not chunks), up to three excerpts each from distinct pages, with the page,
highlights, match explanation, source id, and whether an archived file exists. Facets are computed
over the candidate set (top 400 chunks); `totalIsEstimate` is set when the true count is larger.

## Sharding

D1 Free allows 500 MB per database and 5 GB per account. Extracted text for 20,000+ documents will
exceed one database, so `SearchRepository` supports `SEARCH_DB_0 … SEARCH_DB_7`.

* A document's shard is chosen once, at first indexing: `writeShards[fnv1a(documentId) % writeShards.length]`,
  and recorded in `catalog.documents.search_shard`. Reads always use the recorded shard.
* Queries fan out to all `SEARCH_SHARDS` in parallel and are merged by score.
* To add a shard: create `vtp-search-1` (D1 dashboard), add the binding to `wrangler.jsonc`, set
  `SEARCH_SHARDS=0,1` and `SEARCH_WRITE_SHARDS=1` (stop writing to a full shard), deploy, run `migrate`.
* Start: one shard. Add the next when shard 0 reaches about 400 MB (D1 dashboard > vtp-search-0 > size).

## Semantic search

`SemanticSearchProvider` exists and is disabled. Vectorize is intentionally not used in this phase
(chunk-level vectors for this corpus do not fit the zero-cost constraint). A future provider can be
fused with FTS results by reciprocal rank fusion without API changes.
