CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    file_path TEXT NOT NULL,
    created_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER))
);

CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    status INTEGER DEFAULT 0, -- 0 = pending, 1 = processed
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);