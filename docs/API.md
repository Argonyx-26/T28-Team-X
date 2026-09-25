# GuruGraph API contract

The frontend calls **`/backend/<path>`**, and `next.config` rewrites that to `${API_URL}/<path>`.
- **Local API:** `http://localhost:8000` (the interactive docs are at `/docs`).
- **Deployed API (Cloud Run, Mumbai):** `https://gurugraph-api-215071922486.asia-south1.run.app`. Try `/health` or `/docs`.

**Rate limits** (per IP, per minute): join 30, answers 120, photos 60, stack 5, analyze 10, review 60, approve 30, parent message 20. Over the limit: 429 `slow_down`.

**Conventions:**
- All bodies are JSON unless marked *multipart*.
- IDs go in the body or query string, never in the path.
- Errors look like `{"error": {"code": "not_found", "message": "…"}}` and carry the matching HTTP status.
- An LLM failure never returns a 500. It degrades to a template or to `needs_typed_answer`.

**Seeded on boot:**
- class **7B** ("Class 7B · Fractions") with **30 simulated students** (roll numbers 2–31);
- **Asha**, a demo student (Kannada, roll 1), who already has practice on C1–C3, so her first question is on C4.
- Every student has a `roll_no`; a page whose header says "Roll 7" is filed under roll 7, else under the nickname it names.

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
  rule_check: { status: "verified" | "consistent" | "mismatch" | "unverified"; note: string }; // exact-arithmetic evidence; show instead of a raw confidence
  mastery_after: number | null; gap_opened: boolean;
  telemetry: Telemetry[];
  // the exact step verifier (F1): the AI reads, arithmetic judges
  line_values: (string | null)[];     // one per transcribed line: its exact value as a/b, or null when the line has no arithmetic
  reproduced_by: string | null;       // the mal-rule (a misconception tag) whose procedure reproduces the wrong line exactly
  verifier: {                         // null when the photo couldn't be read
    status: "verified" | "unverified"; correct: boolean | null; error_step: number | null; tag: string | null;
    reproduced_by: string | null; evidence: string; reference: string | null; final: string | null;
    lines: { text: string; value: string | null; values: (string | null)[]; ok: boolean | null }[];
  } | null;
  problem: string;                    // the problem as posed: the bank stem, or the first line the student wrote (question_id AUTO)
}

