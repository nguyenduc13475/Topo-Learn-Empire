import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { useState } from "react";

export default function PromptManager() {
  const [processMode, setProcessMode] = useState<"pdf" | "video">("pdf");
  const [filePath, setFilePath] = useState("");
  const [chunks, setChunks] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSelectFile = async () => {
    const selected = await openDialog({
      multiple: false,
      filters:
        processMode === "pdf"
          ? [{ name: "PDF Documents", extensions: ["pdf"] }]
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
      if (processMode === "pdf") {
        const result: string[] = await invoke("split_pdf", { filePath });
        setChunks(result);
      } else {
        // Video processing stub for next phase
        setTimeout(() => {
          setChunks([
            filePath.replace(/\.[^/.]+$/, "") + "_scene_1_transcript.txt",
            filePath.replace(/\.[^/.]+$/, "") + "_scene_2_transcript.txt",
          ]);
          setIsProcessing(false);
          alert("Video Scene Detection & Whisper Transcription simulated for MVP phase!");
        }, 1500);
        return;
      }
    } catch (error) {
      console.error("Failed to process document:", error);
      alert(`Error processing file: ${error}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const extractionPrompt = `Please analyze the attached document chunk (or video transcript/frames). Extract the core concepts, their definitions, the exact context/timestamp where it was mentioned, and their foundational prerequisites (which concept must be learned before another).

CRITICAL INSTRUCTIONS FOR IDs:
- For node "id", use a clear, descriptive snake_case string based on the label (e.g., "neural_networks", "backpropagation"). Do NOT use generic IDs like "1" or "node_1". This ensures concepts link and merge correctly across multiple separate document chunks.
- Format the output STRICTLY as a valid JSON string matching this schema, with no markdown formatting around it:
{
  "nodes": [{ "id": "descriptive_snake_case_id", "type": "concept", "data": { "label": "Concept Name", "definition": "Brief definition here...", "context": "Exact paragraph text or timestamp from the document..." } }],
  "edges": [{ "id": "source_id-target_id", "source": "prereq_id", "target": "concept_id" }]
}`;

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-y-auto p-4 space-y-6">
      <div className="bg-white p-4 rounded shadow-sm border border-gray-200">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-lg font-bold text-gray-800">1. Local File Processing</h2>
          <div className="flex bg-gray-100 rounded-lg p-1 shadow-inner">
            <button
              onClick={() => {
                setProcessMode("pdf");
                setFilePath("");
                setChunks([]);
              }}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${processMode === "pdf" ? "bg-white text-blue-700 shadow" : "text-gray-500 hover:text-gray-700"}`}
            >
              📄 PDF
            </button>
            <button
              onClick={() => {
                setProcessMode("video");
                setFilePath("");
                setChunks([]);
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
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium py-2 px-4 rounded transition-colors"
          >
            {isProcessing ? "Splitting..." : "Split PDF"}
          </button>
        </div>
      </div>

      {chunks.length > 0 && (
        <div className="bg-white p-4 rounded shadow-sm border border-gray-200 space-y-4">
          <h2 className="text-lg font-bold text-gray-800">2. The Manual Bridge</h2>
          <p className="text-sm text-gray-600">
            Copy the prompt below, then drag the corresponding chunk into the Gemini Webview to
            generate your Knowledge Graph.
          </p>

          <div className="bg-blue-50 p-3 rounded border border-blue-100 relative">
            <span className="text-xs font-bold text-blue-800 uppercase tracking-wide">
              Graph Extraction Prompt
            </span>
            <p className="text-sm font-mono mt-2 text-gray-700 whitespace-pre-wrap">
              {extractionPrompt}
            </p>
            <button
              onClick={() => copyToClipboard(extractionPrompt)}
              className="absolute top-2 right-2 text-xs bg-white border border-blue-200 text-blue-600 px-2 py-1 rounded hover:bg-blue-600 hover:text-white transition-colors"
            >
              Copy Prompt
            </button>
          </div>

          <div className="space-y-2">
            {chunks.map((chunk, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-3 bg-gray-100 rounded border border-gray-200"
              >
                <div className="flex flex-col overflow-hidden pr-2">
                  <span className="text-sm font-bold text-gray-700">Chunk {index + 1}</span>
                  <span className="text-xs text-gray-500 truncate" title={chunk}>
                    {chunk}
                  </span>
                </div>
                <button
                  onClick={() => openPath(chunk)}
                  className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-800 px-3 py-1.5 rounded shadow-sm whitespace-nowrap font-medium transition-colors cursor-pointer"
                  title="Open chunk file"
                >
                  Open File 📂
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
