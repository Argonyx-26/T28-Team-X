"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_THRESHOLDS, REASON_TEXT, type Readiness, ReadinessTracker, retryDelay, summarise } from "@/lib/camera";
import {
  type CameraFailure,
  grabJpeg,
  openCamera,
  sampleVideo,
  shrink,
  shutterFeedback,
  stopCamera,
  unlockShutterSound,
} from "@/lib/camera/browser";
import { ApiError, type PageProblem, type PageResponse, api } from "../../_dashboard/api";
import s from "../../_dashboard/dashboard.module.css";
import { fontVars } from "../../_dashboard/fonts";
import k from "./snap.module.css";

type Student = { id: string; nickname: string; roll: number | null; kind: string };

type ItemState = "waiting" | "reading" | "filed" | "unassigned" | "unreadable" | "error";

type Item = {
  key: string;
  /** an object URL for the thumbnail; the blob itself stays in memory only and is never stored */
  src: string;
  blob: Blob;
  source: "camera" | "gallery";
  takenAt: number;
  state: ItemState;
  /** "retrying in 3 s" while the queue waits out a network drop */
  note?: string;
  result?: PageResponse;
  error?: string;
  filing?: boolean;
};

const PARALLEL = 5;
const SAMPLE_EVERY_MS = 100;

