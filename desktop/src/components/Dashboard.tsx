import Database from "@tauri-apps/plugin-sql";
import { useEffect, useState } from "react";

interface Concept {
  id: string;
  label: string;
  definition: string;
  context: string;
  next_review_date: number;
  ease_factor: number;
  interval: number;
  repetitions: number;
}

export default function Dashboard() {
  const [stats, setStats] = useState({ total: 0, learned: 0 });
  const [dueConcepts, setDueConcepts] = useState<Concept[]>([]);
  const [learnedConceptsList, setLearnedConceptsList] = useState<Concept[]>([]);
  const [reviewingConcept, setReviewingConcept] = useState<Concept | null>(null);
  const [showDefinition, setShowDefinition] = useState(false);
  const [viewingContext, setViewingContext] = useState<Concept | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // AI Grading States
  const [gradingMode, setGradingMode] = useState<"self" | "ai">("self");
  const [userAnswer, setUserAnswer] = useState("");
  const [aiGradeJson, setAiGradeJson] = useState("");

  // Exam Simulator States
  const [examMode, setExamMode] = useState(false);
  const [examJson, setExamJson] = useState("");
  const [examData, setExamData] = useState<any[] | null>(null);
  const [examAnswers, setExamAnswers] = useState<Record<number, number>>({});
  const [examSubmitted, setExamSubmitted] = useState(false);

  useEffect(() => {
    loadDueConcepts();
  }, []);

  const loadDueConcepts = async () => {
    try {
      const db = await Database.load("sqlite:topolearn.db");
      const now = Math.floor(Date.now() / 1000);
      const result = await db.select<Concept[]>(
        "SELECT * FROM concepts WHERE next_review_date <= $1 ORDER BY next_review_date ASC",
        [now],
      );
      setDueConcepts(result);

      const allConcepts = await db.select<Concept[]>("SELECT * FROM concepts");
      // Lowered to >= 1 for MVP testing so one successful review counts as mastered
      const learned = allConcepts.filter((c) => c.repetitions >= 1);
      setLearnedConceptsList(learned);
      setStats({ total: allConcepts.length, learned: learned.length });
    } catch (error) {
      console.error("Failed to load concepts:", error);
    }
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const copyTutorPrompt = (concept: Concept) => {
    const prompt = `I am struggling to understand the concept of "${concept.label}". Its definition is:\n"${concept.definition}"\n\nPlease act as an AI Tutor. Explain it to me simply, provide a real-world analogy, and ask me a follow-up question to check my understanding.`;
    navigator.clipboard.writeText(prompt);
    showToast("Tutor prompt copied! Paste into Gemini.");
  };

  const copyAIGradingPrompt = () => {
    if (!reviewingConcept) return;
    const prompt = `Here is the concept I am studying: "${reviewingConcept.label}".\nThe true definition is: "${reviewingConcept.definition}".\n\nMy answer explaining it is: "${userAnswer}".\n\nPlease grade my understanding from 0 (completely wrong) to 5 (perfect recall and understanding). Provide a brief feedback string. Output ONLY valid JSON, do not wrap in markdown code blocks:\n{ "grade": number, "feedback": "Brief explanation of what I missed or got right..." }`;
    navigator.clipboard.writeText(prompt);
    showToast("Grading prompt copied! Paste into Gemini.");
  };

  const copyExamPrompt = () => {
    const conceptsList = learnedConceptsList.map((c) => `- ${c.label}: ${c.definition}`).join("\n");
    const prompt = `I am ready for a final exam on the following concepts I have mastered:\n${conceptsList}\n\nPlease generate a 3-question comprehensive multiple-choice exam. The questions should be scenario-based and test deep understanding, not just rote memorization. Output STRICTLY in this JSON format without any markdown code blocks:\n[\n  {\n    "question": "Scenario text...",\n    "options": ["Option A", "Option B", "Option C", "Option D"],\n    "correctIndex": 0,\n    "explanation": "Why this is correct..."\n  }\n]`;
    navigator.clipboard.writeText(prompt);
    showToast("Exam prompt copied! Paste into Gemini.");
  };

  const parseExamJson = () => {
    try {
      let cleanJson = examJson;
      const jsonMatch = examJson.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        cleanJson = jsonMatch[0];
      } else {
        cleanJson = examJson
          .replace(/```json/gi, "")
          .replace(/```/g, "")
          .trim();
      }
      const parsed = JSON.parse(cleanJson);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].question) {
        setExamData(parsed);
      } else {
        alert("JSON structure is incorrect. Make sure it matches the requested array format.");
      }
    } catch (e) {
      alert("Failed to parse JSON. Please check the format Gemini provided.");
    }
  };

  const handleGrade = async (quality: number) => {
    if (!reviewingConcept) return;

    let { ease_factor, interval, repetitions } = reviewingConcept;
    ease_factor = ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (ease_factor < 1.3) ease_factor = 1.3;

    if (quality >= 3) {
      if (repetitions === 0) interval = 1;
      else if (repetitions === 1) interval = 6;
      else interval = Math.round(interval * ease_factor);
      repetitions += 1;
    } else {
      repetitions = 0;
      interval = 1;
    }

    const now = Math.floor(Date.now() / 1000);
    const next_review_date = now + interval * 24 * 60 * 60;

    try {
      const db = await Database.load("sqlite:topolearn.db");
      await db.execute(
        "UPDATE concepts SET ease_factor = $1, interval = $2, repetitions = $3, next_review_date = $4 WHERE id = $5",
        [ease_factor, interval, repetitions, next_review_date, reviewingConcept.id],
      );
      setReviewingConcept(null);
      loadDueConcepts();
    } catch (error) {
      console.error("Failed to update SM-2 progress:", error);
      alert("Failed to save progress to the database.");
    }
  };

  const handleAIGradeSubmit = () => {
    try {
      let cleanJson = aiGradeJson;
      const jsonMatch = aiGradeJson.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanJson = jsonMatch[0];
      } else {
        cleanJson = aiGradeJson
          .replace(/```json/gi, "")
          .replace(/```/g, "")
          .trim();
      }
      const parsed = JSON.parse(cleanJson);
      if (typeof parsed.grade === "number" && parsed.grade >= 0 && parsed.grade <= 5) {
        alert(`Gemini Feedback: ${parsed.feedback}\n\nGrade applied: ${parsed.grade}/5`);
        handleGrade(parsed.grade);
      } else {
        alert("Invalid grade format in JSON. Must be a number 0-5.");
      }
    } catch (e) {
      alert("Failed to parse JSON. Please check the format Gemini provided.");
    }
  };

  if (examMode) {
    return (
      <div className="flex flex-col h-full bg-gray-50 p-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Final Exam Simulator</h1>
          <button onClick={() => setExamMode(false)} className="text-blue-600 hover:underline">
            &larr; Back to Dashboard
          </button>
        </div>

        {!examData ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 max-w-2xl mx-auto w-full">
            <p className="text-gray-600 mb-6">
              You have mastered <strong className="text-blue-600">{stats.learned} concepts</strong>!
              Generate a comprehensive scenario-based exam using Gemini to test your true
              understanding.
            </p>
            <button
              onClick={copyExamPrompt}
              className="w-full bg-indigo-100 hover:bg-indigo-200 text-indigo-800 font-semibold py-3 px-4 rounded transition-colors mb-6 flex justify-center items-center gap-2"
            >
              📋 1. Copy Exam Generation Prompt
            </button>
            <label className="block text-sm font-bold text-gray-700 mb-2">
              2. Paste Exam JSON Here:
            </label>
            <textarea
              className="w-full h-40 p-3 font-mono text-xs border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none resize-none bg-gray-50 mb-4"
              placeholder={`[\n  {\n    "question": "...",\n    "options": ["A", "B", "C", "D"],\n    "correctIndex": 0,\n    "explanation": "..."\n  }\n]`}
              value={examJson}
              onChange={(e) => setExamJson(e.target.value)}
            />
            <button
              onClick={parseExamJson}
              disabled={!examJson.trim()}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-bold py-3 px-4 rounded transition-colors"
            >
              3. Start Exam
            </button>
          </div>
        ) : (
          <div className="space-y-6 max-w-3xl mx-auto w-full pb-10">
            {examData.map((q, idx) => (
              <div key={idx} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="font-bold text-lg text-gray-800 mb-4">
                  {idx + 1}. {q.question}
                </h3>
                <div className="space-y-3">
                  {q.options.map((opt: string, optIdx: number) => (
                    <button
                      key={optIdx}
                      onClick={() =>
                        !examSubmitted && setExamAnswers({ ...examAnswers, [idx]: optIdx })
                      }
                      disabled={examSubmitted}
                      className={`w-full text-left p-3 border rounded transition-colors ${
                        examAnswers[idx] === optIdx
                          ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
                          : "border-gray-200 hover:bg-gray-50"
                      } ${
                        examSubmitted && optIdx === q.correctIndex
                          ? "border-green-500! bg-green-50! text-green-900 font-medium"
                          : ""
                      } ${
                        examSubmitted && examAnswers[idx] === optIdx && optIdx !== q.correctIndex
                          ? "border-red-500! bg-red-50! text-red-900 line-through"
                          : ""
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
                {examSubmitted && (
                  <div
                    className={`mt-4 p-4 rounded text-sm ${examAnswers[idx] === q.correctIndex ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}
                  >
                    <strong>Explanation:</strong> {q.explanation}
                  </div>
                )}
              </div>
            ))}

            {!examSubmitted ? (
              <button
                onClick={() => setExamSubmitted(true)}
                disabled={Object.keys(examAnswers).length !== examData.length}
                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-bold py-4 rounded shadow-lg text-lg transition-transform active:scale-95"
              >
                Submit Exam Answers
              </button>
            ) : (
              <button
                onClick={() => {
                  setExamData(null);
                  setExamJson("");
                  setExamAnswers({});
                  setExamSubmitted(false);
                  setExamMode(false);
                }}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded shadow-lg text-lg"
              >
                Finish Review & Return to Dashboard
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 p-6 overflow-y-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-2">Daily Learning Dashboard</h1>
      <p className="text-sm text-gray-600 mb-6">
        Review your due concepts based on the SM-2 spaced repetition algorithm.
      </p>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-blue-700">{stats.total}</span>
          <span className="text-xs text-gray-500 uppercase tracking-wide font-semibold mt-1">
            Total Concepts
          </span>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-green-600">{stats.learned}</span>
          <span className="text-xs text-gray-500 uppercase tracking-wide font-semibold mt-1">
            Concepts Mastered
          </span>
        </div>
      </div>

      {stats.learned >= 3 && (
        <div className="bg-linear-to-r from-indigo-500 to-purple-600 rounded-lg shadow-sm p-4 mb-6 flex justify-between items-center text-white animate-in fade-in slide-in-from-top-4">
          <div>
            <h3 className="font-bold text-lg">Exam Ready</h3>
            <p className="text-sm opacity-90">
              You have mastered enough concepts to simulate a final exam.
            </p>
          </div>
          <button
            onClick={() => setExamMode(true)}
            className="bg-white text-indigo-700 font-bold py-2 px-6 rounded-full hover:bg-indigo-50 shadow transition-transform transform hover:scale-105"
          >
            Start Simulation
          </button>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex justify-between items-center mb-4 border-b pb-2">
          <h2 className="text-lg font-semibold text-gray-700">
            Due for Review ({dueConcepts.length})
          </h2>
          <button onClick={loadDueConcepts} className="text-sm text-blue-600 hover:underline">
            Refresh
          </button>
        </div>

        {dueConcepts.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>You're all caught up! Process a new document to add more concepts.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {dueConcepts.map((concept) => (
              <div
                key={concept.id}
                className="p-4 border border-blue-100 bg-blue-50 rounded-lg shadow-sm flex flex-col justify-between"
              >
                <div>
                  <h3 className="font-bold text-blue-800">{concept.label}</h3>
                  <p className="text-sm text-gray-700 mt-2 line-clamp-3">{concept.definition}</p>
                </div>
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => setViewingContext(concept)}
                    className="flex-1 bg-white border border-gray-300 text-gray-700 py-1.5 text-sm rounded hover:bg-gray-50 transition-colors"
                  >
                    View Context
                  </button>
                  <button
                    onClick={() => {
                      setReviewingConcept(concept);
                      setShowDefinition(false);
                      setGradingMode("self");
                      setUserAnswer("");
                      setAiGradeJson("");
                    }}
                    className="flex-1 bg-blue-600 text-white py-1.5 text-sm rounded hover:bg-blue-700 transition-colors"
                  >
                    Review Now
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {reviewingConcept && (
        <div className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-150 p-6 flex flex-col h-auto max-h-150">
            <div className="flex justify-between items-center mb-4 border-b pb-2 shrink-0">
              <h2 className="text-xl font-bold text-gray-800">Concept Review</h2>
              <button
                onClick={() => setReviewingConcept(null)}
                className="text-gray-500 hover:text-gray-800 font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-2">
              <h3 className="text-2xl font-bold text-blue-900 text-center mb-6">
                {reviewingConcept.label}
              </h3>

              <div className="flex justify-center gap-4 mb-6 border-b border-gray-100 pb-2">
                <button
                  onClick={() => setGradingMode("self")}
                  className={`px-4 py-2 text-sm font-medium ${gradingMode === "self" ? "text-blue-600 border-b-2 border-blue-600" : "text-gray-500 hover:text-gray-700"}`}
                >
                  Self-Assess
                </button>
                <button
                  onClick={() => setGradingMode("ai")}
                  className={`px-4 py-2 text-sm font-medium ${gradingMode === "ai" ? "text-blue-600 border-b-2 border-blue-600" : "text-gray-500 hover:text-gray-700"}`}
                >
                  AI Grader
                </button>
              </div>

              {gradingMode === "self" ? (
                <>
                  {!showDefinition ? (
                    <div className="flex justify-center mt-8">
                      <button
                        onClick={() => setShowDefinition(true)}
                        className="bg-blue-100 text-blue-800 font-semibold py-3 px-8 rounded-lg hover:bg-blue-200 transition-colors"
                      >
                        Show Answer
                      </button>
                    </div>
                  ) : (
                    <div className="animate-in fade-in duration-300">
                      <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 mb-6 text-gray-800">
                        <p className="whitespace-pre-wrap">{reviewingConcept.definition}</p>
                      </div>
                      <div className="flex gap-4 mb-8 justify-center">
                        <button
                          onClick={() => copyTutorPrompt(reviewingConcept)}
                          className="flex items-center gap-2 px-4 py-2 bg-purple-100 text-purple-700 rounded-md hover:bg-purple-200 text-sm font-medium"
                        >
                          <span>🧑‍🏫</span> Ask AI Tutor
                        </button>
                      </div>
                      <h4 className="text-sm font-semibold text-gray-600 text-center mb-3">
                        How well did you remember this?
                      </h4>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                        {[
                          {
                            grade: 0,
                            label: "0",
                            desc: "Blackout",
                            color: "bg-red-500 hover:bg-red-600",
                          },
                          {
                            grade: 1,
                            label: "1",
                            desc: "Wrong",
                            color: "bg-orange-500 hover:bg-orange-600",
                          },
                          {
                            grade: 2,
                            label: "2",
                            desc: "Hard",
                            color: "bg-yellow-500 hover:bg-yellow-600",
                          },
                          {
                            grade: 3,
                            label: "3",
                            desc: "OK",
                            color: "bg-green-400 hover:bg-green-500",
                          },
                          {
                            grade: 4,
                            label: "4",
                            desc: "Good",
                            color: "bg-green-500 hover:bg-green-600",
                          },
                          {
                            grade: 5,
                            label: "5",
                            desc: "Perfect",
                            color: "bg-blue-500 hover:bg-blue-600",
                          },
                        ].map(({ grade, label, desc, color }) => (
                          <button
                            key={grade}
                            onClick={() => handleGrade(grade)}
                            className={`flex flex-col items-center justify-center p-2 rounded text-white transition-transform transform hover:scale-105 ${color}`}
                            title={desc}
                          >
                            <span className="font-bold text-lg">{label}</span>
                            <span className="text-[10px] uppercase tracking-wider opacity-90">
                              {desc}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col gap-5 animate-in fade-in duration-300 px-2">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">
                      1. Explain it in your own words:
                    </label>
                    <textarea
                      className="w-full h-24 p-3 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none resize-none bg-white shadow-inner"
                      placeholder="Type your understanding of the concept here..."
                      value={userAnswer}
                      onChange={(e) => setUserAnswer(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">
                      2. Have Gemini Grade It:
                    </label>
                    <button
                      onClick={copyAIGradingPrompt}
                      disabled={!userAnswer.trim()}
                      className="w-full bg-indigo-100 hover:bg-indigo-200 disabled:bg-gray-100 disabled:text-gray-400 text-indigo-800 font-semibold py-2 px-4 rounded transition-colors flex justify-center items-center gap-2 text-sm border border-indigo-200"
                    >
                      <span>📋</span> Copy Grading Prompt
                    </button>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">
                      3. Paste Result (JSON):
                    </label>
                    <textarea
                      className="w-full h-20 p-3 font-mono text-xs border border-gray-300 rounded focus:ring-2 focus:ring-green-500 outline-none resize-none bg-gray-50 shadow-inner"
                      placeholder='{ "grade": 4, "feedback": "..." }'
                      value={aiGradeJson}
                      onChange={(e) => setAiGradeJson(e.target.value)}
                    />
                  </div>
                  <button
                    onClick={handleAIGradeSubmit}
                    disabled={!aiGradeJson.trim()}
                    className="mt-2 bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white font-bold py-3 px-4 rounded transition-colors shadow"
                  >
                    Apply AI Grade
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {viewingContext && (
        <div className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-150 p-6 flex flex-col h-auto max-h-150">
            <div className="flex justify-between items-center mb-4 border-b pb-2">
              <h2 className="text-xl font-bold text-gray-800">Concept Context</h2>
              <button
                onClick={() => setViewingContext(null)}
                className="text-gray-500 hover:text-gray-800 font-bold text-lg"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-4">
              <h3 className="text-2xl font-bold text-blue-900 mb-4">{viewingContext.label}</h3>
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 text-gray-800">
                <p className="whitespace-pre-wrap mb-4">
                  <span className="font-bold text-gray-600">Definition:</span>
                  <br />
                  {viewingContext.definition}
                </p>
                {viewingContext.context && (
                  <p className="whitespace-pre-wrap border-t border-gray-200 pt-4">
                    <span className="font-bold text-gray-600">Source Paragraph:</span>
                    <br />
                    {viewingContext.context}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {toastMsg && (
        <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white px-6 py-3 rounded-full shadow-lg z-50 animate-in fade-in slide-in-from-bottom-5">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
