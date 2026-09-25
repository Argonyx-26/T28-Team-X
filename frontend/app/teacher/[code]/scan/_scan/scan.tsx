"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { track } from "@/lib/raah";
import { usePenLength } from "@/lib/use-pen-length";

import { ApiError, type PhotoResult, type ReviewVerdict, type Topic, api } from "../../_dashboard/api";
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
  consistent: { title: "Answer checked, mistake read by AI", tone: "var(--ink-2)" },
  mismatch: { title: "Please check this one", tone: "var(--amber)" },
  unverified: { title: "Only the AI checked this", tone: "var(--graphite)" },
};

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

function trackPhoto(r: PhotoResult, source: "camera" | "sample") {
  const t = r.telemetry.find((x) => x.ok) ?? r.telemetry[0];
  track("photo_diagnosed", {
    source,
    correct: r.correct,
    tag: r.misconception_tag ?? "none",
    ms: t?.ms,
    model: t?.model,
    cached: t?.cached,
  });
}

/** A hand-drawn ellipse around one line of working, drawn like a teacher's red pen. */
function RedPenCircle() {
  const pen = usePenLength<SVGPathElement>();
  return (
    <svg className={k.circle} viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden>
      <path
        ref={pen}
        className={k.circlePath}
        d="M8,22 C6,9 32,3 55,4 C80,5 97,11 95,21 C93,32 70,37 48,36 C24,35 5,31 7,19 C8,13 16,9 26,7"
      />
    </svg>
  );
}

function NotebookResult({
  result,
  movingStep,
  onPickStep,
}: {
  result: PhotoResult;
  movingStep: boolean;
  onPickStep: (step: number) => void;
}) {
  return (
    <div className={k.paper}>
      <ol className={k.lines} aria-label="The working, as read from the photo">
        {result.steps.map((line, i) => {
          const n = i + 1;
          const wrong = result.error_step === n;
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
            </li>
          );
        })}
      </ol>
      {result.correct && (
        <div className={`${k.tick} ${s.hand}`} aria-label="All steps right">
          ✓ all right
        </div>
      )}
    </div>
  );
}

