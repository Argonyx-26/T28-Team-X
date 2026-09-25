"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { FLAGS } from "@/lib/flags";
import { track } from "@/lib/raah";
import { usePenLength } from "@/lib/use-pen-length";

import {
  ApiError,
  type PageProblem,
  type PageResponse,
  type PhotoResult,
  type ReviewVerdict,
  type Topic,
  api,
} from "../../_dashboard/api";
import s from "../../_dashboard/dashboard.module.css";
import { fontVars } from "../../_dashboard/fonts";
import { TelemetryChip } from "../../_dashboard/shared";
import k from "./scan.module.css";

type Student = { id: string; nickname: string; kind: string };

type Sample = { src: string; question: string; student: string; note: string };

// At least one page for every problem. Asha's are real phone photos of real handwriting (data/evidence/photos).
const SAMPLES: Sample[] = [
  { src: "/samples/asha-p1-photo.jpg", question: "P1", student: "Asha", note: "real photo" },
  { src: "/samples/asha-p2-photo.jpg", question: "P2", student: "Asha", note: "real photo" },
  { src: "/samples/asha-p3-photo.jpg", question: "P3", student: "Asha", note: "real photo" },
  { src: "/samples/rahul-p3.jpg", question: "P3", student: "Rahul", note: "sample page" },
  { src: "/samples/meera-p4.jpg", question: "P4", student: "Meera", note: "sample page" },
];

const EVIDENCE: Record<string, { title: string; tone: string }> = {
  verified: { title: "Checked by exact arithmetic", tone: "var(--green)" },
  consistent: { title: "Steps checked by arithmetic, mistake named by AI", tone: "var(--ink-2)" },
  mismatch: { title: "Please check this one", tone: "var(--amber)" },
  unverified: { title: "Only the AI checked this", tone: "var(--graphite)" },
};

const PEN_PATH = "M8,22 C6,9 32,3 55,4 C80,5 97,11 95,21 C93,32 70,37 48,36 C24,35 5,31 7,19 C8,13 16,9 26,7";

type Box = [number, number, number, number];

/** What the notebook views need from a reading: a single photo's result or one problem on a page. */
type Reading = Pick<PhotoResult, "steps" | "error_step" | "label" | "line_values" | "verifier" | "correct">;

/** Phones take 4–12 MB photos; send a 1600 px JPEG instead so it uploads fast on mobile data. */
async function shrink(file: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ?? file;
  } catch {
    return file;
  }
}

function firstTelemetry(telemetry: PhotoResult["telemetry"]) {
  return telemetry.find((x) => x.ok) ?? telemetry[0];
}

/** A hand-drawn ellipse around one line of working, drawn like a teacher's red pen. */
function RedPenCircle() {
  const pen = usePenLength<SVGPathElement>();
  return (
    <svg className={k.circle} viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden>
      <path ref={pen} className={k.circlePath} d={PEN_PATH} />
    </svg>
  );
}

const pct = (v: number) => `${v / 10}%`;

/** One red-pen ellipse (and its margin note) placed on the photo over a line's box (0–1000 scale). */
function PenOnPhoto({ box, label, line }: { box: Box; label: string | null; line: number }) {
  const pen = usePenLength<SVGPathElement>();
  return (
    <>
      <svg
        className={k.photoPen}
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        aria-hidden
        style={{
          top: `calc(${pct(box[0])} - 1.5%)`,
          left: `calc(${pct(box[1])} - 2%)`,
          height: `calc(${pct(box[2] - box[0])} + 3%)`,
          width: `calc(${pct(box[3] - box[1])} + 4%)`,
        }}
      >
        <path ref={pen} className={k.circlePath} d={PEN_PATH} />
      </svg>
      {label && (
        <span
          className={`${k.photoLabel} ${s.hand}`}
          style={{ top: pct(box[2]), left: pct(box[1]) }}
          aria-label={`Line ${line} is wrong: ${label}`}
        >
          {label}
        </span>
      )}
    </>
  );
}

/** The photo with a red circle on every wrong line: one problem (a sample) or every problem on a page. */
function PhotoWithPen({
  src,
  marks,
  allRight,
}: {
  src: string;
  marks: { box: Box; label: string | null; line: number }[];
  allRight: boolean;
}) {
  return (
    <div className={k.photoWrap}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="The notebook photo" className={k.photoImg} />
      {marks.map((m, i) => (
        <PenOnPhoto key={i} {...m} />
      ))}
      {allRight && (
        <span className={`${k.tick} ${s.hand}`} aria-label="All steps right">
          ✓ all right
        </span>
      )}
    </div>
  );
}

