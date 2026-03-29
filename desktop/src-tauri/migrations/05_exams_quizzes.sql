CREATE TABLE IF NOT EXISTS exams (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    config_json TEXT
);

CREATE TABLE IF NOT EXISTS exam_documents (
    exam_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    PRIMARY KEY(exam_id, document_id),
    FOREIGN KEY(exam_id) REFERENCES exams(id) ON DELETE CASCADE,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS saved_quizzes (
    id TEXT PRIMARY KEY,
    concept_id TEXT,
    exam_id TEXT,
    quiz_json TEXT NOT NULL,
    created_at INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER))
);