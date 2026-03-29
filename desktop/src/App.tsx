import { listen } from "@tauri-apps/api/event";
import Database from "@tauri-apps/plugin-sql";
import { jsonrepair } from "jsonrepair";
import { useCallback, useEffect, useState } from "react";
import "./App.css";
import Dashboard from "./components/Dashboard";
import KnowledgeBase from "./components/KnowledgeBase";
import KnowledgeGraph from "./components/KnowledgeGraph";
import PromptManager from "./components/PromptManager";

import ExamsManager from "./components/ExamsManager";

function App() {
  const [activeTab, setActiveTab] = useState<
    "dashboard" | "process" | "graph" | "database" | "exams"
  >("dashboard");
  const [jsonInput, setJsonInput] = useState("");
  const [graphData, setGraphData] = useState<{ nodes: any[]; edges: any[] } | null>(null);
  const [documents, setDocuments] = useState<{ id: string; title: string }[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string>("");
  const [isNativeGeminiActive, setIsNativeGeminiActive] = useState(false);

  const launchNativeGemini = useCallback(async () => {
    if (isNativeGeminiActive) return;
    try {
      const { getCurrentWindow, LogicalPosition, LogicalSize, currentMonitor } =
        await import("@tauri-apps/api/window");
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");

      const appWindow = getCurrentWindow();
      const monitor = await currentMonitor();
      const scaleFactor = monitor ? monitor.scaleFactor : 1;

      let screenW = 1200;
      let screenH = 900;

      if (monitor) {
        screenW = monitor.size.width / scaleFactor;
        screenH = monitor.size.height / scaleFactor;

        const isMax = await appWindow.isMaximized();
        if (isMax) await appWindow.unmaximize();
      }

      const panelWidth = Math.floor(screenW / 2);
      const height = screenH;

      setIsNativeGeminiActive(true);

      await appWindow.setSize(new LogicalSize(panelWidth, height));
      await appWindow.setPosition(new LogicalPosition(0, 0));

      try {
        await appWindow.setMaxSize(new LogicalSize(panelWidth, height));
      } catch (e) {
        console.warn("OS rejected size lock, continuing anyway...");
      }

      const uniqueWindowId = `gemini-webview-${Date.now()}`;
      const geminiWindow = new WebviewWindow(uniqueWindowId, {
        url: "https://gemini.google.com",
        title: "Gemini AI Coach",
        width: panelWidth,
        height: height,
        x: panelWidth,
        y: 0,
        decorations: false,
        shadow: false,
      });

      const unlistenMove = await appWindow.onMoved(async () => {
        try {
          const pos = await appWindow.outerPosition();
          const size = await appWindow.outerSize();
          await geminiWindow.setPosition(
            new LogicalPosition((pos.x + size.width) / scaleFactor, pos.y / scaleFactor),
          );
        } catch (e) {}
      });

      const unlistenResize = await appWindow.onResized(async () => {
        try {
          const pos = await appWindow.outerPosition();
          const size = await appWindow.outerSize();
          await geminiWindow.setPosition(
            new LogicalPosition((pos.x + size.width) / scaleFactor, pos.y / scaleFactor),
          );
          await geminiWindow.setSize(new LogicalSize(panelWidth, size.height / scaleFactor));
        } catch (e) {}
      });

      geminiWindow.once("tauri://error", async (e) => {
        console.error("Error creating native window", e);
        setIsNativeGeminiActive(false);
        try {
          await appWindow.setMaxSize(null);
        } catch (_) {}
      });

      geminiWindow.once("tauri://destroyed", async () => {
        if (unlistenMove) unlistenMove();
        if (unlistenResize) unlistenResize();
        setIsNativeGeminiActive(false);
        try {
          await appWindow.setMaxSize(null);
        } catch (_) {}
      });
    } catch (err) {
      console.error("Window management failed:", err);
      setIsNativeGeminiActive(false);
      alert(`Failed to launch Gemini: ${err}`);
    }
  }, [isNativeGeminiActive]);

  useEffect(() => {
    const unlistenPromise = listen("open-gemini", () => {
      launchNativeGemini();
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [launchNativeGemini]);

  const loadDocuments = async () => {
    try {
      const db = await Database.load("sqlite:topolearn.db");
      const docs = await db.select<{ id: string; title: string }[]>(
        "SELECT id, title FROM documents ORDER BY created_at DESC",
      );
      setDocuments(docs);
    } catch (e) {
      console.error(e);
    }
  };

  const loadGraphFromDB = async () => {
    try {
      const db = await Database.load("sqlite:topolearn.db");
      const dbConcepts = await db.select<any[]>("SELECT * FROM concepts");
      const dbEdges = await db.select<any[]>("SELECT * FROM edges");

      if (dbConcepts.length > 0) {
        const nodes = dbConcepts.map((c) => ({
          id: c.id,
          type: "concept",
          position: { x: 0, y: 0 }, // CRITICAL: Required by React Flow to prevent rendering crashes
          data: {
            label: c.label,
            definition: c.definition,
            repetitions: c.repetitions,
            next_review_date: c.next_review_date,
            document_id: c.document_id,
          },
        }));
        const edges = dbEdges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
        }));
        setGraphData({ nodes, edges });
      }
    } catch (error) {
      console.error("Failed to load graph from DB:", error);
    }
  };

  useEffect(() => {
    if (activeTab === "graph") {
      loadGraphFromDB();
      loadDocuments();
    }
  }, [activeTab]);

  const handleParseJSON = async (inputStr?: string) => {
    try {
      const targetJson = typeof inputStr === "string" ? inputStr : jsonInput;
      if (!targetJson.trim()) {
        alert("No JSON provided!");
        return;
      }
      let cleanJson = targetJson
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();
      const startIdx = cleanJson.indexOf("{");
      const endIdx = cleanJson.lastIndexOf("}");
      if (startIdx >= 0 && endIdx >= 0) {
        cleanJson = cleanJson.substring(startIdx, endIdx + 1);
      }

      let parsed;
      try {
        parsed = JSON.parse(jsonrepair(cleanJson));
      } catch (e) {
        alert(
          "Gemini generated an unrepairable or completely invalid format. Please ask Gemini to 'Output strictly as valid JSON according to the prompt' and try pasting again.",
        );
        return;
      }

      if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
        // Anti-hallucination: Filter out invalid nodes/edges and deduplicate
        const uniqueNodes = new Map();
        parsed.nodes.forEach((n: any) => {
          if (n && n.id) uniqueNodes.set(n.id, n);
        });
        parsed.nodes = Array.from(uniqueNodes.values());
        parsed.edges = parsed.edges.filter((e: any) => e && e.source && e.target);

        try {
          const db = await Database.load("sqlite:topolearn.db");

          for (const node of parsed.nodes) {
            // Type safety sanitization
            let safePageNum = null;
            if (node.data?.page_num !== undefined && node.data?.page_num !== null) {
              // Regex to extract only digits just in case Gemini wrote "Page 5"
              const rawPage = node.data.page_num.toString().replace(/\D/g, "");
              safePageNum = parseInt(rawPage, 10);
              if (isNaN(safePageNum)) safePageNum = null;
            }

            let safeVideoTs = null;
            if (node.data?.video_timestamp !== undefined) {
              // Handle "12:30" string formats just in case Gemini ignored prompt instructions
              if (
                typeof node.data.video_timestamp === "string" &&
                node.data.video_timestamp.includes(":")
              ) {
                const parts = node.data.video_timestamp.split(":");
                if (parts.length === 2)
                  safeVideoTs = parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
              } else {
                safeVideoTs = parseFloat(node.data.video_timestamp);
              }
              if (safeVideoTs !== null && isNaN(safeVideoTs)) safeVideoTs = null;
            }

            // CRITICAL: Force the document_id from the UI dropdown to ensure the "Jump" works
            const finalDocId = selectedDocId || node.data?.document_id || null;

            await db.execute(
              "INSERT INTO concepts (id, label, definition, context, document_id, page_num, video_timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT(id) DO UPDATE SET definition = CASE WHEN excluded.definition != '' THEN excluded.definition ELSE concepts.definition END, context = CASE WHEN excluded.context != '' THEN excluded.context ELSE concepts.context END, document_id = excluded.document_id, page_num = excluded.page_num, video_timestamp = excluded.video_timestamp",
              [
                node.id,
                node.data?.label || node.id,
                node.data?.definition || "",
                node.data?.context || "",
                finalDocId,
                safePageNum,
                safeVideoTs,
              ],
            );
          }

          const existingConcepts = await db.select<{ id: string }[]>("SELECT id FROM concepts");
          const validIds = new Set([
            ...existingConcepts.map((c) => c.id),
            ...parsed.nodes.map((n: any) => n.id),
          ]);

          let stubbedNodes = 0;
          for (const edge of parsed.edges) {
            if (!validIds.has(edge.source)) {
              await db.execute(
                "INSERT OR IGNORE INTO concepts (id, label, definition, context) VALUES ($1, $2, $3, $4)",
                [
                  edge.source,
                  `Missing: ${edge.source}`,
                  "Gemini referenced this concept as a prerequisite but did not define it.",
                  "",
                ],
              );
              validIds.add(edge.source);
              stubbedNodes++;
            }
            if (!validIds.has(edge.target)) {
              await db.execute(
                "INSERT OR IGNORE INTO concepts (id, label, definition, context) VALUES ($1, $2, $3, $4)",
                [
                  edge.target,
                  `Missing: ${edge.target}`,
                  "Gemini referenced this concept as a target but did not define it.",
                  "",
                ],
              );
              validIds.add(edge.target);
              stubbedNodes++;
            }

            const edgeId =
              edge.id || `edge-${edge.source}-${edge.target}-${crypto.randomUUID().slice(0, 8)}`;
            await db.execute(
              "INSERT OR IGNORE INTO edges (id, source, target) VALUES ($1, $2, $3)",
              [edgeId, edge.source, edge.target],
            );
          }

          setJsonInput("");
          await loadGraphFromDB();
          alert(
            `Graph parsed, saved, and merged!${stubbedNodes > 0 ? ` (Auto-stubbed ${stubbedNodes} missing nodes from hallucinated edges to prevent graph breakage)` : ""}`,
          );
        } catch (dbError) {
          console.error("Database error:", dbError);
          alert("Failed to save to database. Check console for syntax errors.");
        }
      } else {
        alert("Invalid structure. Please ensure JSON contains 'nodes' and 'edges' arrays.");
      }
    } catch (error) {
      alert("Failed to parse JSON. Please check the syntax from Gemini.");
    }
  };

  return (
    <main className="flex h-screen w-full bg-gray-100 text-gray-900 font-sans overflow-hidden">
      {/* LEFT PANEL: Topo-Learn Native UI */}
      <section
        className={`${isNativeGeminiActive ? "w-full" : "w-1/2"} flex flex-col border-r border-gray-300 bg-white transition-all duration-300`}
      >
        <header className="pt-4 px-4 bg-blue-700 text-white shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <span className="font-bold text-xl">Topo-Learn Coach</span>
            <div className="flex items-center gap-3">
              {/* Manual Kill Switch for Gemini Webview */}
              {isNativeGeminiActive && (
                <button
                  onClick={async () => {
                    try {
                      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
                      // 1. Get all active windows (bypasses React stale state issues completely)
                      const allWindows = await WebviewWindow.getAll();

                      // 2. Loop through and forcefully kill any window that is our Gemini webview
                      for (const win of allWindows) {
                        if (win.label.startsWith("gemini-webview")) {
                          await win.close();
                        }
                      }
                    } catch (e) {
                      console.error("Failed to kill Gemini window natively", e);
                    }

                    // 3. Force UI Reset and Unlock the Main Window regardless of what happened
                    setIsNativeGeminiActive(false);
                    try {
                      const { getCurrentWindow } = await import("@tauri-apps/api/window");
                      const appWin = getCurrentWindow();
                      await appWin.setMaximizable(true);
                      await appWin.maximize();
                    } catch (e) {}
                  }}
                  className="bg-red-500 hover:bg-red-400 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-md cursor-pointer transition-transform active:scale-95"
                >
                  ✕ Close Gemini
                </button>
              )}
              <span className="text-xs bg-blue-800 px-2 py-1 rounded">Local DAG MVP</span>
            </div>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setActiveTab("dashboard")}
              className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${
                activeTab === "dashboard"
                  ? "bg-white text-blue-700"
                  : "bg-blue-800 text-blue-100 hover:bg-blue-600"
              }`}
            >
              0. Dashboard
            </button>
            <button
              onClick={() => setActiveTab("process")}
              className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${
                activeTab === "process"
                  ? "bg-white text-blue-700"
                  : "bg-blue-800 text-blue-100 hover:bg-blue-600"
              }`}
            >
              1. Process Document
            </button>
            <button
              onClick={() => setActiveTab("graph")}
              className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${
                activeTab === "graph"
                  ? "bg-white text-blue-700"
                  : "bg-blue-800 text-blue-100 hover:bg-blue-600"
              }`}
            >
              2. Knowledge Graph
            </button>
            <button
              onClick={() => setActiveTab("database")}
              className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${
                activeTab === "database"
                  ? "bg-white text-blue-700"
                  : "bg-blue-800 text-blue-100 hover:bg-blue-600"
              }`}
            >
              3. Database
            </button>
            <button
              onClick={() => setActiveTab("exams")}
              className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${
                activeTab === "exams"
                  ? "bg-white text-blue-700"
                  : "bg-blue-800 text-blue-100 hover:bg-blue-600"
              }`}
            >
              4. Exams
            </button>
          </div>
        </header>

        {/* Tab Content */}
        <div className="flex-1 w-full relative overflow-hidden flex flex-col">
          {activeTab === "dashboard" && <Dashboard />}

          {activeTab === "process" && <PromptManager />}

          {activeTab === "database" && <KnowledgeBase />}

          {activeTab === "exams" && <ExamsManager />}

          {activeTab === "graph" && (
            <div className="flex flex-col h-full">
              {/* Manual JSON Bridge Panel */}
              <div className="p-4 flex flex-col gap-2 border-b border-gray-200 bg-gray-50 shrink-0">
                <div className="flex justify-between items-end">
                  <label className="text-sm font-semibold text-gray-700">
                    Paste Gemini Knowledge Graph JSON:
                  </label>
                  <select
                    value={selectedDocId}
                    onChange={(e) => setSelectedDocId(e.target.value)}
                    className="text-xs p-1.5 border border-gray-300 rounded bg-white max-w-64 outline-none shadow-sm cursor-pointer"
                  >
                    <option value="">No Document Tag (Global)</option>
                    {documents.map((doc) => (
                      <option key={doc.id} value={doc.id}>
                        {doc.title}
                      </option>
                    ))}
                  </select>
                </div>
                <textarea
                  className="w-full h-24 p-2 text-xs font-mono border border-gray-300 rounded resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white shadow-inner"
                  placeholder={`{\n  "nodes": [{ "id": "1", "type": "concept", "data": { "label": "Concept", "definition": "..." } }],\n  "edges": [{ "id": "e1-2", "source": "1", "target": "2" }]\n}`}
                  value={jsonInput}
                  onChange={(e) => setJsonInput(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      try {
                        const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
                        const text = await readText();
                        if (text) {
                          setJsonInput(text);
                          await handleParseJSON(text);
                        } else {
                          alert("Clipboard is empty! Copy the JSON from Gemini first.");
                        }
                      } catch (err) {
                        alert("Failed to read clipboard.");
                      }
                    }}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition-colors shadow-md text-sm flex justify-center items-center gap-2 cursor-pointer"
                  >
                    ✨ Magic Paste & Render
                  </button>
                  <button
                    onClick={() => handleParseJSON()}
                    className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-medium py-2 px-4 rounded transition-colors shadow text-sm cursor-pointer"
                  >
                    Manual Parse
                  </button>
                  <button
                    onClick={async () => {
                      const { ask } = await import("@tauri-apps/plugin-dialog");
                      const confirmed = await ask(
                        "Are you sure you want to clear ALL data for the semester? This will completely wipe concepts, exams, documents, and learning progress.",
                        { kind: "warning" },
                      );
                      if (confirmed) {
                        try {
                          const db = await Database.load("sqlite:topolearn.db");
                          await db.execute("DELETE FROM edges");
                          await db.execute("DELETE FROM concepts");
                          await db.execute("DELETE FROM chunks");
                          await db.execute("DELETE FROM exam_documents");
                          await db.execute("DELETE FROM exams");
                          await db.execute("DELETE FROM saved_quizzes");
                          await db.execute("DELETE FROM documents");
                          setGraphData({ nodes: [], edges: [] });
                          setDocuments([]);
                          setSelectedDocId("");

                          // We are NOT closing the Gemini window anymore.
                          // Just reset local UI state while leaving the side-panel alive.

                          // Prevent React strict mode double rendering issues by alerting safely
                          setTimeout(() => alert("All semester data cleared successfully."), 100);
                        } catch (e) {
                          console.error(e);
                        }
                      }
                    }}
                    className="bg-red-100 hover:bg-red-200 text-red-700 font-medium py-2 px-4 rounded transition-colors shadow text-sm cursor-pointer"
                  >
                    Clear Semester Data
                  </button>
                </div>
              </div>

              {/* React Flow DAG Rendering Area */}
              <div className="flex-1 w-full relative">
                <KnowledgeGraph graphData={graphData} documents={documents} />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* RIGHT PANEL: Gemini Webview Bridge (Hidden when native is active) */}
      {!isNativeGeminiActive && (
        <section className="w-1/2 flex flex-col bg-gray-100 relative transition-all duration-300">
          <header className="p-4 bg-gray-800 text-white font-bold text-xl shadow-sm flex justify-between items-center">
            <span>Gemini Assistant</span>
            <span className="text-xs bg-gray-700 px-2 py-1 rounded text-gray-300">
              Webview Sandbox
            </span>
          </header>

          <div className="flex-1 w-full relative">
            <iframe
              src="https://gemini.google.com"
              className="w-full h-full border-none opacity-20 grayscale"
              title="Gemini Webview Sandbox"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />

            {/* Fallback overlay for iframe blocking */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-gray-900/95 text-white p-6 rounded-lg text-center shadow-2xl max-w-md pointer-events-auto border border-gray-700 flex flex-col items-center">
                <h3 className="font-bold text-lg mb-2 text-blue-400">Webview Sandbox Blocked</h3>
                <p className="text-sm text-gray-300 mb-6">
                  Google blocks standard iframes (X-Frame-Options). However, Topo-Learn can spawn a
                  native Tauri App Window to bypass this and run Gemini securely alongside your
                  application.
                </p>
                <button
                  onClick={launchNativeGemini}
                  className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-6 rounded-full shadow-lg transition-transform transform hover:scale-105 active:scale-95 mb-3 cursor-pointer"
                >
                  Launch Gemini Side-by-Side 🚀
                </button>
                <button
                  onClick={() => {
                    import("@tauri-apps/plugin-opener").then(({ openUrl }) => {
                      openUrl("https://gemini.google.com");
                    });
                  }}
                  className="text-sm text-blue-400 hover:text-blue-300 underline mt-2 cursor-pointer"
                >
                  Or open in external browser
                </button>
              </div>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

export default App;