function markFor(r: Reading & { line_boxes?: Box[] | null }): { box: Box; label: string | null; line: number } | null {
  if (r.correct || !r.error_step || !r.line_boxes) return null;
  const box = r.line_boxes[r.error_step - 1];
  return box ? { box, label: r.label, line: r.error_step } : null;
}

function NotebookResult({
  result,
  movingStep,
  onPickStep,
}: {
  result: Reading;
  movingStep: boolean;
  onPickStep: (step: number) => void;
}) {
  return (
    <div className={k.paper}>
      <ol className={k.lines} aria-label="The working, as read from the photo">
        {result.steps.map((line, i) => {
          const n = i + 1;
          const wrong = result.error_step === n;
          const value = result.line_values?.[i] ?? null;
          const check = result.verifier?.lines[i];
          return (
            <li key={`${n}-${result.error_step}`} className={k.line}>
              <button
                type="button"
                className={`${k.lineText} ${s.hand} ${movingStep ? k.pickable : ""}`}
                disabled={!movingStep}
                onClick={() => onPickStep(n)}
                aria-label={movingStep ? `Circle line ${n} instead` : undefined}
              >
                {line}
                {wrong && <RedPenCircle />}
              </button>
              {wrong && result.label && (
                <span className={`${k.margin} ${s.hand}`} aria-label={`Line ${n} is wrong: ${result.label}`}>
                  {result.label}
                </span>
              )}
              {value !== null && (
                <span
                  className={k.ledger}
                  style={{ color: check?.ok === false ? "var(--red-pen)" : "var(--graphite)" }}
                  aria-label={`Line ${n} equals ${value}${check?.ok === false ? ", which is wrong" : ""}`}
                >
                  = {value} {check?.ok === false ? "✗" : check?.ok ? "✓" : ""}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {result.correct && (
        <div className={`${k.tick} ${s.hand}`} aria-label="All steps right">
          ✓ all right
        </div>
      )}
      {result.verifier?.status === "verified" && result.verifier.reference && (
        <p className={k.ledgerNote}>
          Each line&apos;s exact value, in small type. The right answer is <strong>{result.verifier.reference}</strong>.
        </p>
      )}
    </div>
  );
}

type ReviewState = { state: "none" | "saving" | "done"; text?: string; corrected?: boolean };

const REVIEW_TEXT: Record<ReviewVerdict, string> = {
  agree: "You confirmed it. Saved to the class record.",
  change_tag: "Mistake changed. Your correction replaces the AI's.",
  change_step: "Circle moved. Your correction replaces the AI's.",
  mark_correct: "Marked right. The gap is removed if this was the only slip.",
};

/** The teacher's last word on one reading: confirm, or correct the mistake, the line, or the verdict. */
function ReviewBar({
  correct,
  tag,
  topic,
  review,
  picking,
  onPick,
  onReview,
}: {
  correct: boolean;
  tag: string | null;
  topic: Topic | null;
  review: ReviewState;
  picking: "none" | "tag" | "step";
  onPick: (p: "none" | "tag" | "step") => void;
  onReview: (verdict: ReviewVerdict, extra?: { tag?: string; step?: number }) => void;
}) {
  return (
    <div className={`${s.sheet} flex flex-col gap-2 p-3`} aria-label="Your review">
      {review.state === "done" ? (
        <p className="font-medium" style={{ color: "var(--green)" }}>
          ✓ {review.text}
        </p>
      ) : (
        <>
          <span className={s.muted}>You have the last word. Is this right?</span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`${s.button} ${s.primary}`}
              disabled={review.state === "saving"}
              onClick={() => onReview("agree")}
            >
              {correct ? "Yes, it's right" : "Yes, that's the mistake"}
            </button>
            {!correct && (
              <>
                <button type="button" className={s.button} onClick={() => onPick(picking === "tag" ? "none" : "tag")}>
                  Different mistake
                </button>
                <button type="button" className={s.button} onClick={() => onPick(picking === "step" ? "none" : "step")}>
                  Wrong line
                </button>
                <button type="button" className={s.button} onClick={() => onReview("mark_correct")}>
                  It&apos;s actually right
                </button>
              </>
            )}
          </div>
          {picking === "tag" && topic && (
            <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
              {topic.tags
                .filter((t) => t.tag !== "unclassified" && t.tag !== tag)
                .map((t) => (
                  <button
                    key={t.tag}
                    type="button"
                    className={`${s.button} justify-start text-left text-[0.9em]`}
                    onClick={() => onReview("change_tag", { tag: t.tag })}
                  >
                    {t.labels.en}
                  </button>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** One problem found on a whole page: its working with the red pen, the proof, and the teacher's review. */
function ProblemCard({
  index,
  problem,
  studentId,
  topic,
}: {
  index: number;
  problem: PageProblem;
  studentId: string;
  topic: Topic | null;
}) {
  const [p, setP] = useState(problem);
  const [review, setReview] = useState<ReviewState>({ state: "none" });
  const [picking, setPicking] = useState<"none" | "tag" | "step">("none");
  const [error, setError] = useState("");
  const evidence = EVIDENCE[p.rule_check.status];

  async function send(verdict: ReviewVerdict, extra: { tag?: string; step?: number } = {}) {
    setReview({ state: "saving" });
    setError("");
    try {
      const r = await api.review(studentId, p.question_id, verdict, { ...extra, response_id: p.response_id });
      const label = r.misconception_tag
        ? topic?.tags.find((t) => t.tag === r.misconception_tag)?.labels.en ?? r.misconception_tag
        : null;
      setP({ ...p, correct: r.correct, misconception_tag: r.misconception_tag, label, error_step: r.error_step });
      setReview({ state: "done", text: REVIEW_TEXT[verdict], corrected: verdict !== "agree" });
      setPicking("none");
    } catch (e) {
      setReview({ state: "none" });
      setError(e instanceof ApiError ? e.message : "The review couldn't be saved.");
    }
  }

  return (
    <article className="flex flex-col gap-2" aria-label={`Problem ${index + 1}: ${p.problem}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">
          <span className={s.muted}>Problem {index + 1}:</span> <span className={s.hand}>{p.problem}</span>
        </h3>
        <span
          style={{ color: p.needs_typed_answer ? "var(--amber)" : p.correct ? "var(--green)" : "var(--red-pen)" }}
          className="text-[0.9em] font-semibold"
        >
          {p.not_fractions
            ? `${p.correct ? "✓ right" : "✗ wrong"} · whole numbers, not saved`
            : p.needs_typed_answer
              ? p.unanswered
                ? "no answer yet"
                : "unclear"
              : p.correct
                ? "✓ right"
                : "✗ to fix"}
        </span>
      </div>
      <NotebookResult result={p} movingStep={picking === "step"} onPickStep={(step) => void send("change_step", { step })} />
      {!p.correct && p.label && (
        <p className="text-[1em]">
          <strong>Line {p.error_step ?? "?"}:</strong> {p.label}.{" "}
          {!review.corrected && p.feedback && <span className={s.muted}>{p.feedback}</span>}
        </p>
      )}
      {evidence && !review.corrected && (
        <div className={k.evidence} style={{ borderLeftColor: evidence.tone }}>
          <strong style={{ color: evidence.tone }}>{evidence.title}.</strong> {p.rule_check.note}
        </div>
      )}
      {p.response_id ? (
        <ReviewBar
          correct={p.correct}
          tag={p.misconception_tag}
          topic={topic}
          review={review}
          picking={picking}
          onPick={setPicking}
          onReview={(v, extra) => void send(v, extra)}
        />
      ) : null}
      {error && (
        <p role="alert" style={{ color: "var(--red-pen)" }}>
          {error}
        </p>
      )}
    </article>
  );
}

export function Scan({ code }: { code: string }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [studentId, setStudentId] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "reading" | "done" | "error">("idle");
  const [error, setError] = useState("");
  // a sample page: one known problem, read by the single-problem endpoint (the judged demo path)
  const [result, setResult] = useState<PhotoResult | null>(null);
  // a real photo: every problem on the page, each checked as written
  const [page, setPage] = useState<PageResponse | null>(null);
  const [pageStudent, setPageStudent] = useState("");
  const [review, setReview] = useState<ReviewState>({ state: "none" });
  const [picking, setPicking] = useState<"none" | "tag" | "step">("none");
  const [typed, setTyped] = useState("");
  const [view, setView] = useState<"photo" | "transcript">("photo");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const session = await api.lookup(code);
        const [dash, t] = await Promise.all([api.dashboard(session.session_id), api.topic()]);
        if (!live) return;
        setSessionId(session.session_id);
        const list = dash.heatmap.students.map(({ id, nickname, kind }) => ({ id, nickname, kind }));
        setStudents(list);
        setStudentId(list.find((x) => x.kind === "demo")?.id ?? list[0]?.id ?? "");
        setTopic(t);
      } catch (e) {
        if (live) setError(e instanceof ApiError ? e.message : "Can't reach the server. Check the connection.");
      }
    })();
    return () => {
      live = false;
    };
  }, [code]);

  const student = students.find((x) => x.id === studentId);
  const nameOf = (id: string) => students.find((x) => x.id === id)?.nickname ?? "The student";

  /** Only the newest read may fill the screen: a slow answer for an earlier photo is dropped. */
  const readSeq = useRef(0);

  function startReading(src: string) {
    readSeq.current += 1;
    setPreview((old) => {
      if (old?.startsWith("blob:") && old !== src) URL.revokeObjectURL(old);
      return src;
    });
    setStatus("reading");
    setResult(null);
    setPage(null);
    setReview({ state: "none" });
    setPicking("none");
    setError("");
    setView("photo");
  }

  /** A real photo: every problem on the page is found and checked as written, and filed under this student. */
  async function readPage(file: Blob) {
    const who = studentId;
    if (!who) return;
    startReading(URL.createObjectURL(file));
    const mine = readSeq.current;
    setPageStudent(who);
    try {
      const r = await api.page(await shrink(file), { studentId: who }, "scan");
      if (mine !== readSeq.current) return;
      setPage(r);
      setStatus("done");
      const t = firstTelemetry(r.telemetry);
      track("photo_diagnosed", {
        source: "camera",
        problems: r.problems.length,
        wrong: r.problems.filter((x) => !x.correct).length,
        ms: t?.ms,
        cached: t?.cached,
      });
    } catch (e) {
      if (mine !== readSeq.current) return;
      setError(e instanceof ApiError ? e.message : "The photo couldn't be read. Check the connection and try again.");
      setStatus("error");
    }
  }

  /** A sample page belongs to the student who wrote it and shows one known problem. */
  async function trySample(sample: Sample) {
    const who = students.find((x) => x.nickname.toLowerCase() === sample.student.toLowerCase())?.id ?? studentId;
    if (!who) return;
    setStudentId(who);
    setPageStudent(who);
    startReading(sample.src);
    const mine = readSeq.current;
    try {
      const blob = await (await fetch(sample.src)).blob();
      const r = await api.photo(who, sample.question, blob);
      if (mine !== readSeq.current) return;
      setResult(r);
      setStatus("done");
      const t = firstTelemetry(r.telemetry);
      track("photo_diagnosed", { source: "sample", correct: r.correct, tag: r.misconception_tag ?? "none", ms: t?.ms, cached: t?.cached });
    } catch (e) {
      if (mine !== readSeq.current) return;
      setError(e instanceof ApiError ? e.message : "The sample page didn't load. Check the connection and try again.");
      setStatus("error");
    }
  }

  async function sendReview(verdict: ReviewVerdict, extra: { tag?: string; step?: number } = {}) {
    if (!result) return;
    setReview({ state: "saving" });
    try {
      const r = await api.review(result.student_id, result.question_id, verdict, extra);
      const label = r.misconception_tag
        ? topic?.tags.find((t) => t.tag === r.misconception_tag)?.labels.en ?? r.misconception_tag
        : null;
      setResult({ ...result, correct: r.correct, misconception_tag: r.misconception_tag, label, error_step: r.error_step });
      setReview({ state: "done", text: REVIEW_TEXT[verdict], corrected: verdict !== "agree" });
      setPicking("none");
    } catch (e) {
      setReview({ state: "none" });
      setError(e instanceof ApiError ? e.message : "The review couldn't be saved.");
    }
  }

  async function sendTyped() {
    if (!typed.trim() || !result) return;
    try {
      const r = await api.typedAnswer(result.student_id, result.question_id, typed.trim());
      setResult({
        ...result,
        needs_typed_answer: false,
        correct: r.correct,
        misconception_tag: r.misconception_tag,
        label: r.label_en,
        steps: result.steps.length ? result.steps : [typed.trim()],
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The answer couldn't be saved.");
    }
  }

  const stemOf = (qid: string) => topic?.photo_questions.find((q) => q.id === qid)?.stem.replace(/\s*=\s*\?$/, "") ?? qid;
  const evidence = result ? EVIDENCE[result.rule_check.status] : null;
  const pageMarks = page ? page.problems.map(markFor).filter((m): m is NonNullable<typeof m> => m !== null) : [];
  const pageHasBoxes = page ? page.problems.some((p) => p.line_boxes) : false;
  const wrongOnPage = page ? page.problems.filter((p) => !p.correct).length : 0;

  return (
    <main className={`${s.root} ${fontVars} min-h-dvh`}>
      <div className="mx-auto flex max-w-[720px] flex-col gap-4 px-4 pb-10 pt-4">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <Link href={`/teacher/${encodeURIComponent(code)}`} className={`${s.hand} text-[1.6em] font-bold`}>
              GuruGraph
            </Link>
            <span className={s.muted}>Scan a notebook</span>
          </div>
          <Link className={s.button} href={`/teacher/${encodeURIComponent(code)}`}>
            Class dashboard
          </Link>
        </header>

        <section className={`${s.sheet} flex flex-col gap-3 p-4`} aria-label="Whose notebook">
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Student</span>
            <select
              className={`${s.button} ${s.focusable} w-full justify-between text-base`}
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              disabled={!students.length}
            >
              {students.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nickname}
                  {x.kind === "simulated" ? " (simulated)" : x.kind === "demo" ? " (demo)" : ""}
                </option>
              ))}
            </select>
          </label>
          <p className={`${s.muted} text-[0.9em]`}>
            Photograph any page of fraction working, from any textbook. Every problem on it is found and checked by exact
            arithmetic; the AI only reads the handwriting.
          </p>
        </section>

        <section className="flex flex-col gap-2" aria-label="Photo">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            aria-hidden="true"
            tabIndex={-1}
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readPage(file);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className={`${s.button} ${s.primary} ${k.big}`}
            disabled={!studentId || status === "reading"}
            onClick={() => fileInput.current?.click()}
          >
            {status === "reading" ? "Reading the page…" : `Photograph or upload ${student?.nickname ?? "a"}'s page`}
          </button>
          <div className="flex flex-wrap items-center gap-2 text-[0.9em]">
            <span className={s.muted}>No notebook handy? Try a sample page:</span>
            {SAMPLES.map((x) => (
              <button
                key={x.src}
                type="button"
                className={s.button}
                disabled={status === "reading" || !students.length}
                onClick={() => void trySample(x)}
              >
                {x.student}&apos;s page: <span className={s.hand}>{stemOf(x.question)}</span>{" "}
                <span className={s.muted}>({x.note})</span>
              </button>
            ))}
          </div>
        </section>

        {error && (
          <div className={`${s.feedItem} ${s.challenge}`} role="alert">
            {error}
          </div>
        )}

        {status === "reading" && preview && (
          <div className={k.scanning} aria-live="polite">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="The notebook photo being read" className={k.previewImg} />
            <div className={k.sweep} aria-hidden />
            <span className={k.scanningLabel}>Reading every line of working…</span>
          </div>
        )}

        {status === "done" && page && (
          <section className="flex flex-col gap-4" aria-label="Diagnosis" aria-live="polite">
            {page.unreadable || page.problems.length === 0 ? (
              <div className={`${s.sheet} flex flex-col gap-2 p-4`}>
                <p className="font-semibold">No fraction working was found on this page.</p>
                <p className={s.muted}>
                  Take the photo closer, in good light, with the working in view. Nothing was saved for {nameOf(pageStudent)}.
                </p>
              </div>
            ) : (
              <>
                <h2 className="text-[1.2em] font-semibold">
                  {nameOf(pageStudent)}&apos;s page:{" "}
                  <span className={s.highlight}>
                    {page.problems.length} problem{page.problems.length === 1 ? "" : "s"}, {wrongOnPage} to fix
                  </span>
                </h2>
                {FLAGS.PHOTO_PEN && preview && pageHasBoxes && (
                  <PhotoWithPen src={preview} marks={pageMarks} allRight={wrongOnPage === 0} />
                )}
                {page.problems.map((p, i) => (
                  <ProblemCard key={`${i}-${p.response_id ?? i}`} index={i} problem={p} studentId={pageStudent} topic={topic} />
                ))}
                <div className="flex flex-wrap gap-1">
                  {page.telemetry.map((t, i) => (
                    <TelemetryChip key={i} t={t} />
                  ))}
                </div>
              </>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={s.button} onClick={() => fileInput.current?.click()}>
                Scan the next page
              </button>
              <Link className={`${s.button} ${s.primary}`} href={`/teacher/${encodeURIComponent(code)}`}>
                See it on the class dashboard
              </Link>
            </div>
          </section>
        )}

        {status === "done" && result && (
          <section className="flex flex-col gap-3" aria-label="Diagnosis" aria-live="polite">
            {result.needs_typed_answer ? (
              <div className={`${s.sheet} flex flex-col gap-2 p-4`}>
                <p className="font-semibold">
                  {result.no_working
                    ? "No fraction working was found on this photo."
                    : result.unanswered
                      ? "The problem is written, but no answer is written after it yet. Nothing was saved."
                      : result.not_fractions
                        ? "This working has whole numbers only, so it isn't saved as a fractions answer."
                      : "This photo wasn't clear enough to read."}
                </p>
                <p className={s.muted}>
                  Type the final answer from the notebook instead. It is saved as a notebook reading, not as a quiz answer.
                </p>
                <div className="flex gap-2">
                  <input
                    className={`${s.button} ${s.focusable} flex-1 text-base`}
                    inputMode="text"
                    placeholder="e.g. 4/8"
                    aria-label="The final answer from the notebook"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                  />
                  <button type="button" className={`${s.button} ${s.primary}`} onClick={() => void sendTyped()}>
                    Save answer
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="text-[1.2em] font-semibold">
                    {nameOf(result.student_id)}&apos;s working{result.problem ? `: ${result.problem}` : ""}
                  </h2>
                  {picking === "step" && (
                    <span className={`${s.hand}`} style={{ color: "var(--red-pen)" }}>
                      tap the wrong line
                    </span>
                  )}
                </div>
                {result.problem_note && <p className={`${s.muted} text-[0.9em]`}>{result.problem_note}</p>}
                {FLAGS.PHOTO_PEN && result.line_boxes && preview && picking !== "step" && (
                  <div className="flex gap-1" role="tablist" aria-label="Show the photo or the transcript">
                    {(["photo", "transcript"] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        role="tab"
                        aria-selected={view === v}
                        className={`${s.button} ${view === v ? s.primary : ""} min-h-9 text-[0.9em]`}
                        onClick={() => setView(v)}
                      >
                        {v === "photo" ? "Red pen on the photo" : "Transcript"}
                      </button>
                    ))}
                  </div>
                )}
                {FLAGS.PHOTO_PEN && result.line_boxes && preview && view === "photo" && picking !== "step" ? (
                  <PhotoWithPen
                    src={preview}
                    marks={[markFor(result)].filter((m): m is NonNullable<typeof m> => m !== null)}
                    allRight={result.correct}
                  />
                ) : (
                  <NotebookResult
                    result={result}
                    movingStep={picking === "step"}
                    onPickStep={(step) => void sendReview("change_step", { step })}
                  />
                )}
                {!result.correct && result.label && (
                  <p className="text-[1.05em]">
                    <strong>Line {result.error_step ?? "?"}:</strong> {result.label}.{" "}
                    {!review.corrected && <span className={s.muted}>{result.feedback}</span>}
                  </p>
                )}
                {evidence && !review.corrected && (
                  <div className={k.evidence} style={{ borderLeftColor: evidence.tone }}>
                    <strong style={{ color: evidence.tone }}>{evidence.title}.</strong> {result.rule_check.note}
                  </div>
                )}
                <ReviewBar
                  correct={result.correct}
                  tag={result.misconception_tag}
                  topic={topic}
                  review={review}
                  picking={picking}
                  onPick={setPicking}
                  onReview={(v, extra) => void sendReview(v, extra)}
                />
                <div className="flex flex-wrap gap-1">
                  {result.telemetry.map((t, i) => (
                    <TelemetryChip key={i} t={t} />
                  ))}
                </div>
              </>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={s.button} onClick={() => fileInput.current?.click()}>
                Scan a real page
              </button>
              <Link className={`${s.button} ${s.primary}`} href={`/teacher/${encodeURIComponent(code)}`}>
                See it on the class dashboard
              </Link>
            </div>
          </section>
        )}

        {!sessionId && !error && <p className={s.muted}>Loading the class…</p>}
      </div>
    </main>
  );
}
