// The dashboard's slice of the API contract (docs/API.md). Calls go through the /backend rewrite.

export type Lang = "en" | "hi" | "kn";
export type StudentKind = "real" | "simulated" | "demo";

export interface Telemetry {
  agent: string;
  action: string;
  provider: string;
  model: string;
  ms: number;
  in_tokens: number;
  out_tokens: number;
  cost_paise: number;
  fallback: boolean;
  cached: boolean;
  ok: boolean;
}

export interface SessionLookup {
  session_id: string;
  code: string;
  class_name: string;
  topic_name: string;
  n_students: number;
  school_id?: string | null;
}

export interface CreatedSession extends SessionLookup {
  join_url: string;
  teacher_url: string;
}

export interface SchoolClass {
  session_id: string;
  code: string;
  class_name: string;
  n_students: number;
  averages: Record<string, number | null>;
  open_gaps: Record<string, number>;
  focus_concept: string | null;
  reteach: { concept_id: string; concept_name: string; tag: string; label: string; students: number } | null;
  gaps: { open: number; closed: number };
}

export interface SchoolSummary {
  school_id: string;
  n_classes: number;
  n_students: number;
  concepts: { id: string; name: string; short: string }[];
  classes: SchoolClass[];
  top_misconceptions: { tag: string; label: string; students: number; concepts: string[] }[];
}

export interface ConceptStat {
  id: string;
  name: string;
  short: string;
  avg: number | null;
  responders: number;
  below_gap: number;
  open_gaps: number;
  top: { tag: string; label: string; students: number }[];
}

export interface StudentRef {
  id: string;
  nickname: string;
}

export interface Dashboard {
  session_id: string;
  class_name: string;
  code: string;
  n_students: number;
  n_simulated: number;
  concepts: ConceptStat[];
  edges: [string, string][];
  heatmap: {
    concept_ids: string[];
    students: { id: string; nickname: string; kind: StudentKind; language: Lang; roll_no?: number | null }[];
    cells: (number | null)[][];
  };
  groups: { reteach: StudentRef[]; practice: StudentRef[]; extend: StudentRef[]; not_assessed: StudentRef[] };
  focus_concept: string | null;
  gaps: { open: number; closed: number; rate: number };
  recommendations: Recommendation[];
}

export interface AgentEvent {
  seq: number;
  ts: string;
  agent: string;
  action: string;
  reason: string;
  student_id: string | null;
  student_nickname: string | null;
  telemetry: Telemetry[];
}

export type Audience = "whole_class" | "reteach_group" | "practice_group" | "extend_group" | "individuals";

export interface Recommendation {
  id: string;
  round: number;
  stage: "draft" | "revised" | "final";
  audience: Audience;
  group_label: string;
  n_students: number;
  concept_id: string;
  concept_name: string;
  misconception_tag: string;
  label: string;
  headline: string;
  plan_5min: string[];
  worked_example: string;
  why: string;
  flagged: boolean;
  analyst_note: string | null;
  approved: boolean;
}

export interface Critique {
  index: number;
  verdict: "accept" | "revise";
  reason: string;
}

export interface AnalyzeStep {
  round: number;
  agent: "Coach" | "Analyst";
  action: "propose" | "critique" | "revise";
  recommendations?: Recommendation[];
  critiques?: Critique[];
  /** "template" when Gemini didn't answer and the Coach used its built-in plan */
  source?: "llm" | "template";
}

export interface AnalyzeResponse {
  run_id: string;
  rounds: number;
  steps: AnalyzeStep[];
  final: Recommendation[];
  telemetry: Telemetry[];
}

export interface StudentDetail {
  id: string;
  nickname: string;
  language: Lang;
  kind: StudentKind;
  mastery: Record<string, number>;
  assessed: string[];
  gaps: { concept_id: string; status: "open" | "closed"; tag: string | null; label: string | null }[];
  responses: {
    question_id: string;
    stem: string;
    answer: string;
    correct: boolean;
    tag: string | null;
    label: string | null;
    source: string;
    phase: string;
    created_at: string;
  }[];
}

