import {
  TopicResponse,
  SessionLookup,
  JoinResponse,
  NextResponse,
  AnswerResponse,
  PhotoResponse,
  LessonResponse,
  RetryResponse,
  AnalyzeResponse,
  Dashboard,
  EventsResponse,
  StudentDetail,
  ParentMessage,
  JudgesSummary,
  Lang,
} from "./types";

const mockTelemetry = [
  {
    agent: "Cache",
    action: "mock",
    provider: "cache" as const,
    model: "fixture",
    ms: 50,
    in_tokens: 0,
    out_tokens: 0,
    cost_paise: 0,
    fallback: false,
    cached: true,
    ok: true,
  },
];

const simNames = [
  "Aditi", "Arjun", "Bhavya", "Chetan", "Deepa", "Dhruv", "Esha", "Gaurav", 
  "Harsha", "Isha", "Jay", "Kavya", "Laksh", "Meera", "Neha", "Om", "Pooja", 
  "Rahul", "Riya", "Sahil", "Sneha", "Tarun", "Uma", "Varun", "Vidya", 
  "Yash", "Zara", "Aarav", "Diya", "Kabir"
];

const simStudents = simNames.map((name, i) => ({
  id: `sim_${i}`,
  nickname: name,
  kind: "simulated" as const,
  language: "en" as Lang,
}));

// Generates 31 rows of random mastery data (Asha + 30 sim)
// 9 students will fail on C4 with misconception tag
const ashaCells = [0.8, 0.9, 0.7, 0.2, null, null, null, null];
const cells = [ashaCells];
for (let i = 0; i < 30; i++) {
  const row = [];
  for (let c = 0; c < 8; c++) {
    if (c === 3) {
      // 8 more fail C4 (plus Asha makes 9)
      row.push(i < 8 ? 0.2 : 0.8);
    } else {
      row.push(c < 4 ? Math.random() * 0.5 + 0.5 : null);
    }
  }
  cells.push(row);
}

