"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { AUTO_QUESTION, ApiError, type PhotoResult, type Topic, api } from "../../_dashboard/api";
import s from "../../_dashboard/dashboard.module.css";
import { fontVars } from "../../_dashboard/fonts";
import k from "./pile.module.css";

type Student = { id: string; nickname: string; kind: string };
type Item = {
  key: string;
  src: string;
  blob: Blob;
  studentId: string;
  state: "waiting" | "reading" | "done" | "error";
  result?: PhotoResult;
  error?: string;
};

const SAMPLE_PILE = Array.from({ length: 6 }, (_, i) => `/samples/pile/p1-${i + 1}.jpg`);
const PARALLEL = 6;

async function shrink(file: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return (await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85))) ?? file;
  } catch {
    return file;
  }
}

export function Pile({ code }: { code: string }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [topic, setTopic] = useState<Topic | null>(null);
  const [questionId, setQuestionId] = useState("P1");
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const session = await api.lookup(code);
        const [dash, t] = await Promise.all([api.dashboard(session.session_id), api.topic()]);
        if (!live) return;
        setStudents(dash.heatmap.students.map(({ id, nickname, kind }) => ({ id, nickname, kind })));
        setTopic(t);
      } catch (e) {
        if (live) setError(e instanceof ApiError ? e.message : "Can't reach the server. Check the connection.");
      }
    })();
    return () => {
      live = false;
    };
  }, [code]);

  // notebooks are matched to students in class-list order; the teacher can change any of them
  function assign(blobs: { blob: Blob; src: string }[]) {
    const order = [...students.filter((x) => x.kind !== "demo"), ...students.filter((x) => x.kind === "demo")];
    setElapsed(null);
    setItems(
      blobs.map((b, i) => ({
        key: `${Date.now()}-${i}`,
        src: b.src,
        blob: b.blob,
        studentId: order[i % Math.max(order.length, 1)]?.id ?? "",
        state: "waiting",
      })),
    );
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const list = await Promise.all(
      Array.from(files).map(async (f) => {
        const blob = await shrink(f);
        return { blob, src: URL.createObjectURL(blob) };
      }),
    );
    assign(list);
  }

  async function loadSamplePile() {
    setQuestionId("P1");
    const list = await Promise.all(
      SAMPLE_PILE.map(async (src) => ({ src, blob: await (await fetch(src)).blob() })),
    );
    assign(list);
  }

  async function readAll() {
    setRunning(true);
    setError("");
    const started = performance.now();
    const queue = items.map((_, i) => i);
    const update = (i: number, patch: Partial<Item>) =>
      setItems((old) => old.map((it, j) => (j === i ? { ...it, ...patch } : it)));
    async function worker() {
      for (let i = queue.shift(); i !== undefined; i = queue.shift()) {
        update(i, { state: "reading" });
        try {
          const result = await api.photo(items[i].studentId, questionId, items[i].blob);
          update(i, { state: "done", result });
        } catch (e) {
          update(i, { state: "error", error: e instanceof ApiError ? e.message : "Couldn't read this one." });
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, worker));
    setElapsed((performance.now() - started) / 1000);
    setRunning(false);
  }

  const done = items.filter((i) => i.state === "done" && i.result);
  const wrong = done.filter((i) => !i.result?.correct && !i.result?.needs_typed_answer);
  const right = done.filter((i) => i.result?.correct);
  const unreadable = items.filter((i) => i.state === "error" || i.result?.needs_typed_answer);
  const byLabel = new Map<string, number>();
  for (const i of wrong) {
    const label = i.result?.label ?? "unclear mistake";
    byLabel.set(label, (byLabel.get(label) ?? 0) + 1);
  }
  const topMistakes = [...byLabel.entries()].sort((a, b) => b[1] - a[1]);
  const question =
    questionId === AUTO_QUESTION ? { id: AUTO_QUESTION, stem: "any fraction problem" } : topic?.photo_questions.find((q) => q.id === questionId);
  const nameOf = (id: string) => students.find((x) => x.id === id)?.nickname ?? "?";

  return (
    <main className={`${s.root} ${fontVars} min-h-dvh`}>
      <div className="mx-auto flex max-w-[1100px] flex-col gap-4 px-4 pb-10 pt-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <Link href={`/teacher/${encodeURIComponent(code)}`} className={`${s.hand} text-[1.6em] font-bold`}>
              GuruGraph
            </Link>
            <span className={s.muted}>Read a pile of notebooks</span>
          </div>
          <div className="flex gap-2">
            <Link className={s.button} href={`/teacher/${encodeURIComponent(code)}/scan`}>
              Scan one notebook
            </Link>
            <Link className={s.button} href={`/teacher/${encodeURIComponent(code)}`}>
              Class dashboard
            </Link>
          </div>
        </header>

        <section className={`${s.sheet} flex flex-col gap-3 p-4`} aria-label="Which problem">
          <span className="font-semibold">Which problem did the class do?</span>
          <div className="grid gap-2 sm:grid-cols-5">
            {[...(topic?.photo_questions ?? []), { id: AUTO_QUESTION, stem: "Any fraction problem", concept_id: "" }].map((q) => (
              <button
                key={q.id}
                type="button"
                aria-pressed={q.id === questionId}
                disabled={running}
                onClick={() => setQuestionId(q.id)}
                className={`${k.problem} ${q.id === questionId ? k.problemOn : ""} ${s.hand}`}
              >
                {q.stem}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              aria-label="Add notebook photos"
              className="sr-only"
              onChange={(e) => {
                void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className={`${s.button} ${s.primary}`}
              disabled={running || !students.length}
              onClick={() => fileInput.current?.click()}
            >
              Add notebook photos
            </button>
            <button type="button" className={s.button} disabled={running || !students.length} onClick={() => void loadSamplePile()}>
              Use 6 sample notebooks (3/4 + 1/4)
            </button>
            <span className={`${s.muted} text-[0.88em]`}>Each photo is matched to a student in class-list order. Change any of them below.</span>
          </div>
        </section>

        {error && (
          <div className={`${s.feedItem} ${s.challenge}`} role="alert">
            {error}
          </div>
        )}

        {items.length > 0 && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[1.15em] font-semibold">
                {items.length} notebooks{question ? `, ${question.stem}` : ""}
              </h2>
              <button
                type="button"
                className={`${s.button} ${s.primary}`}
                disabled={running || items.every((i) => i.state === "done")}
                onClick={() => void readAll()}
              >
                {running ? `Reading… ${done.length} of ${items.length}` : `Read all ${items.length} notebooks`}
              </button>
            </div>

            {elapsed !== null && (
              <section className={`${s.sheet} flex flex-col gap-2 p-4`} aria-live="polite" aria-label="Summary">
                <p className="text-[1.1em]">
                  <span className={s.highlight}>
                    {done.length} notebooks read in {elapsed.toFixed(0)} seconds
                  </span>
                  . {right.length} right, {wrong.length} with a mistake
                  {unreadable.length ? `, ${unreadable.length} need a second look` : ""}.
                </p>
                {topMistakes.length > 0 && (
                  <p>
                    Most common:{" "}
                    {topMistakes.map(([label, n], i) => (
                      <span key={label}>
                        {i > 0 && ", "}
                        <span className={s.hand} style={{ color: "var(--red-pen)" }}>
                          {label}
                        </span>{" "}
                        ({n})
                      </span>
                    ))}
                  </p>
                )}
                <Link className={`${s.button} ${s.primary} self-start`} href={`/teacher/${encodeURIComponent(code)}`}>
                  Plan tomorrow on the dashboard
                </Link>
              </section>
            )}

            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Notebooks">
              {items.map((it, i) => {
                const r = it.result;
                const tone =
                  it.state !== "done" || !r
                    ? ""
                    : r.needs_typed_answer
                      ? k.cellUnsure
                      : r.correct
                        ? k.cellRight
                        : k.cellWrong;
                return (
                  <li key={it.key} className={`${k.cell} ${tone}`}>
                    <div className={k.thumbWrap}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={it.src} alt={`Notebook ${i + 1}`} className={k.thumb} />
                      {it.state === "reading" && <div className={k.sweep} aria-hidden />}
                    </div>
                    <div className="flex flex-col gap-1.5 p-3">
                      <select
                        className={`${s.button} ${s.focusable} w-full text-[0.9em]`}
                        value={it.studentId}
                        disabled={running || it.state === "done"}
                        aria-label={`Student for notebook ${i + 1}`}
                        onChange={(e) =>
                          setItems((old) => old.map((x, j) => (j === i ? { ...x, studentId: e.target.value } : x)))
                        }
                      >
                        {students.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.nickname}
                          </option>
                        ))}
                      </select>
                      {it.state === "waiting" && <span className={s.muted}>Ready</span>}
                      {it.state === "reading" && <span className={s.muted}>Reading…</span>}
                      {it.state === "error" && <span style={{ color: "var(--red-pen)" }}>{it.error}</span>}
                      {it.state === "done" && r && (
                        <span>
                          {r.needs_typed_answer ? (
                            <span style={{ color: "var(--amber)" }}>Couldn&apos;t read it clearly. Scan again.</span>
                          ) : r.correct ? (
                            <strong style={{ color: "var(--green)" }}>✓ {nameOf(it.studentId)} got it right</strong>
                          ) : (
                            <>
                              <strong style={{ color: "var(--red-pen)" }}>Line {r.error_step ?? "?"}:</strong>{" "}
                              <span className={s.hand}>{r.label}</span>
                            </>
                          )}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {items.length === 0 && (
          <div className={`${s.sheet} flex flex-col items-center gap-2 p-8 text-center`}>
            <p className="text-[1.15em] font-semibold">Collect the notebooks, photograph each page, and add them here.</p>
            <p className={s.muted}>GuruGraph reads six at a time and tells you who needs help with what.</p>
          </div>
        )}
      </div>
    </main>
  );
}
