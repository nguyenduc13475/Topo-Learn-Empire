import Database from "@tauri-apps/plugin-sql";
import { useEffect, useState } from "react";

export default function ExamsManager() {
  const [exams, setExams] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [examDocs, setExamDocs] = useState<any[]>([]);
  const [newTitle, setNewTitle] = useState("");

  const loadData = async () => {
    try {
      const db = await Database.load("sqlite:topolearn.db");
      setExams(await db.select("SELECT * FROM exams ORDER BY title ASC"));
      setDocuments(await db.select("SELECT id, title FROM documents"));
      setExamDocs(await db.select("SELECT * FROM exam_documents"));
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    try {
      const db = await Database.load("sqlite:topolearn.db");
      const defaultConf = JSON.stringify({
        mcq_single_count: 40,
        mcq_multi_count: 0,
        fill_blank_count: 0,
        essay_count: 0,
        timeLimit: 60,
      });
      await db.execute("INSERT INTO exams (id, title, config_json) VALUES ($1, $2, $3)", [
        crypto.randomUUID(),
        newTitle,
        defaultConf,
      ]);
      setNewTitle("");
      loadData();
    } catch (e) {
      console.error(e);
    }
  };

  const updateExamConfig = async (
    examId: string,
    currentConfig: string,
    key: string,
    value: any,
  ) => {
    try {
      const db = await Database.load("sqlite:topolearn.db");
      let conf = currentConfig
        ? JSON.parse(currentConfig)
        : {
            mcq_single_count: 40,
            mcq_multi_count: 0,
            fill_blank_count: 0,
            essay_count: 0,
            timeLimit: 60,
          };
      conf[key] = value;
      await db.execute("UPDATE exams SET config_json = $1 WHERE id = $2", [
        JSON.stringify(conf),
        examId,
      ]);
      loadData();
    } catch (e) {
      console.error(e);
    }
  };

  const toggleDocument = async (examId: string, docId: string, isMapped: boolean) => {
    try {
      const db = await Database.load("sqlite:topolearn.db");
      if (isMapped) {
        await db.execute("DELETE FROM exam_documents WHERE exam_id = $1 AND document_id = $2", [
          examId,
          docId,
        ]);
      } else {
        await db.execute("INSERT INTO exam_documents (exam_id, document_id) VALUES ($1, $2)", [
          examId,
          docId,
        ]);
      }
      loadData();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 p-6 overflow-y-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-2">Test & Curriculum Limits</h1>
      <p className="text-sm text-gray-600 mb-6">
        Create upcoming tests, configure constraints, and assign materials.
      </p>

      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="e.g., Midterm: Machine Learning"
          className="flex-1 p-2 border border-gray-300 rounded shadow-sm outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={handleCreate}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded font-bold shadow-sm cursor-pointer"
        >
          + Create Test Limit
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {exams.map((exam) => {
          const config = exam.config_json
            ? JSON.parse(exam.config_json)
            : {
                mcq_single_count: 40,
                mcq_multi_count: 0,
                fill_blank_count: 0,
                essay_count: 0,
                timeLimit: 60,
              };
          return (
            <div key={exam.id} className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
              <div className="flex justify-between items-center mb-4 border-b pb-2">
                <h2 className="text-lg font-bold text-blue-900">{exam.title}</h2>
                <button
                  onClick={async () => {
                    const { ask } = await import("@tauri-apps/plugin-dialog");
                    const confirmed = await ask(
                      "Delete this test configuration? (Documents and concepts will NOT be deleted)",
                      { kind: "warning" },
                    );
                    if (confirmed) {
                      const db = await Database.load("sqlite:topolearn.db");
                      await db.execute("DELETE FROM exam_documents WHERE exam_id = $1", [exam.id]);
                      await db.execute("DELETE FROM exams WHERE id = $1", [exam.id]);
                      loadData();
                    }
                  }}
                  className="text-red-500 hover:text-red-700 text-sm font-bold cursor-pointer"
                >
                  🗑️ Delete Test
                </button>
              </div>

              <div className="grid grid-cols-2 gap-8">
                {/* Configuration Panel */}
                <div className="space-y-3 bg-gray-50 p-4 rounded border border-gray-100 h-fit">
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                    Default Exam Configuration
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">
                        MCQ (Single)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={config.mcq_single_count ?? 20}
                        onChange={(e) =>
                          updateExamConfig(
                            exam.id,
                            exam.config_json,
                            "mcq_single_count",
                            parseInt(e.target.value) || 0,
                          )
                        }
                        className="w-full p-2 text-sm border rounded bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">
                        MCQ (Multiple)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={config.mcq_multi_count ?? 10}
                        onChange={(e) =>
                          updateExamConfig(
                            exam.id,
                            exam.config_json,
                            "mcq_multi_count",
                            parseInt(e.target.value) || 0,
                          )
                        }
                        className="w-full p-2 text-sm border rounded bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">
                        Fill in the Blanks
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={config.fill_blank_count ?? 5}
                        onChange={(e) =>
                          updateExamConfig(
                            exam.id,
                            exam.config_json,
                            "fill_blank_count",
                            parseInt(e.target.value) || 0,
                          )
                        }
                        className="w-full p-2 text-sm border rounded bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">
                        Short Essays
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={config.essay_count ?? 5}
                        onChange={(e) =>
                          updateExamConfig(
                            exam.id,
                            exam.config_json,
                            "essay_count",
                            parseInt(e.target.value) || 0,
                          )
                        }
                        className="w-full p-2 text-sm border rounded bg-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">
                      Time Limit (mins)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={config.timeLimit}
                      onChange={(e) =>
                        updateExamConfig(
                          exam.id,
                          exam.config_json,
                          "timeLimit",
                          parseInt(e.target.value) || 60,
                        )
                      }
                      className="w-full p-2 text-sm border rounded bg-white"
                    />
                  </div>
                </div>

                {/* Material Assignments Panel */}
                <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                    Assign Materials
                  </h3>
                  {documents.map((doc) => {
                    const isMapped = examDocs.some(
                      (ed) => ed.exam_id === exam.id && ed.document_id === doc.id,
                    );
                    return (
                      <label
                        key={doc.id}
                        className={`flex items-center gap-3 p-2 rounded border cursor-pointer transition-colors ${isMapped ? "bg-blue-50 border-blue-200" : "bg-white border-gray-100 hover:bg-gray-50"}`}
                      >
                        <input
                          type="checkbox"
                          checked={isMapped}
                          onChange={() => toggleDocument(exam.id, doc.id, isMapped)}
                          className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                        />
                        <span
                          className={`text-sm ${isMapped ? "font-bold text-blue-800" : "text-gray-700"}`}
                        >
                          {doc.title}
                        </span>
                      </label>
                    );
                  })}
                  {documents.length === 0 && (
                    <p className="text-sm text-gray-500 italic">
                      No documents available. Process a file first.
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
