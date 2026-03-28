import Database from "@tauri-apps/plugin-sql";
import { useEffect, useState } from "react";

interface Concept {
  id: string;
  label: string;
  definition: string;
  context: string;
  ease_factor: number;
  interval: number;
  repetitions: number;
  next_review_date: number;
}

export default function KnowledgeBase() {
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [edges, setEdges] = useState<{ id: string; source: string; target: string }[]>([]);
  const [editingConcept, setEditingConcept] = useState<Concept | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const loadConcepts = async () => {
    try {
      const db = await Database.load("sqlite:topolearn.db");
      const conceptsResult = await db.select<Concept[]>(
        "SELECT * FROM concepts ORDER BY label ASC",
      );
      const edgesResult =
        await db.select<{ id: string; source: string; target: string }[]>("SELECT * FROM edges");
      setConcepts(conceptsResult);
      setEdges(edgesResult);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadConcepts();
  }, []);

  const handleDelete = async (id: string) => {
    if (
      !window.confirm(
        "Are you sure you want to delete this concept? This will also remove any prerequisite links attached to it.",
      )
    )
      return;
    try {
      const db = await Database.load("sqlite:topolearn.db");
      await db.execute("DELETE FROM edges WHERE source = $1 OR target = $1", [id]);
      await db.execute("DELETE FROM concepts WHERE id = $1", [id]);
      loadConcepts();
    } catch (err) {
      console.error(err);
    }
  };

  const handleSave = async () => {
    if (!editingConcept) return;
    try {
      const db = await Database.load("sqlite:topolearn.db");
      if (isAdding) {
        await db.execute(
          "INSERT INTO concepts (id, label, definition, context, ease_factor, interval, repetitions, next_review_date) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
          [
            editingConcept.id,
            editingConcept.label,
            editingConcept.definition,
            editingConcept.context,
            editingConcept.ease_factor,
            editingConcept.interval,
            editingConcept.repetitions,
            editingConcept.next_review_date,
          ],
        );
      } else {
        await db.execute(
          "UPDATE concepts SET label = $1, definition = $2, context = $3, repetitions = $4, interval = $5, ease_factor = $6 WHERE id = $7",
          [
            editingConcept.label,
            editingConcept.definition,
            editingConcept.context,
            editingConcept.repetitions,
            editingConcept.interval,
            editingConcept.ease_factor,
            editingConcept.id,
          ],
        );
      }
      setEditingConcept(null);
      setIsAdding(false);
      loadConcepts();
    } catch (err) {
      console.error(err);
    }
  };

  const openAddModal = () => {
    setIsAdding(true);
    setEditingConcept({
      id: crypto.randomUUID(),
      label: "",
      definition: "",
      context: "",
      ease_factor: 2.5,
      interval: 0,
      repetitions: 0,
      next_review_date: Math.floor(Date.now() / 1000),
    });
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 p-6 overflow-hidden">
      <div className="flex justify-between items-center shrink-0 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Knowledge Base</h1>
          <p className="text-sm text-gray-600">
            Manage extracted concepts, manually add missing ones, and track raw SM-2 stats.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              try {
                const db = await Database.load("sqlite:topolearn.db");
                const allConcepts = await db.select("SELECT * FROM concepts");
                const allEdges = await db.select("SELECT * FROM edges");
                const blob = new Blob(
                  [JSON.stringify({ nodes: allConcepts, edges: allEdges }, null, 2)],
                  { type: "application/json" },
                );
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `topolearn-backup-${new Date().toISOString().split("T")[0]}.json`;
                a.click();
              } catch (err) {
                console.error("Export failed", err);
                alert("Failed to export database.");
              }
            }}
            className="bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded shadow-sm transition-colors text-sm"
          >
            ⬇ Export JSON
          </button>
          <button
            onClick={openAddModal}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded shadow-sm transition-colors text-sm"
          >
            + Add Concept
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-white rounded-lg shadow-sm border border-gray-200">
        <table className="w-full text-left border-collapse text-sm">
          <thead className="bg-gray-100 sticky top-0 shadow-sm z-10">
            <tr>
              <th className="p-3 border-b text-gray-700 font-semibold w-1/4">Concept</th>
              <th className="p-3 border-b text-gray-700 font-semibold w-1/2">Definition</th>
              <th className="p-3 border-b text-gray-700 font-semibold text-center">
                Stats (Rep/Int)
              </th>
              <th className="p-3 border-b text-gray-700 font-semibold text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {concepts.map((c) => (
              <tr
                key={c.id}
                className="hover:bg-gray-50 border-b border-gray-100 transition-colors"
              >
                <td className="p-3 font-medium text-blue-800 align-top">{c.label}</td>
                <td className="p-3 text-gray-600 align-top line-clamp-3" title={c.definition}>
                  {c.definition}
                </td>
                <td className="p-3 text-center align-top text-gray-500">
                  <span className="bg-gray-100 px-2 py-1 rounded text-xs">
                    {c.repetitions} / {c.interval}d
                  </span>
                </td>
                <td className="p-3 align-top text-center">
                  <div className="flex justify-center gap-2">
                    <button
                      onClick={() => {
                        setIsAdding(false);
                        setEditingConcept(c);
                      }}
                      className="text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Edit
                    </button>
                    <span className="text-gray-300">|</span>
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="text-red-600 hover:text-red-800 font-medium"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {concepts.length === 0 && (
              <tr>
                <td colSpan={4} className="p-8 text-center text-gray-500">
                  No concepts found. Parse a JSON graph first or add one manually.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Edit / Add Modal */}
      {editingConcept && (
        <div className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-150 p-6 flex flex-col">
            <h2 className="text-xl font-bold mb-4">
              {isAdding ? "Add New Concept" : "Edit Concept"}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Label</label>
                <input
                  type="text"
                  value={editingConcept.label}
                  onChange={(e) => setEditingConcept({ ...editingConcept, label: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Backpropagation"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Definition</label>
                <textarea
                  value={editingConcept.definition}
                  onChange={(e) =>
                    setEditingConcept({ ...editingConcept, definition: e.target.value })
                  }
                  className="w-full p-2 border border-gray-300 rounded h-24 outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder="Explain the concept concisely..."
                />
              </div>
              <div className="grid grid-cols-3 gap-4 border-t border-gray-100 pt-4 mt-2">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">Repetitions</label>
                  <input
                    type="number"
                    value={editingConcept.repetitions}
                    onChange={(e) =>
                      setEditingConcept({
                        ...editingConcept,
                        repetitions: parseInt(e.target.value) || 0,
                      })
                    }
                    className="w-full p-2 text-sm border border-gray-300 rounded outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">
                    Interval (days)
                  </label>
                  <input
                    type="number"
                    value={editingConcept.interval}
                    onChange={(e) =>
                      setEditingConcept({
                        ...editingConcept,
                        interval: parseInt(e.target.value) || 0,
                      })
                    }
                    className="w-full p-2 text-sm border border-gray-300 rounded outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">Ease Factor</label>
                  <input
                    type="number"
                    step="0.1"
                    value={editingConcept.ease_factor}
                    onChange={(e) =>
                      setEditingConcept({
                        ...editingConcept,
                        ease_factor: parseFloat(e.target.value) || 2.5,
                      })
                    }
                    className="w-full p-2 text-sm border border-gray-300 rounded outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1 mt-4">
                  Source Context (Optional)
                </label>
                <textarea
                  value={editingConcept.context}
                  onChange={(e) =>
                    setEditingConcept({ ...editingConcept, context: e.target.value })
                  }
                  className="w-full p-2 border border-gray-300 rounded h-24 outline-none focus:ring-2 focus:ring-blue-500 resize-none text-xs text-gray-600"
                  placeholder="Paste the paragraph where you learned this..."
                />
              </div>

              {!isAdding && (
                <div className="pt-2 border-t border-gray-100 mt-2">
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    Prerequisites (Must learn before this)
                  </label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {edges
                      .filter((e) => e.target === editingConcept.id)
                      .map((edge) => {
                        const sourceConcept = concepts.find((c) => c.id === edge.source);
                        return (
                          <span
                            key={edge.id}
                            className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded flex items-center gap-1"
                          >
                            {sourceConcept?.label || edge.source}
                            <button
                              onClick={async () => {
                                const db = await Database.load("sqlite:topolearn.db");
                                await db.execute("DELETE FROM edges WHERE id = $1", [edge.id]);
                                loadConcepts();
                              }}
                              className="text-blue-500 hover:text-blue-900 ml-1 font-bold cursor-pointer"
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                    {edges.filter((e) => e.target === editingConcept.id).length === 0 && (
                      <span className="text-xs text-gray-400 italic">No prerequisites.</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <select
                      id="new-prereq-select"
                      className="flex-1 p-2 text-sm border border-gray-300 rounded outline-none focus:ring-2 focus:ring-blue-500"
                      defaultValue=""
                    >
                      <option value="" disabled>
                        Select a concept to add...
                      </option>
                      {concepts
                        .filter(
                          (c) =>
                            c.id !== editingConcept.id &&
                            !edges.some((e) => e.target === editingConcept.id && e.source === c.id),
                        )
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                    </select>
                    <button
                      onClick={async () => {
                        const selectEl = document.getElementById(
                          "new-prereq-select",
                        ) as HTMLSelectElement;
                        const sourceId = selectEl.value;
                        if (!sourceId) return;
                        const edgeId = `edge-${sourceId}-${editingConcept.id}-${crypto.randomUUID().slice(0, 8)}`;
                        const db = await Database.load("sqlite:topolearn.db");
                        await db.execute(
                          "INSERT INTO edges (id, source, target) VALUES ($1, $2, $3)",
                          [edgeId, sourceId, editingConcept.id],
                        );
                        selectEl.value = "";
                        loadConcepts();
                      }}
                      className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1 rounded text-sm transition-colors font-medium cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  setEditingConcept(null);
                  setIsAdding(false);
                }}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!editingConcept.label.trim() || !editingConcept.definition.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium rounded transition-colors"
              >
                {isAdding ? "Create Concept" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