const FAILURE_COPY: Record<CameraFailure, { title: string; body: string }> = {
  insecure: {
    title: "The camera needs a secure page.",
    body: "Open the app over https (the link on the dashboard), or use photos from the gallery below.",
  },
  unsupported: {
    title: "This browser can't open the camera.",
    body: "Try Chrome or Safari, or use photos from the gallery below.",
  },
  denied: {
    title: "Camera permission was refused.",
    body: "Allow the camera for this site from the icon in the address bar, then try again. Or use photos from the gallery.",
  },
  none: {
    title: "No camera on this device.",
    body: "Open this page on a phone, or use photos from the gallery below.",
  },
  busy: {
    title: "Another app is using the camera.",
    body: "Close it, then try again. Or use photos from the gallery.",
  },
  unknown: {
    title: "The camera didn't start.",
    body: "Try again, or use photos from the gallery below.",
  },
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function wrongCount(problems: PageProblem[]): number {
  return problems.filter((p) => !p.correct && !p.needs_typed_answer).length;
}

function pillClass(reason: Readiness["reason"]): string {
  if (reason === "ready" || reason === "cooldown") return k.pillReady;
  if (reason === "blurry") return k.pillBlurry;
  if (reason === "same") return k.pillSame;
  return k.pillMoving;
}

/** `enabled` is FLAGS.SNAP, read on the server by page.tsx (see the note there). */
export function Snap({ code, enabled }: { code: string; enabled: boolean }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [loadError, setLoadError] = useState("");
  const [camera, setCamera] = useState<{ state: "opening" } | { state: "on"; rear: boolean } | { state: "off"; failure: CameraFailure }>({
    state: "opening",
  });
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [captures, setCaptures] = useState<number[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const sampleCanvas = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const tracker = useRef(new ReadinessTracker(DEFAULT_THRESHOLDS));
  const lastGray = useRef<ReturnType<typeof sampleVideo>>(null);
  const capturing = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const inFlight = useRef(new Set<string>());
  const sessionRef = useRef<string | null>(null);
  const capturesRef = useRef<number[]>([]);
  const objectUrls = useRef<string[]>([]);

  // the class: who the pages can be filed under
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const session = await api.lookup(code);
        const dash = await api.dashboard(session.session_id);
        if (!live) return;
        sessionRef.current = session.session_id;
        setSessionId(session.session_id);
        setStudents(
          dash.heatmap.students
            .map(({ id, nickname, kind, roll_no }) => ({ id, nickname, kind, roll: roll_no ?? null }))
            .sort((a, b) => (a.roll ?? 999) - (b.roll ?? 999) || a.nickname.localeCompare(b.nickname)),
        );
      } catch (e) {
        if (live) setLoadError(e instanceof ApiError ? e.message : "Can't reach the server. Check the connection.");
      }
    })();
    return () => {
      live = false;
    };
  }, [code]);

  const addCapture = useCallback((blob: Blob, source: Item["source"]) => {
    const at = Date.now();
    const prev = capturesRef.current;
    if (prev.length) {
      const seconds = (at - prev[prev.length - 1]) / 1000;
      console.info("snap-timing", { page: prev.length + 1, seconds: Number(seconds.toFixed(2)), at, source });
    }
    capturesRef.current = [...prev, at];
    setCaptures(capturesRef.current);
    setNow(at);
    const src = URL.createObjectURL(blob);
    objectUrls.current.push(src);
    setItems((old) => [...old, { key: `${at}-${old.length}`, src, blob, source, takenAt: at, state: "waiting" }]);
  }, []);

  /** One capture from the live video: JPEG, shutter feedback, and the timing mark. */
  const capture = useCallback(
    async (how: "auto" | "manual") => {
      const video = videoRef.current;
      if (!video || capturing.current) return;
      capturing.current = true;
      try {
        const blob = await grabJpeg(video);
        if (!blob) return;
        if (lastGray.current) tracker.current.markCaptured(lastGray.current, performance.now());
        shutterFeedback();
        addCapture(blob, "camera");
        if (how === "manual") setReadiness((r) => (r ? { ...r, reason: "cooldown", capture: false } : r));
      } finally {
        capturing.current = false;
      }
    },
    [addCapture],
  );

  // the camera and the 10 Hz sampling loop
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    (async () => {
      const opened = await openCamera();
      if (!live) {
        if (opened.ok) stopCamera(opened.camera.stream);
        return;
      }
      if (!opened.ok) {
        setCamera({ state: "off", failure: opened.failure });
        return;
      }
      streamRef.current = opened.camera.stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = opened.camera.stream;
        try {
          await video.play();
        } catch {
          // autoplay is allowed for muted video; if not, the first tap starts it
        }
      }
      setCamera({ state: "on", rear: opened.camera.rear });
      sampleCanvas.current ??= document.createElement("canvas");
      timer = setInterval(() => {
        const v = videoRef.current;
        const c = sampleCanvas.current;
        if (!v || !c || capturing.current) return;
        const gray = sampleVideo(v, c);
        if (!gray) return;
        lastGray.current = gray;
        const r = tracker.current.feed(gray, performance.now());
        setReadiness(r);
        if (r.capture) void capture("auto");
      }, SAMPLE_EVERY_MS);
    })();
    const unlock = () => unlockShutterSound();
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
    return () => {
      live = false;
      if (timer) clearInterval(timer);
      stopCamera(streamRef.current);
      streamRef.current = null;
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [capture]);

  // thumbnails' object URLs are released when the screen closes; the blobs go with the component (never stored)
  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.length = 0;
    };
  }, []);

  const patch = useCallback((key: string, change: Partial<Item>) => {
    setItems((old) => old.map((it) => (it.key === key ? { ...it, ...change } : it)));
  }, []);

  /** Reads one page, retrying network drops and 429s with 1 s, 3 s, 8 s pauses. */
  const readOne = useCallback(
    async (item: Item) => {
      const sid = sessionRef.current;
      if (!sid) return;
      patch(item.key, { state: "reading", note: undefined, error: undefined });
      for (let attempt = 0; ; attempt++) {
        try {
          const blob = item.source === "gallery" ? await shrink(item.blob) : item.blob;
          const result = await api.page(blob, { sessionId: sid }, "snap");
          const state: ItemState = result.unreadable ? "unreadable" : result.saved ? "filed" : "unassigned";
          patch(item.key, { state, result, note: undefined });
          return;
        } catch (e) {
          const status = e instanceof ApiError ? e.status : 0;
          const delay = retryDelay(status, attempt);
          if (delay === null) {
            patch(item.key, {
              state: "error",
              error: e instanceof ApiError && e.status !== 0 ? e.message : "Can't reach the server. Check the connection.",
            });
            return;
          }
          patch(item.key, { note: `${status === 429 ? "Busy" : "No connection"}: trying again in ${delay / 1000} s` });
          await sleep(delay);
        }
      }
    },
    [patch],
  );

  // the queue: up to five reads in flight
  useEffect(() => {
    if (!sessionId) return;
    let busy = items.filter((i) => i.state === "reading").length;
    for (const item of items) {
      if (busy >= PARALLEL) break;
      if (item.state !== "waiting" || inFlight.current.has(item.key)) continue;
      inFlight.current.add(item.key);
      busy++;
      void readOne(item).finally(() => inFlight.current.delete(item.key));
    }
  }, [items, sessionId, readOne]);

  // the running total ticks once a second while there is something to time
  useEffect(() => {
    if (!captures.length) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [captures.length]);

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    for (const f of Array.from(files)) addCapture(f, "gallery");
  }

  async function fileUnder(item: Item, student: Student) {
    if (!item.result) return;
    patch(item.key, { filing: true });
    try {
      const r = await api.pageFile(student.id, "snap", item.result.problems);
      patch(item.key, {
        filing: false,
        state: "filed",
        result: {
          ...item.result,
          student_id: r.student_id,
          student_nickname: r.student_nickname,
          matched_by: "given",
          saved: true,
          summary: r.summary,
          problems: r.problems,
        },
      });
    } catch (e) {
      patch(item.key, { filing: false, error: e instanceof ApiError ? e.message : "Couldn't file it. Try again." });
    }
  }

  function retry(item: Item) {
    patch(item.key, { state: "waiting", error: undefined });
  }

  const rollOf = (studentId: string | null) => students.find((x) => x.id === studentId)?.roll ?? null;
  const who = (r: PageResponse) => {
    const roll = rollOf(r.student_id) ?? r.roll_no;
    return `${r.student_nickname ?? "?"}${roll !== null ? ` (roll ${roll})` : ""}`;
  };

  const filed = items.filter((i) => i.state === "filed" && i.result);
  const unassigned = items.filter((i) => i.state === "unassigned" && i.result);
  const totals = filed.reduce(
    (acc, i) => {
      const r = i.result as PageResponse;
      acc.pages++;
      acc.problems += r.problems.length;
      acc.wrong += r.summary?.wrong ?? wrongCount(r.problems);
      return acc;
    },
    { pages: 0, problems: 0, wrong: 0 },
  );
  const timing = summarise(captures, now);

  async function copyTimings() {
    const payload = {
      class: code,
      note: "internal test, not a teacher study: wall-clock seconds between consecutive captures on the snap screen",
      pages: timing.pages,
      median_seconds_per_notebook: timing.medianSeconds,
      mean_seconds_per_notebook: timing.meanSeconds,
      total_seconds: Number(timing.totalSeconds.toFixed(1)),
      intervals: timing.intervals.map((x) => ({ page: x.page, seconds: Number(x.seconds.toFixed(2)), at: new Date(x.at).toISOString() })),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      console.info("snap-timing-summary", payload);
    }
  }

  const dashboardHref = `/teacher/${encodeURIComponent(code)}`;

  if (!enabled) {
    return (
      <main className={`${s.root} ${fontVars} min-h-dvh`}>
        <div className="mx-auto flex max-w-[560px] flex-col gap-4 px-4 pb-10 pt-6">
          <Link href={dashboardHref} className={`${s.hand} text-[1.6em] font-bold`}>
            GuruGraph
          </Link>
          <section className={`${s.sheet} flex flex-col gap-2 p-5`} aria-label="Snap mode">
            <h1 className="text-[1.2em] font-semibold">Snap mode is off in this build.</h1>
            <p className={s.muted}>
              Checking notebooks by flipping pages under the camera is switched off here. Scan one notebook at a time, or
              read a pile of photos instead.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link className={`${s.button} ${s.primary}`} href={`${dashboardHref}/scan`}>
                Scan a notebook
              </Link>
              <Link className={s.button} href={`${dashboardHref}/pile`}>
                Read a pile
              </Link>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const galleryInput = (
    <input
      ref={fileInput}
      type="file"
      accept="image/*"
      multiple
      aria-label="Use photos from the gallery"
      className="sr-only"
      onChange={(e) => {
        void addFiles(e.target.files);
        e.target.value = "";
      }}
    />
  );

  return (
    <main className={`${s.root} ${fontVars} min-h-dvh`}>
      {galleryInput}
      <div className={k.layout}>
        <section className={k.stage} aria-label="Camera">
          <video ref={videoRef} className={k.video} playsInline muted autoPlay aria-label="Live view of the notebook page" />
          {camera.state === "opening" && <div className={k.skeleton} aria-hidden />}
          {camera.state === "on" && (
            <div className={`${k.guide} ${readiness?.reason === "ready" || readiness?.reason === "cooldown" ? k.guideReady : ""}`} aria-hidden />
          )}

          <div className={k.topBar}>
            <Link href={dashboardHref} aria-label="GuruGraph: back to the class dashboard">
              ← <span className={s.hand}>GuruGraph</span>
            </Link>
            <span className={k.counter} aria-live="polite" aria-label={`${totals.pages} pages, ${totals.problems} problems, ${totals.wrong} wrong`}>
              Pages {totals.pages} · Problems {totals.problems} · Wrong {totals.wrong}
            </span>
          </div>

          {camera.state === "opening" && (
            <div className={k.stageCard}>
              <div>
                <p className="font-semibold">Opening the camera…</p>
                <p className={s.muted}>Allow the camera when the browser asks.</p>
              </div>
            </div>
          )}

          {camera.state === "off" && (
            <div className={k.stageCard} role="alert">
              <div>
                <p className="font-semibold">{FAILURE_COPY[camera.failure].title}</p>
                <p className={s.muted}>{FAILURE_COPY[camera.failure].body}</p>
                <div className="flex flex-wrap gap-2">
                  {camera.failure !== "insecure" && camera.failure !== "unsupported" && camera.failure !== "none" && (
                    <button type="button" className={`${s.button} ${s.primary}`} onClick={() => window.location.reload()}>
                      Try again
                    </button>
                  )}
                  <button type="button" className={s.button} onClick={() => fileInput.current?.click()}>
                    Use photos from the gallery
                  </button>
                </div>
              </div>
            </div>
          )}

          {camera.state === "on" && readiness && (
            <div className={`${k.pill} ${pillClass(readiness.reason)}`} role="status">
              {REASON_TEXT[readiness.reason]}
            </div>
          )}

          <div className={k.controls}>
            <div className={k.debug}>
              {camera.state === "on" && !camera.rear && <span>Webcam: hold the page up to it</span>}
              {showDebug && readiness && (
                <span>
                  <br />
                  diff {readiness.diff.toFixed(1)} · sharp {readiness.sharpness.toFixed(0)} · still {Math.round(readiness.steadyFor)} ms
                  {readiness.novelty && ` · new ${readiness.novelty.ink.toFixed(2)}/${readiness.novelty.hamming}`}
                </span>
              )}
            </div>
            <button
              type="button"
              className={k.shutter}
              aria-label="Take a photo of this page"
              disabled={camera.state !== "on"}
              onClick={() => void capture("manual")}
            />
            <button type="button" className={k.galleryBtn} onClick={() => fileInput.current?.click()}>
              Use photos from the gallery
            </button>
          </div>
        </section>

        <div className={k.side}>
          {loadError && (
            <div className={`${s.feedItem} ${s.challenge}`} role="alert">
              {loadError}
            </div>
          )}

          <section className={`${s.sheet} flex flex-col gap-2 p-4`} aria-label="Pages">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h1 className="text-[1.15em] font-semibold">Snap notebooks</h1>
              <Link className={`${s.button} ${k.small}`} href={dashboardHref}>
                Open the dashboard
              </Link>
            </div>
            {items.length === 0 ? (
              <p className={s.muted}>
                Hold the phone over a page with the roll number at the top. It takes the photo by itself when the page is
                still and sharp, reads every problem, and files it under the right child. Nothing is stored: the photo is
                read and thrown away.
              </p>
            ) : (
              <ul className={k.strip} aria-live="polite" aria-label="Snapped pages">
                {items.map((it, i) => {
                  const r = it.result;
                  const tone =
                    it.state === "filed" && r
                      ? (r.summary?.wrong ?? wrongCount(r.problems)) > 0
                        ? k.cardWrong
                        : k.cardFiled
                      : it.state === "unassigned" || it.state === "unreadable"
                        ? k.cardUnassigned
                        : it.state === "error"
                          ? k.cardError
                          : "";
                  return (
                    <li key={it.key} className={`${k.card} ${tone}`}>
                      <div className={k.thumbWrap}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={it.src} alt={`Page ${i + 1}`} className={k.thumb} />
                        {it.state === "reading" && <div className={k.sweep} aria-hidden />}
                      </div>
                      <div className={k.cardBody}>
                        {it.state === "waiting" && <span className={s.muted}>Waiting</span>}
                        {it.state === "reading" && <span className={s.muted}>{it.note ?? "Reading…"}</span>}
                        {it.state === "filed" && r && (
                          <>
                            <span className={k.cardTitle}>{who(r)}</span>
                            <span className={s.muted}>
                              {r.problems.length} {r.problems.length === 1 ? "problem" : "problems"} ·{" "}
                              {r.summary?.wrong ?? wrongCount(r.problems)} wrong
                            </span>
                          </>
                        )}
                        {it.state === "unassigned" && <span className={k.amberText}>Whose page? Pick below.</span>}
                        {it.state === "unreadable" && (
                          <span className={k.amberText}>Couldn&apos;t read this page. Snap it again.</span>
                        )}
                        {it.state === "error" && (
                          <>
                            <span style={{ color: "var(--red-pen)" }}>{it.error}</span>
                            <button type="button" className={`${s.button} ${k.small} self-start`} onClick={() => retry(it)}>
                              Retry
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {unassigned.length > 0 && (
            <section className={`${s.sheet} ${k.tray} flex flex-col gap-3 p-4`} aria-label="Unassigned pages">
              <h2 className="text-[1.05em] font-semibold">
                Unassigned <span className={s.muted}>({unassigned.length})</span>
              </h2>
              {unassigned.map((it, idx) => {
                const r = it.result as PageResponse;
                return (
                  <div key={it.key} className="flex flex-col gap-2 border-t border-[var(--rule)] pt-3 first:border-t-0 first:pt-0">
                    <div className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={it.src} alt="" className="h-14 w-20 rounded-md object-cover" />
                      <div className="flex flex-col">
                        <span className="font-semibold">
                          {r.roll_no !== null ? `Roll ${r.roll_no} isn't on the class list` : r.name_on_page ? `"${r.name_on_page}" isn't on the class list` : "No name or roll number on the page"}
                        </span>
                        <span className={`${s.muted} text-[0.9em]`}>
                          {r.problems.length} {r.problems.length === 1 ? "problem" : "problems"} · {wrongCount(r.problems)} wrong
                        </span>
                      </div>
                    </div>
                    <ol className={k.readings} aria-label={`Readings from unassigned page ${idx + 1}`}>
                      {r.problems.map((p, j) => (
                        <li key={j} className={k.reading}>
                          <span className={s.hand}>{p.problem}</span>
                          {p.needs_typed_answer ? (
                            <span className={k.amberText}>unclear</span>
                          ) : p.correct ? (
                            <span style={{ color: "var(--green)" }}>✓ right</span>
                          ) : (
                            <span style={{ color: "var(--red-pen)" }}>
                              ✗ line {p.error_step ?? "?"}: {p.label ?? "mistake"}
                            </span>
                          )}
                        </li>
                      ))}
                    </ol>
                    <span className={`${s.muted} text-[0.9em]`}>Whose is it? One tap files it.</span>
                    <div className={k.chips} role="group" aria-label={`File page ${idx + 1} under`}>
                      {students.map((st) => (
                        <button
                          key={st.id}
                          type="button"
                          className={k.chip}
                          disabled={it.filing}
                          onClick={() => void fileUnder(it, st)}
                        >
                          {st.roll !== null ? `${st.roll} · ` : ""}
                          {st.nickname}
                        </button>
                      ))}
                    </div>
                    {it.error && (
                      <span role="alert" style={{ color: "var(--red-pen)" }}>
                        {it.error}
                      </span>
                    )}
                  </div>
                );
              })}
            </section>
          )}

          {filed.length > 0 && (
            <section className={`${s.sheet} flex flex-col gap-2 p-4`} aria-label="Filed pages">
              <h2 className="text-[1.05em] font-semibold">Filed</h2>
              <ul className={k.filedList}>
                {filed.map((it) => {
                  const r = it.result as PageResponse;
                  const wrong = r.summary?.wrong ?? wrongCount(r.problems);
                  return (
                    <li key={it.key} className={`${k.filedLine} ${wrong > 0 ? k.filedLineWrong : ""}`}>
                      Snap · {who(r)} · {r.problems.length} {r.problems.length === 1 ? "problem" : "problems"} · {wrong} wrong
                      {wrong > 0 && (
                        <span className={`${s.hand} block text-[0.95em]`} style={{ color: "var(--red-pen)" }}>
                          {r.problems
                            .filter((p) => !p.correct && !p.needs_typed_answer)
                            .map((p) => p.label ?? "mistake")
                            .join(" · ")}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {captures.length > 0 && (
            <section className={`${s.sheet} flex flex-col gap-2 p-4`} aria-label="Timing">
              <h2 className="text-[1.05em] font-semibold">Seconds per notebook</h2>
              <p className={k.bigNumber}>
                {timing.medianSeconds !== null ? (
                  <span className={s.highlight}>{timing.medianSeconds.toFixed(1)} s</span>
                ) : (
                  <span className={s.muted}>–</span>
                )}
              </p>
              <p className={s.muted}>
                {timing.pages} {timing.pages === 1 ? "page" : "pages"} in {timing.totalSeconds.toFixed(0)} s
                {timing.medianSeconds !== null ? ` · median between captures ${timing.medianSeconds.toFixed(1)} s` : " · the median appears after the second page"}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={`${s.button} ${k.small}`} onClick={() => void copyTimings()}>
                  {copied ? "Copied ✓" : "Copy timings"}
                </button>
                <button
                  type="button"
                  className={`${s.button} ${k.small}`}
                  aria-pressed={showDebug}
                  onClick={() => setShowDebug((v) => !v)}
                >
                  {showDebug ? "Hide" : "Show"} camera numbers
                </button>
              </div>
              <p className={`${s.muted} text-[0.85em]`}>
                Internal test, not a teacher study: the wall-clock time between one capture and the next, on this device,
                with this class. Every interval is also logged to the console as <code>snap-timing</code>.
              </p>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
