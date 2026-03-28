// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

use lopdf::Document;
use std::path::Path;

#[tauri::command]
async fn split_pdf(file_path: String) -> Result<Vec<String>, String> {
    println!("Processing file from path: {}", file_path);
    let path = Path::new(&file_path);
    let parent_dir = path.parent().unwrap_or(Path::new(""));
    let file_stem = path.file_stem().unwrap_or_default().to_string_lossy();

    let doc_result = Document::load(&path);
    let doc = match doc_result {
        Ok(d) => d,
        Err(e) => return Err(format!("Failed to load PDF: {}", e)),
    };

    let pages = doc.get_pages();
    let mut page_numbers: Vec<u32> = pages.keys().copied().collect();
    page_numbers.sort_unstable(); // Ensure pages are in order

    let chunk_size = 10;
    let mut chunks = Vec::new();
    let mut chunk_idx = 1;

    for chunk in page_numbers.chunks(chunk_size) {
        let mut chunk_doc = doc.clone();
        let mut pages_to_delete = Vec::new();

        // Identify pages to delete (all pages NOT in the current chunk)
        for &page_num in &page_numbers {
            if !chunk.contains(&page_num) {
                pages_to_delete.push(page_num);
            }
        }

        chunk_doc.delete_pages(&pages_to_delete);

        let chunk_name = format!("{}_chunk_{}.pdf", file_stem, chunk_idx);
        let chunk_path = parent_dir.join(&chunk_name);

        if let Err(e) = chunk_doc.save(&chunk_path) {
            return Err(format!("Failed to save chunk: {}", e));
        }

        chunks.push(chunk_path.to_string_lossy().into_owned());
        chunk_idx += 1;
    }

    Ok(chunks)
}

use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "create_initial_tables",
        sql: include_str!("../migrations/01_init.sql"),
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            SqlBuilder::default()
                .add_migrations("sqlite:topolearn.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![greet, split_pdf])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
