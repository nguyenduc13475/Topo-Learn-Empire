import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import { jsonrepair } from "jsonrepair";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Concept {
  id: string;
  label: string;
  definition: string;
  context: string;
  next_review_date: number;
  ease_factor: number;
  interval: number;
  repetitions: number;
  document_id?: string;
  page_num?: number;
  video_timestamp?: number;
}

export default function Dashboard() {
  const [stats, setStats] = useState({ total: 0, learned: 0 });
  const [masteryPercent, setMasteryPercent] = useState(0);
  const [dueConcepts, setDueConcepts] = useState<Concept[]>([]);
  const [newConcepts, setNewConcepts] = useState<Concept[]>([]);
  const [learnedConceptsList, setLearnedConceptsList] = useState<Concept[]>([]);
  const [reviewingConcept, setReviewingConcept] = useState<Concept | null>(null);
  const [viewingContext, setViewingContext] = useState<Concept | null>(null);
  const [viewingDocPath, setViewingDocPath] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Test Limits (Curriculum) States
  const [testLimits, setTestLimits] = useState<any[]>([]);
  const [activeTestLimit, setActiveTestLimit] = useState<string>("all");

  // Quiz Engine & Context States
  const [contextDeepness, setContextDeepness] = useState(0);

  const [quizConfig, setQuizConfig] = useState({
    useOld: true,
    mcq_single_count: 1,
    mcq_multi_count: 0,
    fill_blank_count: 0,
    essay_count: 0,
  });
  const [currentQuiz, setCurrentQuiz] = useState<any[] | null>(null);
  const [quizJsonInput, setQuizJsonInput] = useState("");
  const [quizAnswers, setQuizAnswers] = useState<Record<number, any>>({});
  const [showQuizAnswer, setShowQuizAnswer] = useState(false);
  const [calculatedQuality, setCalculatedQuality] = useState<number | null>(null);
  const [pendingDailyEssayGrading, setPendingDailyEssayGrading] = useState(false);
  const [dailyEssayGradesInput, setDailyEssayGradesInput] = useState("");

  // Exam Simulator States
  const [examMode, setExamMode] = useState(false);
  const [examConfig, setExamConfig] = useState({
    mcq_single_count: 40,
    mcq_multi_count: 0,
    fill_blank_count: 0,
    essay_count: 0,
    timeLimit: 60,
  });
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [pendingEssayGrading, setPendingEssayGrading] = useState(false);
  const [essayGradesInput, setEssayGradesInput] = useState("");
  const [finalExamScore, setFinalExamScore] = useState<{
    totalPoints: number;
    maxPoints: number;
    scale10: number;
  } | null>(null);

  // Auto-sync Exam Config when a test limit is selected
  useEffect(() => {
    if (activeTestLimit !== "all" && testLimits.length > 0) {
      const exam = testLimits.find((ex) => ex.id === activeTestLimit);
      if (exam && exam.config_json) {
        try {
          const conf = JSON.parse(exam.config_json);
          setExamConfig({
            mcq_single_count: conf.mcq_single_count ?? 40,
            mcq_multi_count: conf.mcq_multi_count ?? 0,
            fill_blank_count: conf.fill_blank_count ?? 0,
            essay_count: conf.essay_count ?? 0,
            timeLimit: conf.timeLimit ?? 60,
          });
        } catch (e) {}
      }
    }
  }, [activeTestLimit, testLimits, examMode]);

  const [examJson, setExamJson] = useState("");
  const [examData, setExamData] = useState<any[] | null>(null);
  const [examAnswers, setExamAnswers] = useState<Record<number, any>>({});
  const [examSubmitted, setExamSubmitted] = useState(false);

  // Timer Logic
  useEffect(() => {
    if (examData && timeLeft !== null && timeLeft > 0 && !examSubmitted) {
      const timerId = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
      return () => clearTimeout(timerId);
    } else if (timeLeft === 0 && !examSubmitted) {
      setExamSubmitted(true);
      alert("Time's up! Exam auto-submitted.");
    }
  }, [timeLeft, examData, examSubmitted]);

  useEffect(() => {
    loadDueConcepts();
  }, [activeTestLimit]);

  // Auto-parse Concept Quiz JSON when pasted
  useEffect(() => {
    if (!quizJsonInput.trim() || !reviewingConcept) return;
    try {
      let cleanJson = quizJsonInput
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();
      const startIdx = cleanJson.indexOf("[");
      const endIdx = cleanJson.lastIndexOf("]");
      if (startIdx >= 0 && endIdx >= 0) {
        cleanJson = cleanJson.substring(startIdx, endIdx + 1);
      } else {
        // Fallback if Gemini generated a single object instead of an array
        const sIdx = cleanJson.indexOf("{");
        const eIdx = cleanJson.lastIndexOf("}");
        if (sIdx >= 0 && eIdx >= 0) cleanJson = cleanJson.substring(sIdx, eIdx + 1);
      }

      const parsed = JSON.parse(jsonrepair(cleanJson));
      const quizArray = Array.isArray(parsed) ? parsed : [parsed];

      // Normalize Gemini's output for mcq_multi to prevent .includes() crash and fix hallucinated types
      quizArray.forEach((q: any) => {
        if (q.type === "mcq" || q.type === "multiple_choice") q.type = "mcq_single";
        if (q.type === "mcq_multi" && !Array.isArray(q.correct_answer)) {
          q.correct_answer = q.correct_answer !== undefined ? [q.correct_answer] : [];
        }
      });

      if (quizArray.length > 0 && quizArray[0].question) {
        setCurrentQuiz(quizArray);
        setQuizJsonInput("");
        saveQuizToDB(quizArray); // Save for future reuse
        showToast("✅ Quiz generated and loaded!");
      }
    } catch (e) {
      // Silently fail, wait for correct format
    }
  }, [quizJsonInput, reviewingConcept]);

  // Auto-parse Final Exam JSON when pasted
  useEffect(() => {
    if (!examJson.trim() || examData) return;
    try {
      let cleanJson = examJson
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();
      const startIdx = cleanJson.indexOf("[");
      const endIdx = cleanJson.lastIndexOf("]");
      if (startIdx >= 0 && endIdx >= 0) {
        cleanJson = cleanJson.substring(startIdx, endIdx + 1);
      }

      const parsed = JSON.parse(jsonrepair(cleanJson));

      // Normalize mcq_multi answers and hallucinated types
      if (Array.isArray(parsed)) {
        parsed.forEach((q: any) => {
          if (q.type === "mcq" || q.type === "multiple_choice") q.type = "mcq_single";
          if (q.type === "mcq_multi" && !Array.isArray(q.correct_answer)) {
            q.correct_answer = q.correct_answer !== undefined ? [q.correct_answer] : [];
          }
        });
      }

      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].question) {
        setExamData(parsed);
        setExamJson("");
        showToast("✅ Exam successfully loaded!");
      }
    } catch (e) {
      // Silently fail
    }
  }, [examJson, examData]);

  // Auto-parse Essay Grades JSON when pasted
  useEffect(() => {
    if (!essayGradesInput.trim() || !pendingEssayGrading) return;
    try {
      let cleanJson = essayGradesInput
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();
      const startIdx = cleanJson.indexOf("[");
      const endIdx = cleanJson.lastIndexOf("]");
      if (startIdx >= 0 && endIdx >= 0) {
        cleanJson = cleanJson.substring(startIdx, endIdx + 1);
      }
      const parsedScores = JSON.parse(jsonrepair(cleanJson));
      if (Array.isArray(parsedScores)) {
        setEssayGradesInput("");
        finalizeExam(parsedScores);
      }
    } catch (e) {
      // Silently fail, wait for correct format
    }
  }, [essayGradesInput, pendingEssayGrading]);

  // Auto-parse Daily Quiz Essay Grades JSON
  useEffect(() => {
    if (!dailyEssayGradesInput.trim() || !pendingDailyEssayGrading || !currentQuiz) return;
    try {
      let cleanJson = dailyEssayGradesInput
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();
      const startIdx = cleanJson.indexOf("[");
      const endIdx = cleanJson.lastIndexOf("]");
      if (startIdx >= 0 && endIdx >= 0) cleanJson = cleanJson.substring(startIdx, endIdx + 1);
      const parsedScores = JSON.parse(jsonrepair(cleanJson));

      if (Array.isArray(parsedScores)) {
        setDailyEssayGradesInput("");
        finalizeDailyQuiz(parsedScores);
      }
    } catch (e) {
      // Silently fail
    }
  }, [dailyEssayGradesInput, pendingDailyEssayGrading, currentQuiz]);

  const finalizeDailyQuiz = (essayScores: number[]) => {
    let correctCount = 0;
    let totalGradable = 0;
    let essayScoreIndex = 0;

    currentQuiz?.forEach((q: any, idx: number) => {
      if (q.type === "mcq_single" || q.type === "mcq" || q.type === "multiple_choice") {
        totalGradable += 10;
        if (quizAnswers[idx] === q.correct_answer) correctCount += 10;
      } else if (q.type === "mcq_multi") {
        totalGradable += 10;
        const userAns = (quizAnswers[idx] || []).sort().join(",");
        const correctAns = (q.correct_answer || []).sort().join(",");
        if (userAns === correctAns) correctCount += 10;
      } else if (q.type === "fill_blank" || q.type === "fill") {
        totalGradable += 10;
        const userAns = (quizAnswers[idx] || "").toString().trim().toLowerCase();
        const correctAns = (q.correct_answer || "").toString().trim().toLowerCase();
        if (userAns === correctAns) correctCount += 10;
      } else if (q.type === "essay") {
        totalGradable += 10;
        const score = essayScores[essayScoreIndex] !== undefined ? essayScores[essayScoreIndex] : 0;
        correctCount += score;
        essayScoreIndex++;
      }
    });

    let quality = 1;
    if (totalGradable > 0) {
      const scoreRatio = correctCount / totalGradable;
      if (scoreRatio >= 0.9) quality = 5;
      else if (scoreRatio >= 0.7) quality = 4;
      else if (scoreRatio >= 0.5) quality = 3;
      else if (scoreRatio > 0.2) quality = 2;
    }
    setCalculatedQuality(quality);
    setPendingDailyEssayGrading(false);
    setShowQuizAnswer(true);
  };

  const loadDueConcepts = async () => {
    try {
      const db = await Database.load("sqlite:topolearn.db");
      const now = Math.floor(Date.now() / 1000);

      // Fetch Test Limits
      const exams = await db.select<any[]>("SELECT * FROM exams ORDER BY title ASC");
      const examDocs = await db.select<any[]>("SELECT * FROM exam_documents");
      setTestLimits(exams);

      const allConcepts = await db.select<Concept[]>("SELECT * FROM concepts");

      // Filter Concepts based on Active Test Limit
      let filteredConcepts = allConcepts;
      if (activeTestLimit !== "all") {
        const validDocIds = new Set(
          examDocs.filter((ed) => ed.exam_id === activeTestLimit).map((ed) => ed.document_id),
        );
        filteredConcepts = allConcepts.filter(
          // Include concepts that belong to the test's documents, OR concepts that are global (manually added)
          (c) => (c.document_id && validDocIds.has(c.document_id)) || !c.document_id,
        );
      }

      const learned = filteredConcepts.filter((c) => c.repetitions >= 1);
      const due = filteredConcepts
        .filter((c) => c.repetitions > 0 && c.next_review_date <= now)
        .sort((a, b) => a.next_review_date - b.next_review_date);

      setDueConcepts(due);
      setLearnedConceptsList(learned);

      const tot = filteredConcepts.length;
      const lrn = learned.length;
      setStats({ total: tot, learned: lrn });
      setMasteryPercent(tot > 0 ? (lrn / tot) * 100 : 0);

      // Topological Sort for New Concepts
      const unlearned = filteredConcepts.filter((c) => c.repetitions === 0);
      const edges = await db.select<{ source: string; target: string }[]>("SELECT * FROM edges");

      const inDegree: Record<string, number> = {};
      unlearned.forEach((c) => (inDegree[c.id] = 0));
      const unlearnedIds = new Set(unlearned.map((c) => c.id));
      // Check against ALL unlearned concepts, not just ones in the current test limit filter
      const allUnlearnedIds = new Set(
        allConcepts.filter((c) => c.repetitions === 0).map((c) => c.id),
      );

      edges.forEach((edge) => {
        if (unlearnedIds.has(edge.target) && allUnlearnedIds.has(edge.source)) {
          inDegree[edge.target] = (inDegree[edge.target] || 0) + 1;
        }
      });

      const readyToLearn = unlearned.filter((c) => inDegree[c.id] === 0);
      setNewConcepts(readyToLearn);
    } catch (error) {
      console.error("Failed to load concepts:", error);
    }
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const handleViewContext = async (concept: Concept) => {
    setViewingContext(concept);
    if (concept.document_id) {
      try {
        const db = await Database.load("sqlite:topolearn.db");
        const docs = await db.select<{ file_path: string }[]>(
          "SELECT file_path FROM documents WHERE id = $1",
          [concept.document_id],
        );
        if (docs.length > 0) setViewingDocPath(docs[0].file_path);
      } catch (e) {
        console.error(e);
      }
    } else {
      setViewingDocPath(null);
    }
  };

  const fetchDocContext = async (concept: Concept) => {
    if (!concept.document_id) return "";
    try {
      const db = await Database.load("sqlite:topolearn.db");
      let contextText = "";

      // 1. Determine if it's a video or PDF
      let isVideo = false;
      let targetChunkIndex = -1;

      if (concept.page_num !== undefined && concept.page_num !== null) {
        const target = await db.select<{ chunk_index: number }[]>(
          "SELECT chunk_index FROM chunks WHERE document_id = $1 AND page_start <= $2 AND page_end >= $2 LIMIT 1",
          [concept.document_id, concept.page_num],
        );
        if (target.length > 0) targetChunkIndex = target[0].chunk_index;
      } else if (concept.video_timestamp !== undefined && concept.video_timestamp !== null) {
        isVideo = true;
      }

      // 2. Fetch context based on document type
      if (isVideo) {
        // For video, return the FULL document text, ignore deepness to ensure max context for exams & tutors
        const docs = await db.select<{ extracted_text: string }[]>(
          "SELECT extracted_text FROM documents WHERE id = $1",
          [concept.document_id],
        );
        if (docs.length > 0 && docs[0].extracted_text) {
          contextText = docs[0].extracted_text;
        }
      } else if (targetChunkIndex !== -1) {
        const minIndex = targetChunkIndex - contextDeepness;
        const maxIndex = targetChunkIndex + contextDeepness;

        const chunks = await db.select<
          { chunk_index: number; chunk_type: string; extracted_text: string }[]
        >(
          "SELECT chunk_index, chunk_type, extracted_text FROM chunks WHERE document_id = $1 AND chunk_index >= $2 AND chunk_index <= $3 ORDER BY chunk_index ASC",
          [concept.document_id, minIndex, maxIndex],
        );

        if (chunks.length > 0) {
          contextText = chunks
            .map((c) => {
              const marker =
                c.chunk_index === targetChunkIndex
                  ? ">> [TARGET CONCEPT LOCATION] <<"
                  : `[Surrounding Context: Chunk ${c.chunk_index} (${c.chunk_type})]`;
              return `${marker}\n${c.extracted_text}`;
            })
            .join("\n\n...\n\n");
        }
      }

      // 3. Fallback: If no chunk maps directly
      if (!contextText) {
        const docs = await db.select<{ extracted_text: string }[]>(
          "SELECT extracted_text FROM documents WHERE id = $1",
          [concept.document_id],
        );
        if (docs.length > 0 && docs[0].extracted_text) {
          contextText =
            docs[0].extracted_text.substring(0, 8000) +
            "... [Truncated due to missing chunk mapping]";
        }
      }

      return contextText
        ? `\n\n--- DOCUMENT CONTEXT ---\n${contextText}\n-----------------------\n`
        : "";
    } catch {
      return "";
    }
  };

  // Add Time Travel Dev Tool
  const handleTimeTravel = async () => {
    try {
      const db = await Database.load("sqlite:topolearn.db");
      await db.execute("UPDATE concepts SET next_review_date = next_review_date - 86400");
      loadDueConcepts();
      showToast("⏱️ Time traveled +1 Day! Check Due Concepts.");
    } catch (e) {
      console.error(e);
    }
  };

  const copyTutorPrompt = async (concept: Concept) => {
    const contextStr = await fetchDocContext(concept);
    const prompt = `I am struggling to understand the concept of "${concept.label}". Its definition is:\n"${concept.definition}"\n${contextStr}\nPlease act as an AI Tutor. Use the provided document context to explain it to me simply, provide a real-world analogy, and ask me a follow-up question.`;
    try {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(prompt);
      await invoke("focus_and_paste");
      showToast("✅ Copied! Click input in Gemini and press Cmd+V / Ctrl+V.");
    } catch (err) {
      navigator.clipboard.writeText(prompt);
      showToast("Tutor prompt copied! Paste into Gemini.");
    }
  };

  // --- QUIZ ENGINE LOGIC ---
  const loadOrGenerateQuiz = async (tryOld: boolean) => {
    if (!reviewingConcept) return;
    setCurrentQuiz(null);
    setQuizAnswers({});
    setShowQuizAnswer(false);
    setCalculatedQuality(null);
    setPendingDailyEssayGrading(false);
    setDailyEssayGradesInput("");

    if (tryOld) {
      try {
        const db = await Database.load("sqlite:topolearn.db");
        const oldQuizzes = await db.select<any[]>(
          "SELECT quiz_json FROM saved_quizzes WHERE concept_id = $1 ORDER BY created_at DESC",
          [reviewingConcept.id],
        );

        if (oldQuizzes.length > 0) {
          const parsed = JSON.parse(oldQuizzes[0].quiz_json);
          setCurrentQuiz(Array.isArray(parsed) ? parsed : [parsed]);
          showToast("🔄 Reused saved quiz!");
          return;
        } else {
          showToast("⚠️ No saved quiz found! Generating a new one instead...");
        }
      } catch (e) {
        console.error("Failed loading old quiz", e);
      }
    }

    // Auto-generate if not using old or old not found
    const contextStr = await fetchDocContext(reviewingConcept);
    const prompt = `I am studying the concept "${reviewingConcept.label}" (Definition: "${reviewingConcept.definition}").${contextStr}
Generate a comprehensive quiz based heavily on the provided document context to test my deep understanding of this single concept with exactly these question counts:
- ${quizConfig.mcq_single_count} Multiple Choice (Single correct answer)
- ${quizConfig.mcq_multi_count} Multiple Choice (Multiple correct answers)
- ${quizConfig.fill_blank_count} Fill in the blanks
- ${quizConfig.essay_count} Short Essays

Output STRICTLY as a JSON ARRAY without markdown code blocks:
[
  {
    "type": "mcq_single", // "mcq_single", "mcq_multi", "fill_blank", or "essay"
    "question": "Scenario text...",
    "options": ["Opt A", "Opt B", "Opt C", "Opt D"], // Include ONLY if type is mcq_single or mcq_multi
    "correct_answer": 0 // Integer index (0-3) for mcq_single, Array of indices [0, 2] for mcq_multi, exact string for fill_blank, or grading rubric for essay
  }
]`;

    try {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(prompt);
      await invoke("focus_and_paste");
      showToast("🤖 Auto-pasted Quiz Request into Gemini! Waiting for result...");
    } catch (err) {
      navigator.clipboard.writeText(prompt);
      showToast("Quiz prompt copied! Paste into Gemini.");
    }
  };

  const saveQuizToDB = async (quizData: any) => {
    try {
      const db = await Database.load("sqlite:topolearn.db");
      await db.execute(
        "INSERT INTO saved_quizzes (id, concept_id, quiz_json) VALUES ($1, $2, $3)",
        [crypto.randomUUID(), reviewingConcept?.id, JSON.stringify(quizData)],
      );
    } catch (e) {
      console.error("Failed saving quiz", e);
    }
  };

  // --- SM-2 EVALUATION ENGINE ---
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
      setReviewingConcept(null); // Auto-close modal to move on!
      loadDueConcepts();
    } catch (error) {
      alert("Failed to save progress to the database.");
    }
  };

  // --- EXAM SIMULATOR ---
  const autoStartExamPrompt = async () => {
    const conceptsList = learnedConceptsList
      .map((c) => `- ID: "${c.id}" | ${c.label}: ${c.definition}`)
      .join("\n");
    if (conceptsList.trim() === "") {
      alert(
        "You haven't mastered any concepts yet for this test limit! Keep crushing those flashcards first.",
      );
      return;
    }

    const prompt = `I am ready for a final exam on the following concepts I have mastered in this curriculum:\n${conceptsList}\n\nPlease generate a comprehensive exam with EXACTLY the following question counts:
- ${examConfig.mcq_single_count} Multiple Choice (Single correct answer)
- ${examConfig.mcq_multi_count} Multiple Choice (Multiple correct answers)
- ${examConfig.fill_blank_count} Fill in the blanks
- ${examConfig.essay_count} Short Essays

The questions should be scenario-based and test deep understanding. Output STRICTLY in this JSON format without any markdown code blocks:
[
  {
    "concept_id": "EXACT_ID_FROM_LIST_ABOVE",
    "type": "mcq_single", // "mcq_single", "mcq_multi", "fill_blank", or "essay"
    "question": "Scenario text...",
    "options": ["Opt A", "Opt B", "Opt C", "Opt D"], // Include ONLY if type is mcq_single or mcq_multi
    "correct_answer": 0, // Integer index (0-3) for mcq_single, Array of indices [0, 2] for mcq_multi, exact string for fill_blank, or grading rubric for essay
    "explanation": "Why this is correct / Grading rubric for essay"
  }
]`;

    setTimeLeft(examConfig.timeLimit > 0 ? examConfig.timeLimit * 60 : null);

    try {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(prompt);
      await invoke("focus_and_paste");
      showToast("🤖 Auto-pasted Exam request into Gemini!");
    } catch (err) {
      navigator.clipboard.writeText(prompt);
      showToast("Exam prompt copied! Paste into Gemini.");
    }
  };

  const handleExamSubmit = async () => {
    if (!examData) return;
    setExamSubmitted(true);

    const hasEssays = examData.some((q) => q.type === "essay");

    if (hasEssays) {
      setPendingEssayGrading(true);
      const essayQuestions = examData
        .map((q, idx) => {
          if (q.type === "essay") {
            return `Question ${idx + 1}: ${q.question}\nRubric/Expected: ${q.correct_answer || q.explanation}\nMy Answer: ${examAnswers[idx] || "No answer provided."}`;
          }
          return null;
        })
        .filter(Boolean)
        .join("\n\n---\n\n");

      const prompt = `I have taken a final exam. Please grade my essay answers STRICTLY on a scale of 0 to 10 based on how well they match the provided rubrics.

${essayQuestions}

Output STRICTLY as a valid JSON array of numbers representing the scores in order. Do not include markdown blocks or explanations.
Example: [8, 10, 5]`;

      try {
        const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
        await writeText(prompt);
        await invoke("focus_and_paste");
        showToast("🤖 Auto-pasted Essay Grading request into Gemini!");
      } catch (err) {
        navigator.clipboard.writeText(prompt);
        showToast("Essay grading prompt copied! Paste into Gemini.");
      }
    } else {
      await finalizeExam([]);
    }
  };

  const finalizeExam = async (essayScores: number[]) => {
    setExamSubmitted(true);
    setPendingEssayGrading(false);
    if (!examData) return;

    try {
      const db = await Database.load("sqlite:topolearn.db");
      const now = Math.floor(Date.now() / 1000);

      let totalPoints = 0;
      let maxPoints = examData.length * 10;
      let essayScoreIndex = 0;

      for (let idx = 0; idx < examData.length; idx++) {
        const q = examData[idx];
        if (!q.concept_id) continue;

        let points = 0;
        let quality = 1;

        if (q.type === "essay") {
          points = essayScores[essayScoreIndex] !== undefined ? essayScores[essayScoreIndex] : 0;
          essayScoreIndex++;
          if (points >= 9) quality = 5;
          else if (points >= 7) quality = 4;
          else if (points >= 5) quality = 3;
          else if (points >= 3) quality = 2;
          else quality = 1;
        } else {
          let isCorrect = false;
          if (q.type === "mcq_single") {
            isCorrect = examAnswers[idx] === q.correct_answer;
          } else if (q.type === "mcq_multi") {
            const userAns = (examAnswers[idx] || []).sort().join(",");
            const correctAns = (q.correct_answer || []).sort().join(",");
            isCorrect = userAns === correctAns;
          } else if (q.type === "fill_blank") {
            const userAns = (examAnswers[idx] || "").toString().trim().toLowerCase();
            const correctAns = (q.correct_answer || "").toString().trim().toLowerCase();
            isCorrect = userAns === correctAns;
          }
          points = isCorrect ? 10 : 0;
          quality = isCorrect ? 5 : 1;
        }
        totalPoints += points;

        const concepts = await db.select<Concept[]>("SELECT * FROM concepts WHERE id = $1", [
          q.concept_id,
        ]);
        if (concepts.length === 0) continue;

        let { ease_factor, interval, repetitions } = concepts[0];
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

        const next_review_date = now + interval * 24 * 60 * 60;
        await db.execute(
          "UPDATE concepts SET ease_factor = $1, interval = $2, repetitions = $3, next_review_date = $4 WHERE id = $5",
          [ease_factor, interval, repetitions, next_review_date, q.concept_id],
        );
      }

      setFinalExamScore({
        totalPoints,
        maxPoints,
        scale10: parseFloat(((totalPoints / maxPoints) * 10).toFixed(2)),
      });
      loadDueConcepts();
      showToast("📈 Exam finalized & learning progress updated!");
    } catch (e) {
      console.error("Failed to update SM-2 progress from exam:", e);
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
            <p className="text-gray-600 mb-4">
              You have mastered <strong className="text-blue-600">{stats.learned} concepts</strong>{" "}
              in this curriculum! Configure your comprehensive exam below.
            </p>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6 bg-gray-50 p-4 rounded border border-gray-100">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">MCQ (Single)</label>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={examConfig.mcq_single_count}
                  onChange={(e) =>
                    setExamConfig({
                      ...examConfig,
                      mcq_single_count: parseInt(e.target.value) || 0,
                    })
                  }
                  className="w-full p-2 text-sm border rounded bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">MCQ (Multi)</label>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={examConfig.mcq_multi_count}
                  onChange={(e) =>
                    setExamConfig({ ...examConfig, mcq_multi_count: parseInt(e.target.value) || 0 })
                  }
                  className="w-full p-2 text-sm border rounded bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Fill in Blanks</label>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={examConfig.fill_blank_count}
                  onChange={(e) =>
                    setExamConfig({
                      ...examConfig,
                      fill_blank_count: parseInt(e.target.value) || 0,
                    })
                  }
                  className="w-full p-2 text-sm border rounded bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Short Essays</label>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={examConfig.essay_count}
                  onChange={(e) =>
                    setExamConfig({ ...examConfig, essay_count: parseInt(e.target.value) || 0 })
                  }
                  className="w-full p-2 text-sm border rounded bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Time Limit (mins)
                </label>
                <input
                  type="number"
                  min="0"
                  max="120"
                  value={examConfig.timeLimit}
                  onChange={(e) =>
                    setExamConfig({ ...examConfig, timeLimit: parseInt(e.target.value) || 0 })
                  }
                  className="w-full p-2 text-sm border rounded bg-white"
                />
              </div>
            </div>

            <button
              onClick={autoStartExamPrompt}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded transition-transform transform hover:scale-105 mb-6 shadow-md flex justify-center gap-2"
            >
              🤖 1. Auto-Ask Gemini to Generate Exam
            </button>
            <label className="block text-sm font-bold text-gray-700 mb-2">
              2. Wait for Gemini to finish, then Magic Paste:
            </label>
            <button
              onClick={async () => {
                try {
                  const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
                  const text = await readText();
                  if (text) setExamJson(text);
                  else alert("Clipboard is empty!");
                } catch (err) {
                  alert("Failed to read clipboard");
                }
              }}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-4 rounded shadow-lg transition-transform transform hover:scale-105 flex justify-center gap-2 mb-4"
            >
              ✨ Magic Paste Exam JSON & Start
            </button>
          </div>
        ) : (
          <div className="space-y-6 max-w-3xl mx-auto w-full pb-10 relative">
            {timeLeft !== null && (
              <div
                className={`sticky top-0 z-10 p-3 rounded-b-lg shadow-md mb-6 font-mono text-xl text-center font-bold tracking-wider backdrop-blur ${timeLeft < 60 ? "bg-red-500/90 text-white animate-pulse" : "bg-white/90 text-gray-800 border-b border-gray-200"}`}
              >
                ⏳ {formatTime(timeLeft)}
              </div>
            )}
            {examData.map((q, idx) => (
              <div key={idx} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h3 className="font-bold text-lg text-gray-800 mb-4">
                  {idx + 1}. {q.question}
                </h3>
                <div className="space-y-3">
                  {q.type === "mcq_single" || q.type === "mcq_multi" || q.options ? (
                    q.options.map((opt: string, optIdx: number) => {
                      const isMulti = q.type === "mcq_multi";
                      const isSelected = isMulti
                        ? (examAnswers[idx] || []).includes(optIdx)
                        : examAnswers[idx] === optIdx;
                      const isCorrectOpt = isMulti
                        ? (q.correct_answer || []).includes(optIdx)
                        : q.correct_answer === optIdx;

                      let btnClass = isSelected
                        ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
                        : "border-gray-200 hover:bg-gray-50";
                      if (examSubmitted) {
                        if (isCorrectOpt)
                          btnClass = "border-green-500! bg-green-50! text-green-900 font-medium";
                        else if (isSelected && !isCorrectOpt)
                          btnClass = "border-red-500! bg-red-50! text-red-900 line-through";
                      }

                      return (
                        <button
                          key={optIdx}
                          onClick={() => {
                            if (!examSubmitted) {
                              if (isMulti) {
                                const curr = examAnswers[idx] || [];
                                setExamAnswers({
                                  ...examAnswers,
                                  [idx]: curr.includes(optIdx)
                                    ? curr.filter((i: number) => i !== optIdx)
                                    : [...curr, optIdx],
                                });
                              } else {
                                setExamAnswers({ ...examAnswers, [idx]: optIdx });
                              }
                            }
                          }}
                          disabled={examSubmitted}
                          className={`w-full text-left p-3 border rounded transition-colors ${btnClass}`}
                        >
                          {opt}
                        </button>
                      );
                    })
                  ) : q.type === "fill_blank" ? (
                    <input
                      type="text"
                      placeholder="Type your fill in the blank answer here..."
                      className="w-full p-3 border rounded outline-none focus:ring-2 focus:ring-blue-500"
                      disabled={examSubmitted}
                      onChange={(e) => setExamAnswers({ ...examAnswers, [idx]: e.target.value })}
                      value={examAnswers[idx] || ""}
                    />
                  ) : (
                    <textarea
                      placeholder="Type your essay answer here..."
                      className="w-full h-32 p-3 border rounded outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      disabled={examSubmitted}
                      onChange={(e) => setExamAnswers({ ...examAnswers, [idx]: e.target.value })}
                      value={examAnswers[idx] || ""}
                    />
                  )}
                </div>
                {examSubmitted && (
                  <div
                    className={`mt-4 p-4 rounded text-sm ${q.type === "mcq_single" || q.type === "mcq_multi" ? "bg-blue-50 border border-blue-200" : "bg-blue-50 border border-blue-200"}`}
                  >
                    <strong>
                      {q.type === "mcq_single" || q.type === "mcq_multi"
                        ? "Explanation"
                        : "Correct Answer/Grading Rubric"}
                      :
                    </strong>{" "}
                    {q.explanation}
                  </div>
                )}
              </div>
            ))}

            {!examSubmitted && !pendingEssayGrading && (
              <button
                onClick={handleExamSubmit}
                className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-4 rounded shadow-lg text-lg transition-transform active:scale-95 cursor-pointer"
              >
                ✨ Submit Exam Answers & Magic Grade Essays{" "}
              </button>
            )}

            {pendingEssayGrading && (
              <div className="bg-blue-50 border border-blue-200 p-6 rounded-lg text-center shadow-sm">
                <h4 className="text-xl font-bold text-blue-800 mb-2">Grading Essays...</h4>
                <p className="text-blue-600 mb-4 text-sm">
                  The essay questions and your answers have been copied to your clipboard. Paste
                  them into Gemini to get your grades (0-10), then copy the resulting JSON array.
                </p>
                <button
                  onClick={async () => {
                    try {
                      const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
                      const text = await readText();
                      if (text) setEssayGradesInput(text);
                      else alert("Clipboard is empty!");
                    } catch (err) {
                      alert("Failed to read clipboard");
                    }
                  }}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-full shadow-md transition-transform transform hover:scale-105 cursor-pointer flex items-center justify-center gap-2 mx-auto"
                >
                  ✨ Magic Paste Essay Grades JSON
                </button>
              </div>
            )}

            {examSubmitted && !pendingEssayGrading && (
              <div className="space-y-4">
                {finalExamScore && (
                  <div className="bg-indigo-50 border border-indigo-200 p-6 rounded-lg text-center shadow-sm">
                    <h3 className="text-2xl font-bold text-indigo-900 mb-1">Final Score</h3>
                    <p className="text-4xl font-black text-indigo-600 mb-2">
                      {finalExamScore.scale10} / 10
                    </p>
                    <p className="text-sm text-indigo-700 font-medium">
                      ({finalExamScore.totalPoints} out of {finalExamScore.maxPoints} possible
                      points)
                    </p>
                  </div>
                )}
                <button
                  onClick={() => {
                    setExamData(null);
                    setExamJson("");
                    setExamAnswers({});
                    setExamSubmitted(false);
                    setFinalExamScore(null);
                    setExamMode(false);
                  }}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded shadow-lg text-lg cursor-pointer"
                >
                  Finish Review & Return to Dashboard
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 p-6 overflow-y-auto">
      <div className="flex justify-between items-end mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-gray-800">Daily Learning Dashboard</h1>
            <button
              onClick={handleTimeTravel}
              className="px-2 py-1 bg-purple-100 text-purple-800 hover:bg-purple-200 rounded text-xs font-bold transition-colors border border-purple-200 cursor-pointer"
              title="Dev Tool: Fast forward time 1 day to test Spaced Repetition"
            >
              ⏱️ +1 Day
            </button>
          </div>
          <p className="text-sm text-gray-600">
            Review your due concepts based on the SM-2 spaced repetition algorithm.
          </p>
        </div>
        <div className="flex flex-col">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
            Context Deepness (± Chunks)
          </label>
          <input
            type="number"
            min="0"
            max="20"
            value={contextDeepness}
            onChange={(e) => setContextDeepness(parseInt(e.target.value) || 0)}
            className="p-2 border border-gray-300 rounded shadow-sm bg-white text-sm outline-none font-medium text-blue-800 min-w-25"
            title="How many surrounding chunks to include for AI Tutor/Quiz context (0 = strictly current chunk)"
          />
        </div>
        <div className="flex flex-col items-end">
          <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">
            Curriculum / Test Limit
          </label>
          <select
            value={activeTestLimit}
            onChange={(e) => setActiveTestLimit(e.target.value)}
            className="p-2 border border-gray-300 rounded shadow-sm bg-white text-sm outline-none cursor-pointer font-medium text-blue-800 min-w-50"
          >
            <option value="all">🌍 All Subjects (Global)</option>
            {testLimits.map((ex) => (
              <option key={ex.id} value={ex.id}>
                📝 {ex.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-blue-700">{stats.total}</span>
          <span className="text-xs text-gray-500 uppercase tracking-wide font-semibold mt-1">
            Total Concepts in Scope
          </span>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 flex flex-col items-center justify-center relative overflow-hidden">
          <div
            className="absolute bottom-0 left-0 h-1 bg-green-400"
            style={{ width: `${masteryPercent}%` }}
          ></div>
          <span className="text-3xl font-bold text-green-600">{stats.learned}</span>
          <span className="text-xs text-gray-500 uppercase tracking-wide font-semibold mt-1">
            Concepts Mastered ({masteryPercent.toFixed(0)}%)
          </span>
        </div>
      </div>

      {masteryPercent >= 90 && stats.total > 0 && activeTestLimit !== "all" && (
        <div className="bg-linear-to-r from-indigo-500 to-purple-600 rounded-lg shadow-sm p-4 mb-6 flex justify-between items-center text-white animate-in fade-in slide-in-from-top-4">
          <div>
            <h3 className="font-bold text-lg">🎖️ Test Readiness Reached</h3>
            <p className="text-sm opacity-90">
              You have mastered 90%+ of the concepts in this curriculum limit.
            </p>
          </div>
          <button
            onClick={() => setExamMode(true)}
            className="bg-white text-indigo-700 font-bold py-2 px-6 rounded-full hover:bg-indigo-50 shadow transition-transform transform hover:scale-105 cursor-pointer"
          >
            Take Final Exam
          </button>
        </div>
      )}

      {/* Due For Review Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
        <div className="flex justify-between items-center mb-4 border-b pb-2">
          <h2 className="text-lg font-semibold text-gray-700">
            Due for Review ({dueConcepts.length})
          </h2>
          <button onClick={loadDueConcepts} className="text-sm text-blue-600 hover:underline">
            Refresh
          </button>
        </div>

        {dueConcepts.length === 0 ? (
          <div className="text-center py-6 text-gray-500 text-sm">
            <p>No concepts due for review in this scope right now. Great job!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {dueConcepts.map((concept) => (
              <div
                key={concept.id}
                className="p-4 border border-blue-100 bg-blue-50 rounded-lg shadow-sm flex flex-col justify-between cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => {
                  setReviewingConcept(concept);
                  setCurrentQuiz(null);
                  setShowQuizAnswer(false);
                  setQuizAnswers({});
                  setCalculatedQuality(null);
                }}
              >
                <div>
                  <h3 className="font-bold text-blue-800">{concept.label}</h3>
                  <div className="text-sm text-gray-700 mt-2 line-clamp-2 opacity-90">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{concept.definition}</ReactMarkdown>
                  </div>
                </div>
                <div className="mt-3 pt-2 border-t border-blue-200/50 flex justify-between text-xs font-semibold text-blue-600">
                  <span>Click to evaluate &rarr;</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New Concepts to Learn */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex justify-between items-center mb-4 border-b pb-2">
          <h2 className="text-lg font-semibold text-gray-700">
            Ready to Learn ({newConcepts.length})
          </h2>
          <span className="text-xs bg-purple-100 text-purple-800 px-2 py-1 rounded font-medium">
            Prerequisites Met
          </span>
        </div>

        {newConcepts.length === 0 ? (
          <div className="text-center py-6 text-gray-500 text-sm">
            <p>No new concepts available in this curriculum. Expand your knowledge graph!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {newConcepts.map((concept) => (
              <div
                key={concept.id}
                className="p-4 border border-purple-100 bg-purple-50 rounded-lg shadow-sm flex flex-col justify-between cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => {
                  setReviewingConcept(concept);
                  setCurrentQuiz(null);
                  setShowQuizAnswer(false);
                  setQuizAnswers({});
                  setCalculatedQuality(null);
                }}
              >
                <div>
                  <h3 className="font-bold text-purple-800">{concept.label}</h3>
                  <div className="text-sm text-gray-700 mt-2 line-clamp-2 opacity-90">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{concept.definition}</ReactMarkdown>
                  </div>
                </div>
                <div className="mt-3 pt-2 border-t border-purple-200/50 flex justify-between text-xs font-semibold text-purple-600">
                  <span>Click to Learn &rarr;</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MASTER CONCEPT REVIEW WORKFLOW MODAL */}
      {reviewingConcept && (
        <div className="absolute inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-200 p-6 flex flex-col h-auto max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95">
            {/* Header */}
            <div className="flex justify-between items-center mb-4 border-b border-gray-200 pb-3">
              <div>
                <h2 className="text-2xl font-bold text-blue-900">{reviewingConcept.label}</h2>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mt-1">
                  Concept Workflow
                </p>
              </div>
              <button
                onClick={() => setReviewingConcept(null)}
                className="text-gray-400 hover:text-gray-800 text-2xl font-bold cursor-pointer transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="flex gap-4 mb-6">
              {/* Context Action */}
              <button
                onClick={() => handleViewContext(reviewingConcept)}
                className="flex-1 bg-blue-50 border border-blue-200 hover:bg-blue-100 text-blue-800 py-4 rounded-lg font-bold shadow-sm transition-transform active:scale-95 flex flex-col items-center justify-center gap-1 cursor-pointer"
              >
                <span className="text-xl">📖</span>
                <span>1. Jump to Document/Video Location</span>
              </button>

              {/* Tutor Action */}
              <button
                onClick={() => copyTutorPrompt(reviewingConcept)}
                className="flex-1 bg-purple-50 border border-purple-200 hover:bg-purple-100 text-purple-800 py-4 rounded-lg font-bold shadow-sm transition-transform active:scale-95 flex flex-col items-center justify-center gap-1 cursor-pointer"
              >
                <span className="text-xl">🧑‍🏫</span>
                <span>2. Ask AI Tutor for Explanation</span>
              </button>
            </div>

            {/* Quiz Action */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-5">
              <h3 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
                <span>🎯</span> 3. Test Your Knowledge
              </h3>{" "}
              <div className="flex flex-wrap gap-4 items-end mb-4 bg-white p-3 border border-gray-100 rounded-lg shadow-sm">
                {" "}
                <div className="flex gap-3">
                  {" "}
                  <div>
                    {" "}
                    <label className="block text-[10px] font-bold text-gray-500 uppercase">
                      MCQ (Single)
                    </label>{" "}
                    <input
                      type="number"
                      min="0"
                      max="10"
                      value={quizConfig.mcq_single_count}
                      onChange={(e) =>
                        setQuizConfig({
                          ...quizConfig,
                          mcq_single_count: parseInt(e.target.value) || 0,
                        })
                      }
                      className="w-16 p-1 text-sm border rounded"
                    />{" "}
                  </div>{" "}
                  <div>
                    {" "}
                    <label className="block text-[10px] font-bold text-gray-500 uppercase">
                      MCQ (Multi)
                    </label>{" "}
                    <input
                      type="number"
                      min="0"
                      max="10"
                      value={quizConfig.mcq_multi_count}
                      onChange={(e) =>
                        setQuizConfig({
                          ...quizConfig,
                          mcq_multi_count: parseInt(e.target.value) || 0,
                        })
                      }
                      className="w-16 p-1 text-sm border rounded"
                    />{" "}
                  </div>{" "}
                  <div>
                    {" "}
                    <label className="block text-[10px] font-bold text-gray-500 uppercase">
                      Fill Blank
                    </label>{" "}
                    <input
                      type="number"
                      min="0"
                      max="10"
                      value={quizConfig.fill_blank_count}
                      onChange={(e) =>
                        setQuizConfig({
                          ...quizConfig,
                          fill_blank_count: parseInt(e.target.value) || 0,
                        })
                      }
                      className="w-16 p-1 text-sm border rounded"
                    />{" "}
                  </div>{" "}
                  <div>
                    {" "}
                    <label className="block text-[10px] font-bold text-gray-500 uppercase">
                      Essay
                    </label>{" "}
                    <input
                      type="number"
                      min="0"
                      max="10"
                      value={quizConfig.essay_count}
                      onChange={(e) =>
                        setQuizConfig({ ...quizConfig, essay_count: parseInt(e.target.value) || 0 })
                      }
                      className="w-16 p-1 text-sm border rounded"
                    />{" "}
                  </div>{" "}
                </div>{" "}
                <div className="flex gap-2 ml-auto items-end">
                  <button
                    onClick={() => loadOrGenerateQuiz(true)}
                    className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded font-bold shadow-sm transition-colors cursor-pointer active:scale-95 h-9.5 text-xs"
                  >
                    🔄 Load Saved
                  </button>
                  <button
                    onClick={() => loadOrGenerateQuiz(false)}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded font-bold shadow-sm transition-colors cursor-pointer active:scale-95 h-9.5 text-xs flex gap-1 items-center"
                  >
                    <span>✨</span> Generate New
                  </button>
                </div>{" "}
              </div>{" "}
              {currentQuiz && Array.isArray(currentQuiz) ? (
                <div className="mt-4 bg-white border border-gray-200 rounded-lg shadow-sm p-5 animate-in fade-in space-y-6 max-h-[50vh] overflow-y-auto">
                  {" "}
                  {currentQuiz.map((q: any, idx: number) => (
                    <div key={idx} className="border-b pb-4 last:border-0 last:pb-0">
                      {" "}
                      <p className="font-bold text-gray-800 mb-3">
                        {idx + 1}. {q.question}
                      </p>{" "}
                      <div className="space-y-2">
                        {" "}
                        {q.type === "mcq_single" ||
                        q.type === "mcq_multi" ||
                        q.type === "mcq" ||
                        q.options ? (
                          q.options.map((opt: string, optIdx: number) => {
                            const isMulti = q.type === "mcq_multi";
                            const isSelected = isMulti
                              ? (quizAnswers[idx] || []).includes(optIdx)
                              : quizAnswers[idx] === optIdx;
                            const isCorrectOpt = isMulti
                              ? (q.correct_answer || []).includes(optIdx)
                              : q.correct_answer === optIdx;
                            let btnClass = isSelected
                              ? "border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200"
                              : "border-gray-300 hover:bg-blue-50";
                            if (showQuizAnswer) {
                              if (isCorrectOpt)
                                btnClass = "border-green-500 bg-green-100 text-green-900 font-bold";
                              else if (isSelected && !isCorrectOpt)
                                btnClass = "border-red-500 bg-red-100 text-red-900 line-through";
                            }
                            return (
                              <button
                                key={optIdx}
                                onClick={() => {
                                  if (!showQuizAnswer) {
                                    if (isMulti) {
                                      const curr = quizAnswers[idx] || [];
                                      setQuizAnswers({
                                        ...quizAnswers,
                                        [idx]: curr.includes(optIdx)
                                          ? curr.filter((i: number) => i !== optIdx)
                                          : [...curr, optIdx],
                                      });
                                    } else {
                                      setQuizAnswers({ ...quizAnswers, [idx]: optIdx });
                                    }
                                  }
                                }}
                                disabled={showQuizAnswer}
                                className={`w-full text-left p-3 border rounded transition-colors cursor-pointer ${btnClass}`}
                              >
                                {opt}{" "}
                              </button>
                            );
                          })
                        ) : q.type === "fill_blank" || q.type === "fill" ? (
                          <div>
                            {" "}
                            <input
                              type="text"
                              placeholder="Type answer..."
                              disabled={showQuizAnswer}
                              className="w-full p-3 border rounded outline-none"
                              value={quizAnswers[idx] || ""}
                              onChange={(e) =>
                                setQuizAnswers({ ...quizAnswers, [idx]: e.target.value })
                              }
                            />{" "}
                            {showQuizAnswer && (
                              <div className="text-sm mt-2 text-green-700 font-bold">
                                Answer: {q.correct_answer}
                              </div>
                            )}{" "}
                          </div>
                        ) : (
                          <div>
                            {" "}
                            <textarea
                              placeholder="Type essay..."
                              disabled={showQuizAnswer}
                              className="w-full p-3 border rounded h-24 outline-none resize-none"
                              value={quizAnswers[idx] || ""}
                              onChange={(e) =>
                                setQuizAnswers({ ...quizAnswers, [idx]: e.target.value })
                              }
                            />{" "}
                            {showQuizAnswer && (
                              <div className="text-sm mt-2 text-green-700 font-bold">
                                Rubric: {q.correct_answer}
                              </div>
                            )}{" "}
                          </div>
                        )}{" "}
                      </div>{" "}
                    </div>
                  ))}{" "}
                  {!showQuizAnswer && !pendingDailyEssayGrading && (
                    <button
                      onClick={async () => {
                        const hasEssays = currentQuiz.some((q: any) => q.type === "essay");
                        if (hasEssays) {
                          setPendingDailyEssayGrading(true);
                          const essayQuestions = currentQuiz
                            .map((q: any, idx: number) => {
                              if (q.type === "essay") {
                                return `Question ${idx + 1}: ${q.question}\nRubric/Expected: ${q.correct_answer || q.explanation}\nMy Answer: ${quizAnswers[idx] || "No answer provided."}`;
                              }
                              return null;
                            })
                            .filter(Boolean)
                            .join("\n\n---\n\n");
                          const prompt = `I am doing a quick daily review. Grade my essay answers STRICTLY on a scale of 0 to 10 based on how well they match the provided rubrics.\n\n${essayQuestions}\n\nOutput STRICTLY as a valid JSON array of numbers representing the scores in order. Do not include markdown blocks or explanations.\nExample: [8, 10]`;
                          try {
                            const { writeText } =
                              await import("@tauri-apps/plugin-clipboard-manager");
                            await writeText(prompt);
                            const { invoke } = await import("@tauri-apps/api/core");
                            await invoke("focus_and_paste");
                            showToast("🤖 Auto-pasted Essay Grading request into Gemini!");
                          } catch (err) {
                            navigator.clipboard.writeText(prompt);
                            showToast("Essay prompt copied! Paste into Gemini.");
                          }
                        } else {
                          let correctCount = 0;
                          let totalGradable = 0;
                          currentQuiz.forEach((q: any, idx: number) => {
                            if (
                              q.type === "mcq_single" ||
                              q.type === "mcq" ||
                              q.type === "multiple_choice"
                            ) {
                              totalGradable++;
                              if (quizAnswers[idx] === q.correct_answer) correctCount++;
                            } else if (q.type === "mcq_multi") {
                              totalGradable++;
                              const userAns = (quizAnswers[idx] || []).sort().join(",");
                              const correctAns = (q.correct_answer || []).sort().join(",");
                              if (userAns === correctAns) correctCount++;
                            } else if (q.type === "fill_blank" || q.type === "fill") {
                              totalGradable++;
                              const userAns = (quizAnswers[idx] || "")
                                .toString()
                                .trim()
                                .toLowerCase();
                              const correctAns = (q.correct_answer || "")
                                .toString()
                                .trim()
                                .toLowerCase();
                              if (userAns === correctAns) correctCount++;
                            }
                          });
                          let quality = 3;
                          if (totalGradable > 0) {
                            const score = correctCount / totalGradable;
                            if (score === 1) quality = 5;
                            else if (score >= 0.75) quality = 4;
                            else if (score >= 0.5) quality = 3;
                            else if (score > 0) quality = 2;
                            else quality = 1;
                          }
                          setCalculatedQuality(quality);
                          setShowQuizAnswer(true);
                        }
                      }}
                      className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded shadow transition-colors cursor-pointer mt-4"
                    >
                      {" "}
                      {currentQuiz.some((q: any) => q.type === "essay")
                        ? "✨ Submit & Magic Grade Essays with Gemini"
                        : "Submit Answers & Auto-Grade"}{" "}
                    </button>
                  )}{" "}
                  {pendingDailyEssayGrading && (
                    <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg text-center shadow-sm mt-4 animate-in fade-in zoom-in-95">
                      {" "}
                      <h4 className="text-lg font-bold text-blue-800 mb-1">
                        Grading Essays...
                      </h4>{" "}
                      <p className="text-blue-600 mb-3 text-xs">
                        Prompt copied! Paste into Gemini, let it grade from 0 to 10, and copy the
                        JSON array result.{" "}
                      </p>{" "}
                      <button
                        onClick={async () => {
                          try {
                            const { readText } =
                              await import("@tauri-apps/plugin-clipboard-manager");
                            const text = await readText();
                            if (text) setDailyEssayGradesInput(text);
                            else alert("Clipboard is empty!");
                          } catch (err) {
                            alert("Failed to read clipboard");
                          }
                        }}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded shadow-md transition-transform transform hover:scale-105 cursor-pointer text-sm"
                      >
                        ✨ Magic Paste Essay Grades JSON{" "}
                      </button>{" "}
                    </div>
                  )}{" "}
                  {showQuizAnswer && (
                    <div className="border-t border-gray-200 pt-4 mt-2 text-center animate-in fade-in">
                      {calculatedQuality !== null ? (
                        <>
                          <p className="font-bold text-gray-800 mb-1">
                            Auto-graded Quality:{" "}
                            <span
                              className={`text-lg ${calculatedQuality >= 4 ? "text-green-600" : calculatedQuality === 3 ? "text-yellow-600" : "text-red-600"}`}
                            >
                              {calculatedQuality}/5
                            </span>
                          </p>
                          <p className="text-xs text-gray-500 mb-4">
                            Review your correct/incorrect answers above. The system automatically
                            evaluated your performance.
                          </p>
                          <button
                            onClick={() => handleGrade(calculatedQuality)}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded font-bold shadow-sm transition-transform active:scale-95 cursor-pointer"
                          >
                            Confirm & Move to Next Concept
                          </button>
                          <button
                            onClick={() => {
                              setCalculatedQuality(null);
                              setShowQuizAnswer(false);
                            }}
                            className="text-xs text-gray-400 hover:text-gray-600 underline mt-3 cursor-pointer"
                          >
                            Wait, I want to retry my answers
                          </button>
                        </>
                      ) : (
                        <>
                          <p className="font-bold text-gray-800 text-center mb-3">
                            Rate your memory to move on (SM-2):
                          </p>
                          <div className="grid grid-cols-3 gap-3">
                            <button
                              onClick={() => handleGrade(1)}
                              className="bg-red-500 hover:bg-red-600 text-white py-3 rounded font-bold shadow-sm transition-transform active:scale-95 cursor-pointer"
                            >
                              Blackout (1)
                            </button>
                            <button
                              onClick={() => handleGrade(3)}
                              className="bg-yellow-500 hover:bg-yellow-600 text-white py-3 rounded font-bold shadow-sm transition-transform active:scale-95 cursor-pointer"
                            >
                              Hard (3)
                            </button>
                            <button
                              onClick={() => handleGrade(5)}
                              className="bg-green-500 hover:bg-green-600 text-white py-3 rounded font-bold shadow-sm transition-transform active:scale-95 cursor-pointer"
                            >
                              Perfect (5)
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}{" "}
                </div>
              ) : (
                <div className="mt-4 border-t border-gray-200 pt-4">
                  <p className="text-sm font-bold text-gray-700 mb-2">
                    Wait for Gemini to finish generating, then Paste JSON:
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        try {
                          const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
                          const txt = await readText();
                          if (txt) setQuizJsonInput(txt);
                        } catch (e) {
                          alert("Clipboard failed");
                        }
                      }}
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded shadow-md transition-transform active:scale-95 cursor-pointer flex justify-center gap-2"
                    >
                      ✨ Magic Paste Quiz JSON
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Read & Review Raw Backdoor */}
            <div className="mt-4 text-center">
              <button
                onClick={() => {
                  setCurrentQuiz([
                    {
                      type: "read_only",
                      question: reviewingConcept.label,
                      correct_answer: reviewingConcept.definition,
                    },
                  ]);
                  setShowQuizAnswer(true);
                }}
                className="text-xs text-gray-400 hover:text-gray-600 underline cursor-pointer font-medium"
              >
                Skip Quiz, just show me the definition to grade
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Embedded Context Modal Viewer */}
      {viewingContext && (
        <div className="absolute inset-0 bg-black/90 z-60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl p-4 flex flex-col h-[95vh]">
            <div className="flex justify-between items-center mb-2 shrink-0">
              <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                <span>📖</span> Location Context: {viewingContext.label}
              </h2>
              <button
                onClick={() => {
                  setViewingContext(null);
                  setViewingDocPath(null);
                }}
                className="bg-red-100 hover:bg-red-200 text-red-800 px-4 py-1.5 rounded-full font-bold transition-colors cursor-pointer"
              >
                Close Viewer
              </button>
            </div>
            {viewingDocPath && (
              <div className="flex-1 border border-gray-300 rounded-lg overflow-hidden bg-gray-100 shadow-inner flex flex-col">
                {viewingDocPath.endsWith(".mp4") ||
                viewingDocPath.endsWith(".mkv") ||
                viewingDocPath.endsWith(".avi") ? (
                  <video
                    key={`${viewingDocPath}-${viewingContext.video_timestamp}`}
                    controls
                    autoPlay
                    className="w-full h-full object-contain bg-black"
                    src={`${convertFileSrc(viewingDocPath)}#t=${viewingContext.video_timestamp || 0}`}
                  />
                ) : viewingDocPath.toLowerCase().endsWith(".pptx") ? (
                  <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 text-center p-6">
                    <span className="text-4xl mb-4">📊</span>
                    <h3 className="text-xl font-bold text-gray-800 mb-2">
                      PowerPoint Presentation
                    </h3>
                    <p className="text-gray-600 mb-6">
                      Native rendering for PPTX is not supported in the built-in sandbox viewer.
                      Please open the file externally to view the context.
                    </p>
                    <button
                      onClick={async () => {
                        const { openPath } = await import("@tauri-apps/plugin-opener");
                        await openPath(viewingDocPath);
                      }}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-full shadow-md transition-colors cursor-pointer"
                    >
                      Open in System Viewer
                    </button>
                  </div>
                ) : (
                  <iframe
                    key={`${viewingDocPath}-${viewingContext.page_num}`}
                    src={`${convertFileSrc(viewingDocPath)}#page=${viewingContext.page_num || 1}`}
                    className="w-full h-full border-none bg-white"
                    title="Document Viewer"
                  />
                )}
              </div>
            )}
            {!viewingDocPath && (
              <div className="flex-1 flex items-center justify-center text-gray-500 italic">
                No document source available for this concept.
              </div>
            )}
          </div>
        </div>
      )}

      {toastMsg && (
        <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white font-medium px-6 py-3 rounded-full shadow-lg z-100 animate-in fade-in slide-in-from-bottom-5">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