export interface ParentMessage {
  language: Lang;
  message: string;
  whatsapp_url: string;
  audio_url: string | null;
  telemetry: Telemetry[];
}

export interface RuleCheck {
  status: "verified" | "consistent" | "mismatch" | "unverified";
  note: string;
}

export interface VerifierLine {
  text: string;
  value: string | null;
  values: (string | null)[];
  ok: boolean | null;
}

export interface Verifier {
  status: "verified" | "unverified";
  correct: boolean | null;
  error_step: number | null;
  tag: string | null;
  reproduced_by: string | null;
  evidence: string;
  reference: string | null;
  final: string | null;
  lines: VerifierLine[];
}

export interface PhotoResult {
  student_id: string;
  question_id: string;
  concept_id: string;
  steps: string[];
  final_answer_read: string | null;
  correct: boolean;
  error_step: number | null;
  misconception_tag: string | null;
  label: string | null;
  confidence: number;
  feedback: string;
  source: string;
  needs_typed_answer: boolean;
  rule_check: RuleCheck;
  mastery_after: number | null;
  gap_opened: boolean;
  telemetry: Telemetry[];
  /** the exact step verifier: one exact value per transcribed line (a/b), null where a line has no arithmetic */
  line_values?: (string | null)[];
  /** the mal-rule that reproduces the wrong line exactly, when one does */
  reproduced_by?: string | null;
  verifier?: Verifier | null;
  /** the problem as posed: the bank stem, or the first line the student wrote (question_id AUTO) */
  problem?: string;
  /** F5: one box per transcribed line, [ymin, xmin, ymax, xmax] on 0–1000; null = fall back to the transcript view */
  line_boxes?: [number, number, number, number][] | null;
  /** set when the page showed another problem than the one picked, so it was checked as written */
  problem_note?: string;
  /** true when no fraction working was found on the photo; nothing was saved */
  no_working?: boolean;
}

/** Any fraction problem, not only the four in the bank: the first line the student wrote is the problem. */
export const AUTO_QUESTION = "AUTO";

/** One problem read from a whole page (F2 snap, F3 homework). */
export interface PageProblem {
  question_id: string;
  concept_id: string;
  problem: string;
  answer: string;
  steps: string[];
  final_answer_read: string | null;
  correct: boolean;
  error_step: number | null;
  misconception_tag: string | null;
  label: string | null;
  label_local: string | null;
  feedback: string;
  feedback_local: string;
  confidence: number;
  source: string;
  needs_typed_answer: boolean;
  rule_check: RuleCheck;
  line_values: (string | null)[];
  reproduced_by: string | null;
  verifier: Verifier | null;
  line_boxes?: [number, number, number, number][] | null;
  /** the saved reading, for the teacher's confirm or correct on this one problem */
  response_id?: number;
}

export type PageMode = "homework" | "snap" | "scan";

export interface PageResponse {
  session_id: string;
  mode: PageMode;
  student_id: string | null;
  student_nickname: string | null;
  matched_by: "given" | "roll" | "nickname" | null;
  roll_no: number | null;
  name_on_page: string | null;
  problems: PageProblem[];
  saved: boolean;
  summary: { saved: number; wrong: number; gaps_opened: number } | null;
  unreadable: boolean;
  telemetry: Telemetry[];
}

export interface Digest {
  hours: number;
  homework_pages: number;
  snap_pages: number;
  students: number;
  problems: number;
  wrong: number;
  new_gaps: number;
  top_concepts: { id: string; name: string; gaps: number }[];
}

export interface Topic {
  concepts: { id: string; name: string; short: string }[];
  tags: { tag: string; labels: Record<Lang, string> }[];
  photo_questions: { id: string; stem: string; concept_id: string }[];
}

export interface QuestionOut {
  id: string;
  kind: "mcq" | "text";
  stem: string;
  options: string[] | null;
  concept_id: string;
  concept_name: string;
}

export interface NextResponse {
  done: boolean;
  index: number;
  total: number;
  question: QuestionOut | null;
  reason: string;
}

