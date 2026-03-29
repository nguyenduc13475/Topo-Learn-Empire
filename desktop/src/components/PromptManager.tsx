import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { ask, message, open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import Database from "@tauri-apps/plugin-sql";
import { useEffect, useState } from "react";

interface Doc {
  id: string;
  title: string;
  file_path: string;
}

interface Chunk {
  id: string;
  document_id: string;
  chunk_index: number;
  file_path: string;
  chunk_type: string; // 'pdf', 'audio', 'frames_pdf'
  extracted_text: string;
  status: number; // 0 = pending text, 1 = text extracted, 2 = graph extracted
  page_start?: number;
  page_end?: number;
  video_start?: number;
  video_end?: number;
  frame_timestamps?: string; // JSON string array of f64
}
export default function PromptManager() {
  const [processMode, setProcessMode] = useState<"pdf" | "video">("pdf");
  const [filePath, setFilePath] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  // Database States
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [chunksMap, setChunksMap] = useState<Record<string, Chunk[]>>({});
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);

  // New State for Inline Chunk JSON Ingestion
  const [chunkJsonInput, setChunkJsonInput] = useState<Record<string, string>>({});
  const [imagePreviews, setImagePreviews] = useState<Record<string, string>>({});

  const loadData = async () => {
    try {
      const db = await Database.load("sqlite:topolearn.db");
      const docs = await db.select<Doc[]>("SELECT * FROM documents ORDER BY created_at DESC");
      setDocuments(docs);

      const allChunks = await db.select<Chunk[]>("SELECT * FROM chunks ORDER BY chunk_index ASC");
      const map: Record<string, Chunk[]> = {};
      allChunks.forEach((c) => {
        if (!map[c.document_id]) map[c.document_id] = [];
        map[c.document_id].push(c);
      });
      setChunksMap(map);
    } catch (error) {
      console.error("Failed to load documents from DB", error);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (expandedDoc) {
      const docChunks = chunksMap[expandedDoc] || [];
      docChunks.forEach((chunk) => {
        if (chunk.file_path.endsWith(".jpg") && !imagePreviews[chunk.id]) {
          invoke<string>("read_image_base64", { filePath: chunk.file_path })
            .then((base64) => {
              setImagePreviews((prev) => ({
                ...prev,
                [chunk.id]: `data:image/jpeg;base64,${base64}`,
              }));
            })
            .catch(console.error);
        }
      });
    }
  }, [expandedDoc, chunksMap]);

  const handleSelectFile = async () => {
    const selected = await openDialog({
      multiple: false,
      filters:
        processMode === "pdf"
          ? [{ name: "Documents", extensions: ["pdf", "pptx"] }]
          : [{ name: "Video Files", extensions: ["mp4", "mkv", "avi"] }],
    });
    if (selected && typeof selected === "string") {
      setFilePath(selected);
    }
  };

  const handleProcessDocument = async () => {
    if (!filePath) return;
    setIsProcessing(true);
    try {
      const db = await Database.load("sqlite:topolearn.db");
      const docId = crypto.randomUUID();
      const title = filePath.split(/[/\\]/).pop() || "Unknown Document";

      await db.execute("INSERT INTO documents (id, title, file_path) VALUES ($1, $2, $3)", [
        docId,
        title,
        filePath,
      ]);

      if (processMode === "pdf") {
        let totalPages = 1;
        const isPdf = filePath.toLowerCase().endsWith(".pdf");
        const isPptx = filePath.toLowerCase().endsWith(".pptx");

        if (isPdf) {
          totalPages = await invoke<number>("get_pdf_metadata", { filePath });
        }

        const chunkSize = 10;
        const totalChunks = Math.ceil(totalPages / chunkSize);

        for (let i = 0; i < totalChunks; i++) {
          const chunkId = crypto.randomUUID();
          const startPage = isPdf ? i * chunkSize + 1 : 1;
          const endPage = isPdf ? Math.min((i + 1) * chunkSize, totalPages) : 1;
          const cType = isPptx ? "pptx" : "pdf";
          await db.execute(
            "INSERT INTO chunks (id, document_id, chunk_index, file_path, chunk_type, status, page_start, page_end) VALUES ($1, $2, $3, $4, $5, 0, $6, $7)",
            [chunkId, docId, i + 1, filePath, cType, startPage, endPage],
          );
        }
      } else {
        let generatedChunks: any[] = [];
        try {
          generatedChunks = await invoke("process_video", { filePath });
        } catch (err) {
          alert("Video processing failed: " + err + "\n\nPlease ensure you have FFmpeg installed.");
          setIsProcessing(false);
          return;
        }

        for (let i = 0; i < generatedChunks.length; i++) {
          const chunkId = crypto.randomUUID();
          await db.execute(
            "INSERT INTO chunks (id, document_id, chunk_index, file_path, chunk_type, status, video_start, video_end, frame_timestamps) VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8)",
            [
              chunkId,
              docId,
              i + 1,
              generatedChunks[i].file_path,
              generatedChunks[i].chunk_type,
              generatedChunks[i].start_time,
              generatedChunks[i].end_time,
              generatedChunks[i].frame_timestamps || null,
            ],
          );
        }
      }

      setFilePath("");
      await loadData();
      setExpandedDoc(docId);
    } catch (error) {
      console.error("Failed to process document:", error);
      alert(`Error processing file: ${error}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleChunkStatus = async (chunkId: string, currentStatus: number) => {
    try {
      const db = await Database.load("sqlite:topolearn.db");
      const newStatus = currentStatus === 1 ? 0 : 1;
      await db.execute("UPDATE chunks SET status = $1 WHERE id = $2", [newStatus, chunkId]);
      await loadData();
    } catch (error) {
      console.error("Failed to update chunk status", error);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const getPromptForChunk = (chunk: Chunk) => {
    if (chunk.chunk_type === "pdf") {
      return `Please convert the attached PDF document into strict Markdown text. Ensure you explicitly mark the start of every new page with "==== PAGE <number> ====" (e.g., ==== PAGE 14 ====). Maintain all headings, bullet points, and core text.`;
    } else if (chunk.chunk_type === "pptx") {
      return `Please convert the attached PPTX presentation into strict Markdown text. Ensure you explicitly mark the start of every new slide with "==== PAGE <number> ====" (e.g., ==== PAGE 3 ====). Maintain all headings, bullet points, and core text.`;
    } else if (chunk.chunk_type === "audio") {
      return `Please transcribe this audio exactly. Format as Markdown. CRITICAL: MARK "==== TIMESTAMP <mm:ss> ====" at several key locations (e.g., every 1-2 minutes) in the speech so I can easily jump to the relevant video segment later.`;
    } else if (chunk.chunk_type === "frames_pdf") {
      return `Please describe the visual information in this PDF (which represents sequential slide frames from a video segment) in detail. Format as Markdown. Ensure you capture all bullet points, charts, and text. CRITICAL: Explicitly mark the start of every new page description with "==== PAGE <number> ====" (e.g., ==== PAGE 1 ====).`;
    }
    return "";
  };

  const handleSaveTextPhase = async (chunk: Chunk, text: string) => {
    let finalText = text;
    // Auto-inject precise timestamps replacing generic PAGE markers
    if (chunk.chunk_type === "frames_pdf" && chunk.frame_timestamps) {
      try {
        const timestamps: number[] = JSON.parse(chunk.frame_timestamps);
        finalText = finalText.replace(/==== PAGE (\d+) ====/gi, (match, p1) => {
          const pageNum = parseInt(p1, 10);
          if (pageNum >= 1 && pageNum <= timestamps.length) {
            const ts = timestamps[pageNum - 1];
            const mm = Math.floor(ts / 60)
              .toString()
              .padStart(2, "0");
            const ss = Math.floor(ts % 60)
              .toString()
              .padStart(2, "0");
            return `==== TIMESTAMP ${mm}:${ss} ====`;
          }
          return match;
        });
      } catch (e) {
        console.error("Failed to parse frame timestamps");
      }
    }

    try {
      const db = await Database.load("sqlite:topolearn.db");
      await db.execute("UPDATE chunks SET extracted_text = $1, status = 1 WHERE id = $2", [
        finalText,
        chunk.id,
      ]);
      await loadData();
    } catch (e) {
      alert("Failed to save text.");
    }
  };

  const handleBuildGraphFromText = async (doc: Doc) => {
    const docChunks = chunksMap[doc.id] || [];
    const fullText = docChunks
      .sort((a, b) => a.chunk_index - b.chunk_index)
      .map((c) => {
        let marker = "";
        if (c.chunk_type === "pdf") {
          marker = `\n\n==== PAGES ${c.page_start} TO ${c.page_end} ====\n\n`;
        } else if (
          c.chunk_type === "audio" ||
          c.chunk_type === "frames" ||
          c.chunk_type === "frames_pdf"
        ) {
          marker = `\n\n==== TIMESTAMP ${c.video_start?.toFixed(2)} TO ${c.video_end?.toFixed(2)} ====\n\n`;
        }
        return marker + c.extracted_text;
      })
      .join("\n\n---\n\n");

    const db = await Database.load("sqlite:topolearn.db");
    await db.execute("UPDATE documents SET extracted_text = $1 WHERE id = $2", [fullText, doc.id]);

    const graphPrompt = `Please analyze the following full document text. Extract the core concepts, their definitions, the exact context quote, and their foundational prerequisites.
CRITICAL INSTRUCTIONS:
- For node "id", use a descriptive snake_case string (e.g., "neural_networks").
- LOCATION: Determine the page number (by looking for "==== PAGE X ====") OR the exact video timestamp in seconds (by looking for "==== TIMESTAMP <mm:ss> ====") and output it as EITHER "page_num": <int> OR "video_timestamp": <float>. DO NOT use strings for these fields. Convert any mm:ss timestamp to total seconds.
- Format STRICTLY as JSON without markdown code blocks:
{
  "nodes": [{ "id": "snake_case_id", "type": "concept", "data": { "label": "Name", "definition": "Rich markdown...", "context": "Exact quote...", "page_num": 10, "video_timestamp": 120.5 } }],
  "edges": [{ "id": "source-target", "source": "prereq_id", "target": "concept_id" }]
}

DOCUMENT TEXT:
${fullText}`;

    try {
      await emit("open-gemini");
      // Wait for Gemini webview to open
      await new Promise((r) => setTimeout(r, 2000));
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(graphPrompt);
      await invoke("focus_and_paste");

      alert(
        "🚀 Auto-pasted the Graph Generation prompt into Gemini! Once Gemini finishes, copy the JSON, go to the '2. Knowledge Graph' tab, select this document, and click 'Magic Paste & Render'.",
      );
    } catch (err) {
      copyToClipboard(graphPrompt);
      alert(
        "Full Document Text & Prompt copied to clipboard! Paste into Gemini to get the full Knowledge Graph JSON, then go to the Graph Tab to paste the result.",
      );
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-y-auto p-4 space-y-6 pb-20">
      {/* 1. File Processor Block */}
      <div className="bg-white p-4 rounded shadow-sm border border-gray-200">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-lg font-bold text-gray-800">1. Local File Processing</h2>
          <div className="flex bg-gray-100 rounded-lg p-1 shadow-inner">
            <button
              onClick={() => {
                setProcessMode("pdf");
                setFilePath("");
              }}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${processMode === "pdf" ? "bg-white text-blue-700 shadow" : "text-gray-500 hover:text-gray-700"}`}
            >
              📄 PDF
            </button>
            <button
              onClick={() => {
                setProcessMode("video");
                setFilePath("");
              }}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${processMode === "video" ? "bg-white text-blue-700 shadow" : "text-gray-500 hover:text-gray-700"}`}
            >
              🎥 Video
            </button>
          </div>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          {processMode === "pdf"
            ? "Select a PDF file. The Rust backend will split it into manageable 10-page chunks for AI context limits."
            : "Select a Video lecture. The system will extract scenes and run Whisper transcription (Simulated in MVP)."}
        </p>
        <div className="flex gap-2">
          <button
            onClick={handleSelectFile}
            className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium py-2 px-4 rounded transition-colors"
          >
            Browse...
          </button>
          <input
            type="text"
            readOnly
            className="flex-1 p-2 border border-gray-300 rounded outline-none bg-gray-50 text-gray-500"
            placeholder="No file selected..."
            value={filePath}
          />
          <button
            onClick={handleProcessDocument}
            disabled={!filePath || isProcessing}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium py-2 px-4 rounded transition-colors min-w-32"
          >
            {isProcessing ? "Processing..." : processMode === "pdf" ? "Split PDF" : "Process Video"}
          </button>
        </div>
      </div>

      {/* 2. Document Progress Library */}
      <div className="bg-white p-4 rounded shadow-sm border border-gray-200">
        <h2 className="text-lg font-bold text-gray-800 mb-4">
          2. Document Library (Progress Tracker)
        </h2>
        {documents.length === 0 ? (
          <p className="text-sm text-gray-500 italic text-center py-6">
            No documents processed yet. Split a PDF to begin tracking.
          </p>
        ) : (
          <div className="space-y-3">
            {documents.map((doc) => {
              const docChunks = chunksMap[doc.id] || [];
              const completed = docChunks.filter((c) => c.status === 1).length;
              const isExpanded = expandedDoc === doc.id;
              const isAllDone = completed === docChunks.length && docChunks.length > 0;

              return (
                <div
                  key={doc.id}
                  className={`border rounded-lg overflow-hidden transition-colors ${isAllDone ? "border-green-200" : "border-gray-200"}`}
                >
                  {/* Accordion Header */}
                  <div
                    className={`p-3 flex justify-between items-center transition-colors ${isAllDone ? "bg-green-50 hover:bg-green-100" : "bg-gray-50 hover:bg-gray-100"}`}
                  >
                    <div
                      className="flex-1 cursor-pointer"
                      onClick={() => setExpandedDoc(isExpanded ? null : doc.id)}
                    >
                      <h3
                        className={`font-bold text-sm ${isAllDone ? "text-green-800" : "text-gray-800"}`}
                      >
                        {doc.title} {isAllDone && "✅"}
                      </h3>
                      <p
                        className={`text-xs mt-0.5 font-medium ${isAllDone ? "text-green-600" : "text-gray-500"}`}
                      >
                        Extraction Progress: {completed} / {docChunks.length} chunks
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          const confirmed = await ask(
                            `Delete "${doc.title}" and clean up its local file chunks?`,
                            { kind: "warning" },
                          );
                          if (confirmed) {
                            try {
                              const db = await Database.load("sqlite:topolearn.db");
                              // Protect the original user PDF from being deleted!
                              const filesToDelete = docChunks
                                .filter((c) => c.file_path !== doc.file_path)
                                .map((c) => c.file_path);

                              if (filesToDelete.length > 0) {
                                await invoke("delete_local_files", { filePaths: filesToDelete });
                              }
                              await db.execute("DELETE FROM documents WHERE id = $1", [doc.id]);
                              await loadData();
                            } catch (error) {
                              await message("Failed to delete document: " + error, {
                                kind: "error",
                              });
                            }
                          }
                        }}
                        className="text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2 py-1 rounded text-xs font-bold transition-colors shadow-sm cursor-pointer"
                        title="Delete Document & Cleanup Files"
                      >
                        🗑️ Delete
                      </button>
                      <div
                        className="text-gray-400 font-bold px-2 cursor-pointer"
                        onClick={() => setExpandedDoc(isExpanded ? null : doc.id)}
                      >
                        {isExpanded ? "▲" : "▼"}
                      </div>
                    </div>
                  </div>

                  {/* Accordion Body */}
                  {isExpanded && (
                    <div className="p-3 bg-white space-y-2 border-t border-gray-200 flex flex-col">
                      {docChunks.map((chunk) => {
                        const isAudio = chunk.chunk_type === "audio";
                        const isFrames =
                          chunk.chunk_type === "frames" || chunk.chunk_type === "frames_pdf";

                        return (
                          <div
                            key={chunk.id}
                            className={`flex flex-col p-2 rounded border transition-colors ${chunk.status === 1 ? "bg-green-50 border-green-200" : isAudio ? "bg-purple-50 border-purple-200" : isFrames ? "bg-orange-50 border-orange-200" : "bg-white border-gray-200"} gap-2`}
                          >
                            <div className="flex items-center justify-between">
                              <span
                                className={`text-sm font-bold ${chunk.status === 1 ? "text-green-800" : "text-gray-700"}`}
                              >
                                {isAudio
                                  ? "🎙️ Audio Segment"
                                  : isFrames
                                    ? "🖼️ Slide Frames"
                                    : `📄 Chunk ${chunk.chunk_index}`}
                              </span>
                              <div className="flex gap-2 flex-wrap justify-end">
                                <button
                                  onClick={async () => {
                                    try {
                                      await emit("open-gemini");

                                      // Wait longer for the Gemini webview to spawn AND load the URL
                                      await new Promise((r) => setTimeout(r, 3000));

                                      let targetPath = chunk.file_path;
                                      if (chunk.chunk_type === "pdf") {
                                        targetPath = await invoke<string>("generate_pdf_chunk", {
                                          filePath: chunk.file_path,
                                          startPage: chunk.page_start,
                                          endPage: chunk.page_end,
                                        });
                                      }

                                      await invoke("copy_file_to_clipboard", {
                                        filePath: targetPath,
                                      });

                                      await invoke("focus_and_paste");

                                      // Wait a bit for file to attach before pasting prompt
                                      await new Promise((r) => setTimeout(r, 1500));

                                      const { writeText } =
                                        await import("@tauri-apps/plugin-clipboard-manager");
                                      await writeText(getPromptForChunk(chunk));

                                      await invoke("focus_and_paste");
                                    } catch (e) {
                                      alert("Automation failed: " + e);
                                    }
                                  }}
                                  className="text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded transition-transform transform hover:scale-105 shadow-md cursor-pointer"
                                >
                                  🤖 Paste File & Prompt
                                </button>
                                <button
                                  onClick={() => openPath(chunk.file_path)}
                                  className="text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded transition-colors shadow-sm cursor-pointer"
                                  title="Open file in default system viewer"
                                >
                                  👁️ View File
                                </button>
                                <button
                                  onClick={() => toggleChunkStatus(chunk.id, chunk.status)}
                                  className={`text-xs font-semibold px-3 py-1.5 rounded transition-colors shadow-sm cursor-pointer ${chunk.status === 1 ? "bg-gray-200 text-gray-700 hover:bg-gray-300" : "bg-green-600 text-white hover:bg-green-700"}`}
                                >
                                  {chunk.status === 1 ? "Undo" : "✔ Mark Done"}
                                </button>
                              </div>
                            </div>

                            {isFrames && imagePreviews[chunk.id] && (
                              <div className="mt-1 bg-white p-2 rounded border border-gray-200 flex gap-2 overflow-x-auto">
                                <img
                                  src={imagePreviews[chunk.id]}
                                  alt="Slide Frame"
                                  className="h-20 object-contain rounded"
                                />
                              </div>
                            )}

                            {chunk.status === 0 ? (
                              <div className="mt-2 flex gap-2">
                                <textarea
                                  placeholder="Paste Gemini's generated Markdown text here..."
                                  className="flex-1 text-xs p-2 border rounded resize-none h-16 outline-none"
                                  value={chunkJsonInput[chunk.id] || ""}
                                  onChange={(e) =>
                                    setChunkJsonInput({
                                      ...chunkJsonInput,
                                      [chunk.id]: e.target.value,
                                    })
                                  }
                                />
                                <button
                                  onClick={() =>
                                    handleSaveTextPhase(chunk, chunkJsonInput[chunk.id] || "")
                                  }
                                  className="bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-3 rounded shadow cursor-pointer min-w-20"
                                >
                                  Save Text
                                </button>
                              </div>
                            ) : (
                              <div className="mt-2 bg-white/50 border border-green-200 p-2 rounded max-h-24 overflow-y-auto text-xs text-green-900 font-mono whitespace-pre-wrap">
                                {chunk.extracted_text}
                              </div>
                            )}
                          </div>
                        );
                      })}

                      <div className="mt-4 pt-4 border-t border-gray-200 flex justify-center flex-col items-center gap-2">
                        {!isAllDone && docChunks.length > 0 && (
                          <span className="text-[10px] text-orange-500 font-bold uppercase">
                            ⚠️ Note: Not all chunks are marked as done. Missing chunks will be blank
                            in the graph.
                          </span>
                        )}
                        <button
                          onClick={() => handleBuildGraphFromText(doc)}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-full shadow-lg transition-transform transform hover:scale-105 cursor-pointer flex gap-2 items-center"
                        >
                          🧠 4. Generate Knowledge Graph Prompts
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