export const FIXTURES = {
  getHealth: () => ({ ok: true, version: "0.1", demo_mode: true, providers: { nebius: true, vertex: true } }),
  
  getTopic: (): TopicResponse => ({
    topic: { id: "T1", name: "Fractions" },
    concepts: [
      { id: "C1", name: "Understanding fractions", short: "Basics", prereqs: [], names: {} },
      { id: "C2", name: "Equivalent fractions", short: "Equivalent", prereqs: ["C1"], names: {} },
      { id: "C3", name: "Simplifying fractions", short: "Simplify", prereqs: ["C2"], names: {} },
      { id: "C4", name: "Adding and subtracting fractions", short: "Add/Sub", prereqs: ["C2", "C3"], names: {} },
      { id: "C5", name: "Mixed numbers", short: "Mixed", prereqs: ["C4"], names: {} },
      { id: "C6", name: "Multiplying fractions", short: "Multiply", prereqs: ["C1"], names: {} },
      { id: "C7", name: "Dividing fractions", short: "Divide", prereqs: ["C6"], names: {} },
      { id: "C8", name: "Word problems", short: "Word probs", prereqs: ["C4", "C7"], names: {} },
    ],
    edges: [
      ["C1", "C2"],
      ["C2", "C3"],
      ["C2", "C4"],
      ["C3", "C4"],
      ["C4", "C5"],
      ["C1", "C6"],
      ["C6", "C7"],
      ["C4", "C8"],
      ["C7", "C8"],
    ],
    tags: [],
    photo_questions: [
      { id: "P1", stem: "3/4 + 1/4", concept_id: "C4" },
    ],
  }),

  createSession: (): SessionLookup & { join_url: string } => ({
    session_id: "S1",
    code: "7B",
    class_name: "Class 7B",
    topic_name: "Fractions",
    n_students: 31,
    join_url: "http://localhost:3000/join/7B",
  }),

  lookupSession: (): SessionLookup => ({
    session_id: "S1",
    code: "7B",
    class_name: "Class 7B",
    topic_name: "Fractions",
    n_students: 31,
  }),

  joinSession: (nickname: string, language: Lang): JoinResponse => ({
    student_id: nickname.toLowerCase() === "asha" ? "demo_asha" : "student_1",
    session_id: "S1",
    nickname,
    language,
    resumed: nickname.toLowerCase() === "asha",
  }),

  getExaminerNext: (): NextResponse => ({
    done: false,
    index: 1,
    total: 5,
    question: {
      id: "Q1",
      kind: "mcq",
      stem: "What is 1/2 + 1/3?",
      options: ["5/6", "2/5", "1/6", "2/6"],
      concept_id: "C4",
      concept_name: "Adding and subtracting fractions",
    },
    reason: "Next question",
  }),

  answerQuestion: (): AnswerResponse => ({
    correct: false,
    misconception_tag: "add_denominators",
    label: "added the denominators too",
    label_en: "added the denominators too",
    feedback: "You added the top numbers and the bottom numbers. Only add the top numbers when the bottoms are the same.",
    correct_answer: "5/6",
    source: "llm",
    confidence: 0.9,
    concept_id: "C4",
    mastery_before: 0.5,
    mastery_after: 0.3,
    gap_opened: true,
    telemetry: mockTelemetry,
  }),

  photoDiagnose: (): PhotoResponse => ({
    student_id: "demo_asha",
    question_id: "P1",
    concept_id: "C4",
    steps: ["3/4 + 1/4", "= (3+1)/(4+4)", "= 4/8"],
    final_answer_read: "4/8",
    correct: false,
    error_step: 2,
    misconception_tag: "add_denominators",
    label: "added the denominators too",
    confidence: 0.95,
    feedback: "You added the denominators.",
    source: "vision",
    needs_typed_answer: false,
    mastery_after: 0.2,
    gap_opened: true,
    telemetry: mockTelemetry,
  }),

  getCuratorLesson: (): LessonResponse => ({
    status: "ready",
    lesson: {
      language: "kn",
      language_label: "ಕನ್ನಡ",
      lesson_md: "# Lesson\nHere is a lesson in Kannada.",
      practice: [{ question: "1/4 + 2/4", answer: "3/4" }],
      concept_id: "C4",
      concept_name: "Adding and subtracting fractions",
      tag: "add_denominators",
      label: "added the denominators too",
      translated: true,
    },
    retry: [
      { id: "R1", kind: "mcq", stem: "1/5 + 2/5", options: ["3/5", "3/10", "2/5"] },
      { id: "R2", kind: "text", stem: "2/7 + 3/7", options: null },
    ],
    telemetry: mockTelemetry,
  }),

  submitRetry: (): RetryResponse => ({
    gap_closed: true,
    concept_id: "C4",
    mastery_after: 0.8,
    results: [
      { question_id: "R1", correct: true, correct_answer: "3/5" },
      { question_id: "R2", correct: true, correct_answer: "5/7" },
    ],
  }),

  runSimulator: () => ({
    students_added: 30,
    answers: 100,
    gaps_closed: 5,
    llm_calls: 0,
  }),

  analyzeClass: (): AnalyzeResponse => ({
    run_id: "run1",
    rounds: 1,
    steps: [
      {
        round: 1,
        agent: "Coach",
        action: "propose",
        recommendations: [
          {
            id: "rec1",
            round: 1,
            stage: "draft",
            audience: "whole_class",
            group_label: "Whole Class",
            n_students: 31,
            concept_id: "C4",
            concept_name: "Adding and subtracting fractions",
            misconception_tag: "add_denominators",
            label: "added the denominators too",
            headline: "Re-teach common denominators to everyone",
            plan_5min: ["Step 1", "Step 2"],
            worked_example: "1/2 + 1/4 = 3/4",
            why: "Because many failed.",
            flagged: false,
            analyst_note: null,
            approved: false,
          },
        ],
      },
      {
        round: 1,
        agent: "Analyst",
        action: "critique",
        critiques: [
          {
            index: 0,
            verdict: "revise",
            reason: "Only 9 of 31 students show 'added the denominators too' on Adding and subtracting fractions; re-teaching everyone wastes the period. Split the class.",
          },
        ],
      },
      {
        round: 1,
        agent: "Coach",
        action: "revise",
        recommendations: [
          {
            id: "rec1_revised",
            round: 1,
            stage: "revised",
            audience: "reteach_group",
            group_label: "Small Group",
            n_students: 9,
            concept_id: "C4",
            concept_name: "Adding and subtracting fractions",
            misconception_tag: "add_denominators",
            label: "added the denominators too",
            headline: "Small group intervention on common denominators",
            plan_5min: ["Gather the 9 students", "Use visual models for addition"],
            worked_example: "1/4 + 1/4 = 2/4",
            why: "Targeted intervention for the 9 students who struggled.",
            flagged: false,
            analyst_note: null,
            approved: false,
          },
        ],
      },
      {
        round: 1,
        agent: "Analyst",
        action: "critique",
        critiques: [
          {
            index: 0,
            verdict: "accept",
            reason: "Looks good.",
          },
        ],
      },
    ],
    final: [
      {
        id: "rec1_final",
        round: 1,
        stage: "final",
        audience: "reteach_group",
        group_label: "Small Group",
        n_students: 9,
        concept_id: "C4",
        concept_name: "Adding and subtracting fractions",
        misconception_tag: "add_denominators",
        label: "added the denominators too",
        headline: "Small group intervention on common denominators",
        plan_5min: ["Gather the 9 students", "Use visual models for addition"],
        worked_example: "1/4 + 1/4 = 2/4",
        why: "Targeted intervention.",
        flagged: false,
        analyst_note: null,
        approved: false,
      },
    ],
    telemetry: mockTelemetry,
  }),

  approveRecommendation: () => ({ ok: true }),

  getDashboard: (): Dashboard => ({
    session_id: "S1",
    class_name: "Class 7B",
    code: "7B",
    n_students: 31,
    n_simulated: 30,
    concepts: [
      {
        id: "C4",
        name: "Adding and subtracting fractions",
        short: "Add/Sub",
        avg: 0.6,
        responders: 31,
        below_gap: 9,
        open_gaps: 9,
        top: [
          {
            tag: "add_denominators",
            label: "added the denominators too",
            students: 9,
          },
        ],
      },
    ],
    edges: [],
    heatmap: {
      concept_ids: ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"],
      students: [
        { id: "demo_asha", nickname: "Asha", kind: "demo", language: "kn" },
        ...simStudents,
      ],
      cells: cells,
    },
    groups: { reteach: [], practice: [], extend: [], not_assessed: [] },
    focus_concept: "C4",
    gaps: { open: 9, closed: 2, rate: 0.18 },
    recommendations: [],
  }),

  getEvents: (): EventsResponse => ({
    events: [],
    last_seq: 0,
  }),

  getStudentDetail: (): StudentDetail => ({
    id: "demo_asha",
    nickname: "Asha",
    language: "kn",
    kind: "demo",
    mastery: { C4: 0.2 },
    assessed: ["C1", "C2", "C3", "C4"],
    gaps: [{ concept_id: "C4", status: "open", tag: "add_denominators", label: "added the denominators too" }],
    responses: [],
  }),

  parentMessage: (): ParentMessage => ({
    language: "kn",
    message: "ನಮಸ್ಕಾರ, ಆಶಾ ಗಣಿತದಲ್ಲಿ ಉತ್ತಮ ಪ್ರಗತಿ ಸಾಧಿಸುತ್ತಿದ್ದಾರೆ.",
    whatsapp_url: "https://wa.me/1234567890",
    audio_url: "/audio/test.mp3",
    telemetry: mockTelemetry,
  }),

  getMediaVoice: () => new Blob(["audio-data"], { type: "audio/mpeg" }),

  resetAdmin: () => ({ ok: true }),

  getJudgesSummary: (): JudgesSummary => ({
    numbers: [],
    links: { app: "", repo: "", video: null, status_page: null },
  }),
};
