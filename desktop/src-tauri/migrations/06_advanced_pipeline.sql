ALTER TABLE documents ADD COLUMN extracted_text TEXT DEFAULT '';
ALTER TABLE chunks ADD COLUMN chunk_type TEXT DEFAULT 'pdf';
ALTER TABLE chunks ADD COLUMN extracted_text TEXT DEFAULT '';