use enigo::{Enigo, Key, KeyboardControllable};
use lopdf::Document;
use serde_json::Value;
use std::path::Path;
use std::thread;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn read_file_content(file_path: String) -> Result<String, String> {
    std::fs::read_to_string(file_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_local_files(file_paths: Vec<String>) -> Result<(), String> {
    for path in file_paths {
        let p = std::path::Path::new(&path);
        if p.exists() {
            if p.is_file() {
                let _ = std::fs::remove_file(p);
            } else if p.is_dir() {
                let _ = std::fs::remove_dir_all(p);
            }
        }
        // If it's a video chunk, aggressively delete its parent _scenes dir to clean up cleanly
        if let Some(parent) = p.parent() {
            if parent.to_string_lossy().ends_with("_scenes") {
                let _ = std::fs::remove_dir_all(parent);
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn export_obsidian_vault(
    target_dir: String,
    concepts_json: String,
    edges_json: String,
) -> Result<String, String> {
    let concepts: Vec<Value> = serde_json::from_str(&concepts_json)
        .map_err(|e| format!("Failed to parse concepts: {}", e))?;
    let edges: Vec<Value> =
        serde_json::from_str(&edges_json).map_err(|e| format!("Failed to parse edges: {}", e))?;

    let vault_path = std::path::Path::new(&target_dir).join("TopoLearn_Vault");
    std::fs::create_dir_all(&vault_path).map_err(|e| e.to_string())?;

    for concept in &concepts {
        let label = concept["label"]
            .as_str()
            .unwrap_or("Untitled")
            .replace("/", "-")
            .replace("\\", "-")
            .replace(":", "-");
        let id = concept["id"].as_str().unwrap_or("");
        let definition = concept["definition"].as_str().unwrap_or("");
        let context = concept["context"].as_str().unwrap_or("");

        let mut prereqs = Vec::new();
        for edge in &edges {
            if edge["target"].as_str().unwrap_or("") == id {
                let source_id = edge["source"].as_str().unwrap_or("");
                if let Some(source_concept) = concepts
                    .iter()
                    .find(|c| c["id"].as_str().unwrap_or("") == source_id)
                {
                    prereqs.push(
                        source_concept["label"]
                            .as_str()
                            .unwrap_or("Untitled")
                            .replace("/", "-")
                            .replace("\\", "-")
                            .replace(":", "-"),
                    );
                }
            }
        }

        let mut md_content = format!(
            "---\ntags:\n  - topolearn/concept\naliases:\n  - \"{}\"\n---\n# {}\n\n## Definition\n{}\n\n",
            label.replace("\"", "\\\""), label, definition
        );
        if !prereqs.is_empty() {
            md_content.push_str("## Prerequisites\n");
            for p in prereqs {
                md_content.push_str(&format!("* [[{}]]\n", p));
            }
            md_content.push_str("\n");
        }
        if !context.is_empty() {
            md_content.push_str("## Source Context\n");
            md_content.push_str(&format!("> {}\n\n", context.replace("\n", "\n> ")));
        }

        let file_path = vault_path.join(format!("{}.md", label));
        if let Err(e) = std::fs::write(&file_path, md_content) {
            println!("Failed to write file {:?}: {}", file_path, e);
        }
    }

    Ok(vault_path.to_string_lossy().into_owned())
}

#[tauri::command]
fn get_pdf_metadata(file_path: String) -> Result<u32, String> {
    let doc = Document::load(&file_path).map_err(|e| e.to_string())?;
    Ok(doc.get_pages().len() as u32)
}

#[tauri::command]
fn generate_pdf_chunk(file_path: String, start_page: u32, end_page: u32) -> Result<String, String> {
    let path = Path::new(&file_path);
    let parent_dir = path.parent().unwrap_or(Path::new(""));
    let file_stem = path.file_stem().unwrap_or_default().to_string_lossy();
    let chunk_name = format!("{}_chunk_{}_{}.pdf", file_stem, start_page, end_page);
    let chunk_path = parent_dir.join(&chunk_name);

    if chunk_path.exists() {
        return Ok(chunk_path.to_string_lossy().into_owned());
    }

    let mut doc = Document::load(&path).map_err(|e| e.to_string())?;
    let pages = doc.get_pages();
    let mut page_numbers: Vec<u32> = pages.keys().copied().collect();
    page_numbers.sort_unstable();

    let mut pages_to_delete = Vec::new();
    for (idx, &page_num) in page_numbers.iter().enumerate() {
        let logical_page = (idx as u32) + 1;
        if logical_page < start_page || logical_page > end_page {
            pages_to_delete.push(page_num);
        }
    }

    doc.delete_pages(&pages_to_delete);
    doc.save(&chunk_path).map_err(|e| e.to_string())?;

    Ok(chunk_path.to_string_lossy().into_owned())
}

use regex::Regex;

use printpdf::{ImageTransform, Mm, PdfDocument};
use std::fs::File;
use std::io::BufWriter;

#[derive(serde::Serialize)]
struct VideoChunkData {
    chunk_type: String, // "audio" or "frames_pdf"
    file_path: String,  // Path to mp3 or pdf
    start_time: f64,
    end_time: f64,
    frame_timestamps: Option<String>, // JSON string of f64 array
}

#[tauri::command]
async fn process_video(file_path: String) -> Result<Vec<VideoChunkData>, String> {
    let path = Path::new(&file_path);
    let parent_dir = path.parent().unwrap_or(Path::new(""));
    let file_stem = path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .replace(" ", "_");

    let output_dir = parent_dir.join(format!("{}_scenes", file_stem));
    if !output_dir.exists() {
        std::fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;
    }

    // 1. Run Silence Detection
    let output = std::process::Command::new("ffmpeg")
        .arg("-i")
        .arg(&file_path)
        .arg("-af")
        .arg("silencedetect=noise=-30dB:d=2")
        .arg("-f")
        .arg("null")
        .arg("-")
        .output()
        .map_err(|e| e.to_string())?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut silence_intervals = Vec::new();

    let re_start = Regex::new(r"silence_start: ([\d\.]+)").unwrap();
    let re_end = Regex::new(r"silence_end: ([\d\.]+)").unwrap();

    let starts: Vec<f64> = re_start
        .captures_iter(&stderr)
        .filter_map(|cap| cap[1].parse().ok())
        .collect();
    let ends: Vec<f64> = re_end
        .captures_iter(&stderr)
        .filter_map(|cap| cap[1].parse().ok())
        .collect();

    for i in 0..std::cmp::min(starts.len(), ends.len()) {
        silence_intervals.push((starts[i], ends[i]));
    }

    let re_duration = Regex::new(r"Duration: (\d+):(\d+):([\d\.]+)").unwrap();
    let total_duration = if let Some(cap) = re_duration.captures(&stderr) {
        let h: f64 = cap[1].parse().unwrap_or(0.0);
        let m: f64 = cap[2].parse().unwrap_or(0.0);
        let s: f64 = cap[3].parse().unwrap_or(0.0);
        h * 3600.0 + m * 60.0 + s
    } else {
        3600.0 // Fallback
    };

    let mut chunks = Vec::new();
    let mut current_time = 0.0;
    let mut chunk_idx = 0;

    for (silence_start, silence_end) in silence_intervals {
        // Speech Segment (Audio)
        if silence_start > current_time + 1.0 {
            let audio_path = output_dir.join(format!("chunk_{:03}_speech.mp3", chunk_idx));
            std::process::Command::new("ffmpeg")
                .arg("-y")
                .arg("-ss")
                .arg(current_time.to_string())
                .arg("-to")
                .arg(silence_start.to_string())
                .arg("-i")
                .arg(&file_path)
                .arg("-vn")
                .arg("-acodec")
                .arg("libmp3lame")
                .arg("-q:a")
                .arg("5")
                .arg(&audio_path)
                .status()
                .ok();

            chunks.push(VideoChunkData {
                chunk_type: "audio".to_string(),
                file_path: audio_path.to_string_lossy().into_owned(),
                start_time: current_time,
                end_time: silence_start,
                frame_timestamps: None,
            });
            chunk_idx += 1;
        }

        // Silence Segment (Extract Significant Frames -> PDF)
        if silence_end > silence_start + 1.0 {
            let frames_pattern = output_dir.join(format!("chunk_{:03}_frame_%03d.jpg", chunk_idx));

            // Extract frames on significant changes AND force the first frame of the segment
            let select_expr = "eq(n,0)+gt(scene,0.03)";
            let output = std::process::Command::new("ffmpeg")
                .arg("-y")
                .arg("-ss")
                .arg(silence_start.to_string())
                .arg("-to")
                .arg(silence_end.to_string())
                .arg("-i")
                .arg(&file_path)
                .arg("-vf")
                .arg(format!("select='{}',showinfo", select_expr))
                .arg("-fps_mode")
                .arg("vfr")
                .arg(&frames_pattern)
                .output()
                .map_err(|e| e.to_string())?;

            let info_stderr = String::from_utf8_lossy(&output.stderr);
            let re_pts = Regex::new(r"pts_time:([\d\.]+)").unwrap();
            let mut timestamps = Vec::new();

            for cap in re_pts.captures_iter(&info_stderr) {
                if let Ok(pts) = cap[1].parse::<f64>() {
                    timestamps.push(silence_start + pts);
                }
            }
            if timestamps.is_empty() {
                timestamps.push(silence_start);
            }

            // Bundle Extracted Frames into PDF
            let pdf_path = output_dir.join(format!("chunk_{:03}_frames.pdf", chunk_idx));
            let (doc, page1, layer1) =
                PdfDocument::new("Slide Frames", Mm(297.0), Mm(210.0), "Layer 1");
            let mut is_first = true;

            for (i, _ts) in timestamps.iter().enumerate() {
                let img_path =
                    output_dir.join(format!("chunk_{:03}_frame_{:03}.jpg", chunk_idx, i + 1));
                if !img_path.exists() {
                    continue;
                }

                let (current_page, current_layer) = if is_first {
                    is_first = false;
                    (page1, layer1.clone())
                } else {
                    doc.add_page(Mm(297.0), Mm(210.0), "Layer 1")
                };

                if let Ok(img_file) = File::open(&img_path) {
                    let mut reader = std::io::BufReader::new(img_file);
                    if let Ok(decoder) = image::codecs::jpeg::JpegDecoder::new(&mut reader) {
                        if let Ok(img) = printpdf::Image::try_from(decoder) {
                            let layer = doc.get_page(current_page).get_layer(current_layer);
                            img.add_to_layer(
                                layer,
                                ImageTransform {
                                    translate_x: Some(Mm(10.0)),
                                    translate_y: Some(Mm(10.0)),
                                    scale_x: Some(0.23), // Scaled roughly to fit A4 Landscape
                                    scale_y: Some(0.23),
                                    ..Default::default()
                                },
                            );
                        }
                    }
                }
                // Cleanup individual JPEG after adding to PDF
                let _ = std::fs::remove_file(img_path);
            }

            if let Ok(f) = File::create(&pdf_path) {
                let _ = doc.save(&mut BufWriter::new(f));
            }

            chunks.push(VideoChunkData {
                chunk_type: "frames_pdf".to_string(),
                file_path: pdf_path.to_string_lossy().into_owned(),
                start_time: silence_start,
                end_time: silence_end,
                frame_timestamps: Some(serde_json::to_string(&timestamps).unwrap()),
            });
            chunk_idx += 1;
        }
        current_time = silence_end;
    }

    // Trailing speech
    if current_time < total_duration - 1.0 {
        let audio_path = output_dir.join(format!("chunk_{:03}_speech.mp3", chunk_idx));
        std::process::Command::new("ffmpeg")
            .arg("-y")
            .arg("-ss")
            .arg(current_time.to_string())
            .arg("-i")
            .arg(&file_path)
            .arg("-vn")
            .arg("-acodec")
            .arg("libmp3lame")
            .arg("-q:a")
            .arg("5")
            .arg(&audio_path)
            .status()
            .ok();

        chunks.push(VideoChunkData {
            chunk_type: "audio".to_string(),
            file_path: audio_path.to_string_lossy().into_owned(),
            start_time: current_time,
            end_time: total_duration,
            frame_timestamps: None,
        });
    }

    Ok(chunks)
}

#[tauri::command]
fn read_image_base64(file_path: String) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
    let data = std::fs::read(file_path).map_err(|e| e.to_string())?;
    Ok(general_purpose::STANDARD.encode(data))
}

#[tauri::command]
fn copy_file_to_clipboard(file_path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("powershell")
            .args([
                "-command",
                &format!("Set-Clipboard -LiteralPath '{}'", file_path),
            ])
            .output()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("osascript")
            .args([
                "-e",
                &format!("set the clipboard to POSIX file \"{}\"", file_path),
            ])
            .output()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        let uri = format!("file://{}", file_path);
        use std::io::Write;
        if let Ok(mut child) = std::process::Command::new("xclip")
            .args(["-selection", "clipboard", "-t", "text/uri-list"])
            .stdin(std::process::Stdio::piped())
            .spawn()
        {
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(uri.as_bytes());
            }
            let _ = child.wait();
        }
    }
    Ok(())
}

#[tauri::command]
fn focus_and_paste(app: tauri::AppHandle) -> Result<(), String> {
    // Find the window dynamically since the frontend appends a timestamp ID
    let windows = app.webview_windows();
    for (label, window) in windows {
        if label.starts_with("gemini-webview") {
            let _ = window.set_focus();
            break;
        }
    }

    // Give the window slightly more time to gain OS-level focus
    thread::sleep(Duration::from_millis(800));
    let mut enigo = Enigo::new();
    #[cfg(target_os = "macos")]
    {
        enigo.key_down(Key::Meta);
        enigo.key_click(Key::Layout('v'));
        enigo.key_up(Key::Meta);
    }
    #[cfg(not(target_os = "macos"))]
    {
        enigo.key_down(Key::Control);
        enigo.key_click(Key::Layout('v'));
        enigo.key_up(Key::Control);
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_initial_tables",
            sql: include_str!("../migrations/01_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_document_tracking",
            sql: include_str!("../migrations/02_documents.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add_concept_document_link",
            sql: include_str!("../migrations/03_concept_document.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add_concept_locations_and_lazy_chunks",
            sql: include_str!("../migrations/04_concept_location.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "add_exams_quizzes",
            sql: include_str!("../migrations/05_exams_quizzes.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "add_advanced_pipeline",
            sql: include_str!("../migrations/06_advanced_pipeline.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "add_video_timestamps",
            sql: include_str!("../migrations/07_video_timestamps.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "add_frame_timestamps",
            sql: include_str!("../migrations/08_frame_timestamps.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            SqlBuilder::default()
                .add_migrations("sqlite:topolearn.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            greet,
            get_pdf_metadata,
            generate_pdf_chunk,
            read_file_content,
            delete_local_files,
            export_obsidian_vault,
            process_video,
            read_image_base64,
            copy_file_to_clipboard,
            focus_and_paste
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
