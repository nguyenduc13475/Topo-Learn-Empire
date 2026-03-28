import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { openUrl } from "@tauri-apps/plugin-opener";
import Database from "@tauri-apps/plugin-sql";
import { useEffect, useState } from "react";
import "./App.css";
import Dashboard from "./components/Dashboard";
import KnowledgeBase from "./components/KnowledgeBase";
import KnowledgeGraph from "./components/KnowledgeGraph";
import PromptManager from "./components/PromptManager";

function App() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "process" | "graph" | "database">(
    "dashboard",
  );
  const [jsonInput, setJsonInput] = useState("");
  const [graphData, setGraphData] = useState<{ nodes: any[]; edges: any[] } | null>(null);

  const loadGraphFromDB = async () => {
    try {
      const db = await Database.load("sqlite:topolearn.db");
      const dbConcepts = await db.select<any[]>("SELECT * FROM concepts");
      const dbEdges = await db.select<any[]>("SELECT * FROM edges");

      if (dbConcepts.length > 0) {
        const nodes = dbConcepts.map((c) => ({
          id: c.id,
          type: "concept",
          data: {
            label: c.label,
            definition: c.definition,
            repetitions: c.repetitions,
            next_review_date: c.next_review_date,
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
    }
  }, [activeTab]);

  const handleParseJSON = async () => {
    try {
      let cleanJson = jsonInput;
      // Extract only the valid JSON block, ignoring Gemini conversational text
      const jsonMatch = jsonInput.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanJson = jsonMatch[0];
      } else {
        cleanJson = jsonInput
          .replace(/```json/gi, "")
          .replace(/```/g, "")
          .trim();
      }

      const parsed = JSON.parse(cleanJson);

      if (Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
        // Save to SQLite Database FIRST
        try {
          const db = await Database.load("sqlite:topolearn.db");

          for (const node of parsed.nodes) {
            await db.execute(
              "INSERT OR IGNORE INTO concepts (id, label, definition, context) VALUES ($1, $2, $3, $4)",
              [node.id, node.data.label, node.data.definition || "", node.data.context || ""],
            );
          }

          // Validate edges to prevent Foreign Key constraint crashes
          const existingConcepts = await db.select<{ id: string }[]>("SELECT id FROM concepts");
          const validIds = new Set([
            ...existingConcepts.map((c) => c.id),
            ...parsed.nodes.map((n: any) => n.id),
          ]);

          let skippedEdges = 0;
          for (const edge of parsed.edges) {
            if (validIds.has(edge.source) && validIds.has(edge.target)) {
              // Provide a highly specific fallback ID if Gemini hallucinates/skips it
              const edgeId =
                edge.id || `edge-${edge.source}-${edge.target}-${crypto.randomUUID().slice(0, 8)}`;
              await db.execute(
                "INSERT OR IGNORE INTO edges (id, source, target) VALUES ($1, $2, $3)",
                [edgeId, edge.source, edge.target],
              );
            } else {
              console.warn(`Skipped invalid edge from ${edge.source} to ${edge.target}`);
              skippedEdges++;
            }
          }

          setJsonInput(""); // Clear input
          await loadGraphFromDB(); // Reload full combined graph from DB
          alert(
            `Graph parsed, saved, and merged!${skippedEdges > 0 ? ` (Skipped ${skippedEdges} hallucinated/invalid edges)` : ""}`,
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
    <main className="flex h-screen w-full bg-gray-100 text-gray-900 font-sans">
      {/* LEFT PANEL: Topo-Learn Native UI */}
      <section className="w-1/2 flex flex-col border-r border-gray-300 bg-white">
        <header className="pt-4 px-4 bg-blue-700 text-white shadow-sm flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <span className="font-bold text-xl">Topo-Learn Coach</span>
            <span className="text-xs bg-blue-800 px-2 py-1 rounded">Local DAG MVP</span>
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
          </div>
        </header>

        {/* Tab Content */}
        <div className="flex-1 w-full relative overflow-hidden flex flex-col">
          {activeTab === "dashboard" && <Dashboard />}

          {activeTab === "process" && <PromptManager />}

          {activeTab === "database" && <KnowledgeBase />}

          {activeTab === "graph" && (
            <div className="flex flex-col h-full">
              {/* Manual JSON Bridge Panel */}
              <div className="p-4 flex flex-col gap-2 border-b border-gray-200 bg-gray-50 shrink-0">
                <label className="text-sm font-semibold text-gray-700">
                  Paste Gemini Knowledge Graph JSON:
                </label>
                <textarea
                  className="w-full h-24 p-2 text-xs font-mono border border-gray-300 rounded resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white shadow-inner"
                  placeholder={`{\n  "nodes": [{ "id": "1", "type": "concept", "data": { "label": "Concept", "definition": "..." } }],\n  "edges": [{ "id": "e1-2", "source": "1", "target": "2" }]\n}`}
                  value={jsonInput}
                  onChange={(e) => setJsonInput(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleParseJSON}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded transition-colors shadow text-sm"
                  >
                    Render Knowledge Graph
                  </button>
                  <button
                    onClick={async () => {
                      if (
                        window.confirm("Are you sure you want to clear all concepts and progress?")
                      ) {
                        try {
                          const db = await Database.load("sqlite:topolearn.db");
                          await db.execute("DELETE FROM edges");
                          await db.execute("DELETE FROM concepts");
                          setGraphData({ nodes: [], edges: [] });
                          alert("Knowledge base cleared.");
                        } catch (e) {
                          console.error(e);
                        }
                      }
                    }}
                    className="bg-red-100 hover:bg-red-200 text-red-700 font-medium py-2 px-4 rounded transition-colors shadow text-sm"
                  >
                    Clear Data
                  </button>
                </div>
              </div>

              {/* React Flow DAG Rendering Area */}
              <div className="flex-1 w-full relative">
                <KnowledgeGraph graphData={graphData} />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* RIGHT PANEL: Gemini Webview Bridge */}
      <section className="w-1/2 flex flex-col bg-gray-100 relative">
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
                onClick={() => {
                  const geminiWindow = new WebviewWindow("gemini-webview", {
                    url: "https://gemini.google.com",
                    title: "Gemini AI Coach",
                    width: 800,
                    height: 900,
                  });
                  geminiWindow.once("tauri://error", (e) => {
                    console.error("Error creating native window", e);
                    openUrl("https://gemini.google.com");
                  });
                }}
                className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-6 rounded-full shadow-lg transition-transform transform hover:scale-105 active:scale-95 mb-3"
              >
                Launch Gemini Window 🚀
              </button>
              <button
                onClick={() => openUrl("https://gemini.google.com")}
                className="text-sm text-blue-400 hover:text-blue-300 underline mt-2"
              >
                Or open in external browser
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
