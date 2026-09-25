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
    students: { id: string; nickname: string; kind: StudentKind; language: Lang }[];
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
  typedAnswer: (studentId: string, questionId: string, answer: string) =>
    post<{ correct: boolean; misconception_tag: string | null; label_en: string | null; correct_answer: string }>(
      "/agents/diagnostician/answer",
      { student_id: studentId, question_id: questionId, answer },
    ),
  review: (studentId: string, questionId: string, verdict: ReviewVerdict, extra: { tag?: string; step?: number } = {}) =>
    post<{ ok: true; correct: boolean; misconception_tag: string | null; error_step: number | null }>(
      "/teacher/review",
      { student_id: studentId, question_id: questionId, verdict, ...extra },
    ),
};