export function Scan({ code }: { code: string }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [studentId, setStudentId] = useState("");
  const [questionId, setQuestionId] = useState("P1");
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "reading" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<PhotoResult | null>(null);
  const [review, setReview] = useState<{ state: "none" | "saving" | "done"; text?: string; corrected?: boolean }>({
    state: "none",
  });
  const [picking, setPicking] = useState<"none" | "tag" | "step">("none");
  const [typed, setTyped] = useState("");
  const [wrongProblem, setWrongProblem] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // the last photo and whose it was, so "read it as the other problem" doesn't need a new photo
  const lastPhoto = useRef<{ blob: Blob; studentId: string; source: "camera" | "sample" } | null>(null);

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

  const question = topic?.photo_questions.find((q) => q.id === questionId);
  const student = students.find((x) => x.id === studentId);

  /** Sends one photo for one student and problem. Every argument is explicit, so it never reads stale state. */
  async function diagnose(blob: Blob, who: string, qid: string, source: "camera" | "sample") {
    lastPhoto.current = { blob, studentId: who, source };
    setStatus("reading");
    setResult(null);
    setReview({ state: "none" });
    setPicking("none");
    setError("");
    setWrongProblem(null);
    try {
      const r = await api.photo(who, qid, blob);
      setResult(r);
      setStatus("done");
      trackPhoto(r, source);
    } catch (e) {
      if (e instanceof ApiError && e.code === "wrong_problem") {
        // the message quotes the problem the page shows; offer to read it as that one
        setWrongProblem(topic?.photo_questions.find((q) => q.id !== qid && e.message.includes(q.stem))?.id ?? null);
      }
      setError(e instanceof ApiError ? e.message : "The photo couldn't be read. Check the connection and try again.");
      setStatus("error");
    }
  }

  async function read(image: Blob) {
    if (!studentId) return;
    setPreview((old) => {
      if (old?.startsWith("blob:")) URL.revokeObjectURL(old);
      return URL.createObjectURL(image);
    });
    await diagnose(await shrink(image), studentId, questionId, "camera");
  }

  async function trySample(sample: Sample) {
    // a sample belongs to the student who wrote it; in another class, it goes to whoever is selected
    const who = students.find((x) => x.nickname.toLowerCase() === sample.student.toLowerCase())?.id ?? studentId;
    if (!who) return;
    setStudentId(who);
    setQuestionId(sample.question);
    setPreview(sample.src);
    try {
      const blob = await (await fetch(sample.src)).blob();
      await diagnose(blob, who, sample.question, "sample");
    } catch {
      setError("The sample page didn't load. Check the connection and try again.");
      setStatus("error");
    }
  }

  async function readAsOtherProblem(qid: string) {
    const last = lastPhoto.current;
    if (!last) return;
    setQuestionId(qid);
    await diagnose(last.blob, last.studentId, qid, last.source);
  }

  const samples = SAMPLES.filter((x) => x.question === questionId);

  async function sendReview(verdict: ReviewVerdict, extra: { tag?: string; step?: number } = {}) {
    if (!result) return;
    setReview({ state: "saving" });
    try {
      const r = await api.review(result.student_id, result.question_id, verdict, extra);
      const label = r.misconception_tag
        ? topic?.tags.find((t) => t.tag === r.misconception_tag)?.labels.en ?? r.misconception_tag
        : null;
      setResult({
        ...result,
        correct: r.correct,
        misconception_tag: r.misconception_tag,
        label,
        error_step: r.error_step,
      });
      const text = {
        agree: "You confirmed it. Saved to the class record.",
        change_tag: "Mistake changed. Your correction replaces the AI's.",
        change_step: "Circle moved. Your correction replaces the AI's.",
        mark_correct: "Marked right. The gap is removed if this was the only slip.",
      }[verdict];
      setReview({ state: "done", text, corrected: verdict !== "agree" });
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

  const evidence = result ? EVIDENCE[result.rule_check.status] : null;

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
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 font-semibold">Which problem</legend>
            <div className="grid grid-cols-2 gap-2">
              {topic?.photo_questions.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  aria-pressed={q.id === questionId}
                  onClick={() => setQuestionId(q.id)}
                  className={`${k.problem} ${q.id === questionId ? k.problemOn : ""}`}
                >
                  <span className={s.hand}>{q.stem}</span>
                </button>
              ))}
            </div>
          </fieldset>
        </section>

        <section className="flex flex-col gap-2" aria-label="Photo">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            aria-label="Photograph the notebook page"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void read(file);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className={`${s.button} ${s.primary} ${k.big}`}
            disabled={!studentId || status === "reading"}
            onClick={() => fileInput.current?.click()}
          >
            {status === "reading" ? "Reading the working…" : `Photograph ${student?.nickname ?? "the"}'s notebook`}
          </button>
          {samples.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-[0.9em]">
              <span className={s.muted}>No notebook handy? Try a page for this problem:</span>
              {samples.map((x) => (
                <button
                  key={x.src}
                  type="button"
                  className={s.button}
                  disabled={status === "reading" || !students.length}
                  onClick={() => void trySample(x)}
                >
                  {x.student}&apos;s page <span className={s.muted}>({x.note})</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {error && (
          <div className={`${s.feedItem} ${s.challenge}`} role="alert">
            {error}
            {wrongProblem && (
              <button
                type="button"
                className={`${s.button} ${s.primary} mt-2`}
                onClick={() => void readAsOtherProblem(wrongProblem)}
              >
                Read it as {topic?.photo_questions.find((q) => q.id === wrongProblem)?.stem}
              </button>
            )}
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

        {status === "done" && result && (
          <section className="flex flex-col gap-3" aria-label="Diagnosis" aria-live="polite">
            {result.needs_typed_answer ? (
              <div className={`${s.sheet} flex flex-col gap-2 p-4`}>
                <p className="font-semibold">This photo wasn&apos;t clear enough to read.</p>
                <p className={s.muted}>Type the final answer from the notebook instead. It is saved as a notebook reading, not as a quiz answer.</p>
                <div className="flex gap-2">
                  <input
                    className={`${s.button} ${s.focusable} flex-1 text-base`}
                    inputMode="text"
                    placeholder="e.g. 4/8"
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
                    {student?.nickname}&apos;s working{question ? `: ${question.stem}` : ""}
                  </h2>
                  {picking === "step" && <span className={`${s.hand}`} style={{ color: "var(--red-pen)" }}>tap the wrong line</span>}
                </div>
                <NotebookResult
                  result={result}
                  movingStep={picking === "step"}
                  onPickStep={(step) => void sendReview("change_step", { step })}
                />
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
                          onClick={() => void sendReview("agree")}
                        >
                          Yes, that&apos;s the mistake
                        </button>
                        {!result.correct && (
                          <>
                            <button type="button" className={s.button} onClick={() => setPicking(picking === "tag" ? "none" : "tag")}>
                              Different mistake
                            </button>
                            <button type="button" className={s.button} onClick={() => setPicking(picking === "step" ? "none" : "step")}>
                              Wrong line
                            </button>
                            <button type="button" className={s.button} onClick={() => void sendReview("mark_correct")}>
                              It&apos;s actually right
                            </button>
                          </>
                        )}
                      </div>
                      {picking === "tag" && topic && (
                        <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
                          {topic.tags
                            .filter((t) => t.tag !== "unclassified" && t.tag !== result.misconception_tag)
                            .map((t) => (
                              <button
                                key={t.tag}
                                type="button"
                                className={`${s.button} justify-start text-left text-[0.9em]`}
                                onClick={() => void sendReview("change_tag", { tag: t.tag })}
                              >
                                {t.labels.en}
                              </button>
                            ))}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="flex flex-wrap gap-1">
                  {result.telemetry.map((t, i) => (
                    <TelemetryChip key={i} t={t} />
                  ))}
                </div>
              </>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={s.button} onClick={() => fileInput.current?.click()}>
                Scan the next notebook
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