// F2 snap mode and F3 homework check: one vision call reads a whole page (the header and every problem)
export interface PageProblem extends Omit<PhotoResponse, "student_id" | "mastery_after" | "gap_opened" | "telemetry"> {
  question_id: string;                // a bank id (P1–P4) when the fractions match exactly, else "AUTO"
  problem: string;                    // the problem as written on the page
  answer: string;                     // the right answer, from the bank or from exact arithmetic
  label_local: string | null;         // the mistake in the student's language
  feedback_local: string;             // one or two sentences in the student's language
}
export interface PageResponse {
  session_id: string; mode: "homework" | "snap";
  student_id: string | null; student_nickname: string | null;
  matched_by: "given" | "roll" | "nickname" | null;   // how the page was filed; null = unassigned (snap only)
  roll_no: number | null; name_on_page: string | null; // what the header said
  problems: PageProblem[];
  saved: boolean;                     // false when unassigned or unreadable; then POST /agents/diagnostician/page/file
  summary: { saved: number; wrong: number; gaps_opened: number } | null;
  unreadable: boolean;
  telemetry: Telemetry[];
}
export interface Digest {
  hours: number; homework_pages: number; snap_pages: number; students: number;
  problems: number; wrong: number; new_gaps: number;
  top_concepts: { id: string; name: string; gaps: number }[];
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
    students: { id: string; nickname: string; kind: StudentKind; language: Lang; roll_no: number | null }[];
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
| `POST /students/join` | `{code, nickname, language, roll_no?}` | `JoinResponse`. Joining as "Asha" on 7B resumes the demo Asha. Nickname rules: 2–24 characters, letters and digits in any script, a small blocklist; errors `nickname_too_short`, `nickname_too_long`, `nickname_characters`, `nickname_not_allowed`. `class_full` (409) above 60 students. 30 joins per minute per IP |
| `POST /agents/examiner/next` | `{student_id}` | `NextResponse` (5 questions per quiz) |
| `POST /agents/diagnostician/answer` | `{student_id, question_id, answer, phase?}`. For an MCQ, send the option text exactly. `phase` is `"quiz"` (default) or `"photo"`: the teacher typing the final answer from an unreadable page, which never counts toward the student's quiz | `AnswerResponse` |
| `POST /agents/diagnostician/photo` | *multipart*: `student_id`, `question_id` (P1–P4, or `AUTO` for any fraction problem: the first line the student wrote is the problem and exact arithmetic judges it; the concept follows the operator), `image` | `PhotoResponse` (≈3–8 s) |
| `POST /agents/diagnostician/page` | *multipart*: `image`, plus `student_id` (homework: the child's own page) or `session_id` (snap: filed by the roll number, else the nickname, written at the top), `mode` (`homework` \| `snap`), `language?` | `PageResponse` (≈3–8 s). One vision call reads the header and every problem; exact arithmetic judges each; readings are saved, the photo is discarded. Feed event `homework_page` / `snap_page`: "Homework · Asha (roll 1) · 3 problems · 1 wrong" |
| `POST /agents/diagnostician/page/file` | `{student_id, mode, problems: PageProblem[]}` (the readings that came back unassigned; text only) | `{student_id, student_nickname, problems, summary}` |
| `GET /teacher/digest` | `?session_id=&hours=24` | `Digest`: the morning card ("Since yesterday: 12 homework pages, 4 new gaps on adding fractions") |
| `POST /media/speak` | `{text, language}` | `{audio_url}`: text-to-speech (Chirp 3 HD) for feedback and lessons; fetch `/media/voice?id=` (503 `no_voice` when TTS is off) |
| `POST /agents/diagnostician/stack` | *multipart*: `question_id`, repeated `student_ids`, repeated `images` (same order, ≤40) | `{results: (PhotoResponse \| {student_id, error})[]}`. Reads 6 at a time (SHOULD: the notebook pile) |
| `POST /agents/curator/lesson` | `{student_id}` | `LessonResponse`. Poll while `generating` |
| `POST /agents/examiner/retry` | `{student_id, answers:[{question_id, answer}]}` | `RetryResponse` |
| `POST /agents/simulator/run` | `{session_id, n?:30}` | `{students_added, answers, gaps_closed, llm_calls:0}` |
| `POST /agents/analyst/analyze` | `{session_id}` | `AnalyzeResponse` (≤25 s; show a live "agents are debating" state) |
| `POST /teacher/review` | `{student_id, question_id, verdict: "agree"\|"change_tag"\|"change_step"\|"mark_correct", tag?, step?}` | `{ok, correct, misconception_tag, error_step, mastery_after}`. The teacher's word replaces the AI's |
| `POST /teacher/approve` | `{recommendation_id}` | `{ok:true}` |
| `GET /teacher/dashboard` | `?session_id=` | `Dashboard`. Poll every 2 s |
| `GET /teacher/events` | `?session_id=&after=<last_seq>` | `EventsResponse`. Poll every 1.5 s |
| `GET /teacher/student` | `?student_id=` | `StudentDetail` |
| `POST /agents/coach/parent-message` | `{student_id}` | `ParentMessage` (text at once; the voice note is generated in the background) |
| `GET /media/voice` | `?id=` | `audio/mpeg` (waits until the voice note is ready) |
| `POST /admin/reset` | header `X-Admin-Token` | `{ok:true}`: reseeds 7B and a fresh Asha |
| `GET /admin/health` | header `X-Admin-Token` | `{ok, version, demo_mode, providers, vision_model, text_model, cache:{llm, lessons}, demo_class:{students, real_joins}, last_photo_ms:number[]}` |
| `POST /admin/remove-student` | header `X-Admin-Token`; `{student_id}` | `{ok:true}`: removes a student and their answers from the class (409 `demo_student` for Asha) |
| `GET /admin/cache-export` | header `X-Admin-Token` | `{rows:[{key, agent, provider, model, response_json, created_at}]}`: the LLM cache, saved as `data/llm_cache_seed.jsonl` and loaded at boot so a fresh deploy starts warm |
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
