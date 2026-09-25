export type Lang = "en" | "hi" | "kn";
export type StudentKind = "real" | "simulated" | "demo";

export interface Telemetry {
  agent: string; action: string;
  provider: "nebius" | "vertex" | "cache" | "template"; model: string;
  ms: number; in_tokens: number; out_tokens: number; cost_paise: number;
  fallback: boolean; cached: boolean; ok: boolean;
}

export interface Concept { id: string; name: string; short: string; prereqs: string[]; names: { hi?: string; kn?: string } }
export interface TopicResponse {
  topic: { id: string; name: string };
  concepts: Concept[];
  edges: [string, string][];
  tags: { tag: string; labels: Record<Lang, string> }[];
  photo_questions: { id: string; stem: string; concept_id: string }[];
}

export interface SessionLookup { session_id: string; code: string; class_name: string; topic_name: string; n_students: number }
export interface JoinResponse { student_id: string; session_id: string; nickname: string; language: Lang; resumed: boolean }

export interface QuestionOut {
  id: string; kind: "mcq" | "text"; stem: string;
  options: string[] | null;          // mcq only, already shuffled for this student
  concept_id: string; concept_name: string;
}
export interface NextResponse { done: boolean; index: number; total: number; question: QuestionOut | null; reason: string }

export interface AnswerResponse {
  correct: boolean;
  misconception_tag: string | null;
  label: string | null;               // plain words, in the student's language
  label_en: string | null;
  feedback: string;                   // one or two sentences, in the student's language
  correct_answer: string;
  source: "key" | "rule" | "llm" | "template";
  confidence: number;
  concept_id: string;
  mastery_before: number; mastery_after: number;
  gap_opened: boolean;              // this answer opened the gap
  gap_open: boolean;                // a gap is open on this concept now (show "Fix this now" when true)
  telemetry: Telemetry[];
}

export interface PhotoResponse {
  student_id: string; question_id: string; concept_id: string;
  steps: string[];                    // transcribed lines, exactly as written
  final_answer_read: string | null;
  correct: boolean;
  error_step: number | null;          // 1-based index into steps; circle this line in red pen
  misconception_tag: string | null;
  label: string | null;               // English, for the teacher
  confidence: number;
  feedback: string;
  source: "vision" | "vision+rule";
  needs_typed_answer: boolean;        // true: show a typed-answer box instead
  mastery_after: number | null; gap_opened: boolean;
  telemetry: Telemetry[];
}

export interface RetryItem { id: string; kind: "mcq" | "text"; stem: string; options: string[] | null }
export interface Lesson {
  language: Lang; language_label: string;
  lesson_md: string;                  // ≤150 words, markdown, no LaTeX
  practice: { question: string; answer: string }[];
  concept_id: string; concept_name: string; tag: string; label: string;
  translated: boolean;                // false means the English fallback: show "English (translation unavailable)"
}
export interface LessonResponse {
  status: "ready" | "generating" | "none";   // generating: poll again every 1.5 s
  lesson: Lesson | null;
  retry: RetryItem[] | null;                  // always 2 items when ready
  telemetry: Telemetry[];
}
export interface RetryResponse {
  gap_closed: boolean; concept_id: string; mastery_after: number;
  results: { question_id: string; correct: boolean; correct_answer: string }[];
}

export type Audience = "whole_class" | "reteach_group" | "practice_group" | "extend_group" | "individuals";
export interface Recommendation {
  id: string; round: number;
  stage: "draft" | "revised" | "final";
  audience: Audience; group_label: string; n_students: number;
  concept_id: string; concept_name: string; misconception_tag: string; label: string;
  headline: string; plan_5min: string[]; worked_example: string; why: string;
  flagged: boolean; analyst_note: string | null; approved: boolean;
}
export interface Critique { index: number; verdict: "accept" | "revise"; reason: string }
export interface AnalyzeStep {
  round: number;
  agent: "Coach" | "Analyst";
  action: "propose" | "critique" | "revise";
  recommendations?: Recommendation[];
  critiques?: Critique[];
}
export interface AnalyzeResponse { run_id: string; rounds: number; steps: AnalyzeStep[]; final: Recommendation[]; telemetry: Telemetry[] }

export interface ConceptStat {
  id: string; name: string; short: string;
  avg: number | null;                 // 0..1, null = nobody assessed
  responders: number; below_gap: number; open_gaps: number;
  top: { tag: string; label: string; students: number }[];
}
export interface StudentRef { id: string; nickname: string }
export interface Dashboard {
  session_id: string; class_name: string; code: string;
  n_students: number; n_simulated: number;
  concepts: ConceptStat[];
  edges: [string, string][];
  heatmap: {
    concept_ids: string[];
    students: { id: string; nickname: string; kind: StudentKind; language: Lang }[];
    cells: (number | null)[][];       // [student][concept], null = not assessed
  };
  groups: { reteach: StudentRef[]; practice: StudentRef[]; extend: StudentRef[]; not_assessed: StudentRef[] };
  focus_concept: string | null;
  gaps: { open: number; closed: number; rate: number };
  recommendations: Recommendation[];  // final plans from the latest Analyze run
}

export interface AgentEvent {
  seq: number; ts: string;
  agent: "Examiner" | "Diagnostician" | "Curator" | "Analyst" | "Coach" | "Simulator" | "Teacher";
  action: string;   // join select_question diagnose diagnose_photo lesson retry gap_closed analyze_class propose challenge accept revise flag_for_teacher approve parent_message simulate
  reason: string;   // one line, ≤240 chars
  student_id: string | null; student_nickname: string | null;
  telemetry: Telemetry[];
}
export interface EventsResponse { events: AgentEvent[]; last_seq: number }

export interface StudentDetail {
  id: string; nickname: string; language: Lang; kind: StudentKind;
  mastery: Record<string, number>; assessed: string[];
  gaps: { concept_id: string; status: "open" | "closed"; tag: string | null; label: string | null }[];
  responses: { question_id: string; stem: string; answer: string; correct: boolean; tag: string | null; label: string | null; source: string; phase: string; created_at: string }[];
}

export interface ParentMessage {
  language: Lang; message: string; whatsapp_url: string;
  audio_url: string | null;   // Kannada/Hindi/English voice note. Use <audio src={"/backend" + audio_url}>; the first play may take ~5 s
  telemetry: Telemetry[];
}
export interface JudgesSummary {
  numbers: { label: string; value: string; n: number | null; method: string }[];
  links: { app: string; repo: string; video: string | null; status_page: string | null };
}