export interface AnswerResponse {
  correct: boolean;
  misconception_tag: string | null;
  label: string | null;
  feedback: string;
  correct_answer: string;
  source: string;
  concept_id: string;
  mastery_after: number;
  gap_opened: boolean;
  gap_open: boolean;
  telemetry: Telemetry[];
}

export interface LessonResponse {
  status: "ready" | "generating" | "none";
  lesson: {
    language: Lang;
    language_label: string;
    lesson_md: string;
    practice: { question: string; answer: string }[];
    concept_id: string;
    concept_name: string;
    tag: string;
    label: string;
    translated: boolean;
  } | null;
  retry: QuestionOut[] | null;
  telemetry: Telemetry[];
}

export interface RetryResponse {
  gap_closed: boolean;
  concept_id: string;
  mastery_after: number;
  results: { question_id: string; correct: boolean; correct_answer: string }[];
}

export interface Worksheet {
  class_name: string;
  concept_name: string;
  label: string;
  definition: string;
  students: string[];
  worked_example: string;
  spot_the_mistake: { question: string; student_answer: string } | null;
  items: { question: string; answer: string }[];
}

export type ReviewVerdict = "agree" | "change_tag" | "change_step" | "mark_correct";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// NEXT_PUBLIC_API_BASE lets the dashboard talk to an API directly in local development; production uses the rewrite.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "/backend";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { cache: "no-store", ...init });
  } catch {
    throw new ApiError(0, "offline", "Can't reach the server. Check the connection.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.code ?? "error", body?.error?.message ?? "Something went wrong.");
  }
  return body as T;
}

const post = <T>(path: string, body: unknown) =>
  call<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export interface AdminHealth {
  ok: boolean;
  version: string;
  demo_mode: string;
  providers: Record<string, boolean>;
  vision_model: string;
  text_model: string;
  cache: { llm: number; lessons: number };
  demo_class: { students: number; real_joins: number };
  last_photo_ms: number[];
}

const ADMIN_KEY = "gurugraph:admin";

/** The presenter's admin token, typed once on /present and kept in this browser only. Never put in a URL. */
export const adminToken = {
  get: (): string => {
    try {
      return localStorage.getItem(ADMIN_KEY) ?? "";
    } catch {
      return "";
    }
  },
  set: (token: string) => {
    try {
      if (token) localStorage.setItem(ADMIN_KEY, token);
      else localStorage.removeItem(ADMIN_KEY);
    } catch {
      // private mode
    }
  },
};

