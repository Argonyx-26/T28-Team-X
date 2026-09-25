# GuruGraph API contract

The frontend calls **`/backend/<path>`**, and `next.config` rewrites that to `${API_URL}/<path>`.
- **Local API:** `http://localhost:8000` (the interactive docs are at `/docs`).
- **Deployed API (Cloud Run, Mumbai):** `https://gurugraph-api-215071922486.asia-south1.run.app`. Try `/health` or `/docs`.

**Conventions:**
- All bodies are JSON unless marked *multipart*.
- IDs go in the body or query string, never in the path.
- Errors look like `{"error": {"code": "not_found", "message": "…"}}` and carry the matching HTTP status.
- An LLM failure never returns a 500. It degrades to a template or to `needs_typed_answer`.

**Seeded on boot:**
- class **7B** ("Class 7B · Fractions") with **30 simulated students**;
- **Asha**, a demo student (Kannada), who already has practice on C1–C3, so her first question is on C4.

## TypeScript types (copy into `frontend/lib/types.ts`)

```ts
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
  gap_opened: boolean;
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
```

## Endpoints

| Method + path | Body / query | Returns |
|---|---|---|
| `GET /health` | – | `{ok, version, demo_mode, providers:{nebius, vertex}}` |
| `GET /topic` | – | `TopicResponse` |
| `POST /sessions/create` | `{class_name, code?}` | `SessionLookup & {join_url}` |
| `GET /sessions/lookup` | `?code=7B` | `SessionLookup` (404 if the code is unknown) |
| `POST /students/join` | `{code, nickname, language}` | `JoinResponse`. Joining as "Asha" on 7B resumes the demo Asha |
| `POST /agents/examiner/next` | `{student_id}` | `NextResponse` (5 questions per quiz) |
| `POST /agents/diagnostician/answer` | `{student_id, question_id, answer}`. For an MCQ, send the option text exactly | `AnswerResponse` |
| `POST /agents/diagnostician/photo` | *multipart*: `student_id`, `question_id` (P1–P4), `image` | `PhotoResponse` (≈3–8 s) |
| `POST /agents/curator/lesson` | `{student_id}` | `LessonResponse`. Poll while `generating` |
| `POST /agents/examiner/retry` | `{student_id, answers:[{question_id, answer}]}` | `RetryResponse` |
| `POST /agents/simulator/run` | `{session_id, n?:30}` | `{students_added, answers, gaps_closed, llm_calls:0}` |
| `POST /agents/analyst/analyze` | `{session_id}` | `AnalyzeResponse` (≤25 s; show a live "agents are debating" state) |
| `POST /teacher/approve` | `{recommendation_id}` | `{ok:true}` |
| `GET /teacher/dashboard` | `?session_id=` | `Dashboard`. Poll every 2 s |
| `GET /teacher/events` | `?session_id=&after=<last_seq>` | `EventsResponse`. Poll every 1.5 s |
| `GET /teacher/student` | `?student_id=` | `StudentDetail` |
| `POST /agents/coach/parent-message` | `{student_id}` | `ParentMessage` (text at once; the voice note is generated in the background) |
| `GET /media/voice` | `?id=` | `audio/mpeg` (waits until the voice note is ready) |
| `POST /admin/reset` | header `X-Admin-Token` | `{ok:true}`: reseeds 7B and a fresh Asha |
| `GET /judges/summary` | – | `JudgesSummary` |

## The demo path (the thing we're judged on)
1. **The teacher scans Asha's notebook.** Open `/teacher/7B/scan` and pick student Asha and question P1 (`3/4 + 1/4`). The response comes back with `steps` and `error_step: 2`, and the UI **circles line 2 in red pen**. The label reads "added the denominators too". Asha's C4 cell turns red on the dashboard.
2. **The dashboard shows the class.** Open `/teacher/7B`: the graph with the focus concept, the heatmap and the live agent feed.
3. **The teacher presses Analyze.**
   1. The Coach drafts a whole-class plan.
   2. The Analyst challenges it: "Only 9 of 31 students show …".
   3. The Coach revises.
   4. The teacher approves.
4. **The judge plays Asha** on a phone at `/join/7B?as=asha`:
   1. A C4 question appears, and they tap the wrong answer.
   2. Feedback arrives in Kannada.
   3. A Kannada micro-lesson follows.
   4. 2 retry questions.
   5. **Gap closed.** The dashboard meter moves.
5. **The parent message** goes out on WhatsApp.