const adminCall = <T>(path: string, method: "GET" | "POST", body?: unknown) =>
  call<T>(path, {
    method,
    headers: { "content-type": "application/json", "X-Admin-Token": adminToken.get() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const admin = {
  health: () => adminCall<AdminHealth>("/admin/health", "GET"),
  reset: () => adminCall<{ ok: true }>("/admin/reset", "POST", {}),
  removeStudent: (studentId: string) =>
    adminCall<{ ok: true }>("/admin/remove-student", "POST", { student_id: studentId }),
};

export const api = {
  lookup: (code: string) => call<SessionLookup>(`/sessions/lookup?code=${encodeURIComponent(code)}`),
  dashboard: (sessionId: string) => call<Dashboard>(`/teacher/dashboard?session_id=${encodeURIComponent(sessionId)}`),
  events: (sessionId: string, after: number) =>
    call<{ events: AgentEvent[]; last_seq: number }>(
      `/teacher/events?session_id=${encodeURIComponent(sessionId)}&after=${after}`,
    ),
  student: (studentId: string) => call<StudentDetail>(`/teacher/student?student_id=${encodeURIComponent(studentId)}`),
  analyze: (sessionId: string) => post<AnalyzeResponse>("/agents/analyst/analyze", { session_id: sessionId }),
  approve: (recommendationId: string) => post<{ ok: true }>("/teacher/approve", { recommendation_id: recommendationId }),
  parentMessage: (studentId: string) => post<ParentMessage>("/agents/coach/parent-message", { student_id: studentId }),
  topic: () => call<Topic>("/topic"),
  worksheet: (sessionId: string, conceptId: string, tag: string) =>
    call<Worksheet>(
      `/teacher/worksheet?session_id=${encodeURIComponent(sessionId)}&concept_id=${encodeURIComponent(conceptId)}&tag=${encodeURIComponent(tag)}`,
    ),
  join: (code: string, nickname: string, language: Lang) =>
    post<{ student_id: string; session_id: string; nickname: string; language: Lang; resumed: boolean }>(
      "/students/join",
      { code, nickname, language },
    ),
  next: (studentId: string) => post<NextResponse>("/agents/examiner/next", { student_id: studentId }),
  answer: (studentId: string, questionId: string, answer: string) =>
    post<AnswerResponse>("/agents/diagnostician/answer", { student_id: studentId, question_id: questionId, answer }),
  lesson: (studentId: string) => post<LessonResponse>("/agents/curator/lesson", { student_id: studentId }),
  retry: (studentId: string, answers: { question_id: string; answer: string }[]) =>
    post<RetryResponse>("/agents/examiner/retry", { student_id: studentId, answers }),
  photo: (studentId: string, questionId: string, image: Blob) => {
    const form = new FormData();
    form.append("student_id", studentId);
    form.append("question_id", questionId);
    form.append("image", image, "notebook.jpg");
    return call<PhotoResult>("/agents/diagnostician/photo", { method: "POST", body: form });
  },
  /** The teacher types the final answer from an unreadable page; phase "photo" keeps it out of the student's quiz. */
  typedAnswer: (studentId: string, questionId: string, answer: string) =>
    post<{ correct: boolean; misconception_tag: string | null; label_en: string | null; correct_answer: string }>(
      "/agents/diagnostician/answer",
      { student_id: studentId, question_id: questionId, answer, phase: "photo" },
    ),
  /** One whole page: the child's own homework (studentId) or a snapped notebook filed by its header (sessionId). */
  page: (image: Blob, who: { studentId?: string; sessionId?: string }, mode: PageMode, language?: Lang) => {
    const form = new FormData();
    form.append("image", image, "page.jpg");
    if (who.studentId) form.append("student_id", who.studentId);
    if (who.sessionId) form.append("session_id", who.sessionId);
    form.append("mode", mode);
    if (language) form.append("language", language);
    return call<PageResponse>("/agents/diagnostician/page", { method: "POST", body: form });
  },
  pageFile: (studentId: string, mode: PageMode, problems: PageProblem[]) =>
    post<{ student_id: string; student_nickname: string; problems: PageProblem[]; summary: PageResponse["summary"] }>(
      "/agents/diagnostician/page/file",
      { student_id: studentId, mode, problems },
    ),
  digest: (sessionId: string, hours = 24) =>
    call<Digest>(`/teacher/digest?session_id=${encodeURIComponent(sessionId)}&hours=${hours}`),
  speak: (text: string, language: Lang) => post<{ audio_url: string }>("/media/speak", { text, language }),
  joinWithRoll: (code: string, nickname: string, language: Lang, rollNo: number | null) =>
    post<{ student_id: string; session_id: string; nickname: string; language: Lang; resumed: boolean }>(
      "/students/join",
      { code, nickname, language, roll_no: rollNo },
    ),
  createSession: (className: string, code?: string, schoolId?: string) =>
    post<CreatedSession>("/sessions/create", { class_name: className, code, school_id: schoolId }),
  roster: (sessionId: string, text: string) =>
    post<{ ok: true; added: number; updated: number }>("/sessions/roster", { session_id: sessionId, text }),
  school: (schoolId: string) => call<SchoolSummary>(`/school/summary?school_id=${encodeURIComponent(schoolId)}`),
  review: (
    studentId: string,
    questionId: string,
    verdict: ReviewVerdict,
    extra: { tag?: string; step?: number; response_id?: number } = {},
  ) =>
    post<{ ok: true; correct: boolean; misconception_tag: string | null; error_step: number | null }>(
      "/teacher/review",
      { student_id: studentId, question_id: questionId, verdict, ...extra },
    ),
};
