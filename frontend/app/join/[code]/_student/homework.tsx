"use client";

import { useEffect, useState } from "react";

import { track } from "@/lib/raah";
import { usePenLength } from "@/lib/use-pen-length";

import { ApiError, type Lang, type PageProblem, type PageResponse, api } from "../../../teacher/[code]/_dashboard/api";
import s from "../../../teacher/[code]/_dashboard/dashboard.module.css";
import { Listen } from "./listen";
import k from "./student.module.css";
import { type Words, errorText } from "./words";

/** Phones take 4–12 MB photos; send a 1600 px JPEG instead so it uploads fast on mobile data. */
export async function shrink(file: Blob): Promise<Blob> {
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

function CameraIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.7l1.2-2h5.2l1.2 2h1.7A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z" />
      <circle cx="12" cy="12.5" r="3.2" />
    </svg>
  );
}

/** The entry point: a quiet camera button in a header ("icon") or a full-width one on a finished screen ("big"). */
export function HomeworkButton({
  words,
  variant,
  disabled,
  onClick,
}: {
  words: Words;
  variant: "icon" | "big";
  disabled?: boolean;
  onClick: () => void;
}) {
  if (variant === "icon") {
    return (
      <button type="button" className={k.camera} aria-label={words.checkHomework} disabled={disabled} onClick={onClick}>
        <CameraIcon />
        <span className="hidden min-[400px]:inline">{words.checkHomework}</span>
      </button>
    );
  }
  return (
    <button type="button" className={`${s.button} ${k.big}`} disabled={disabled} onClick={onClick}>
      <CameraIcon />
      {words.checkHomework}
    </button>
  );
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

function ProblemCard({ p, n, words, language }: { p: PageProblem; n: number; words: Words; language: Lang }) {
  const hand = language === "en" ? s.hand : "font-semibold";
  return (
    <div className="flex flex-col gap-2">
      <article className={k.paper} aria-label={words.hwProblem(n)}>
        <span className={k.paperTitle} aria-hidden>
          {n}
        </span>
        <ol className={k.lines}>
          {p.steps.map((line, i) => {
            const wrong = p.error_step === i + 1;
            const value = p.line_values?.[i] ?? null;
            const check = p.verifier?.lines?.[i];
            return (
              <li key={i} className={k.line}>
                <span className={`${k.lineText} ${s.hand}`}>
                  {line}
                  {wrong && <RedPenCircle />}
                </span>
                {value !== null && (
                  <span className={`${k.ledger} ${check?.ok === false ? k.ledgerWrong : ""}`}>
                    <span className="sr-only">{words.hwEquals(i + 1, value)}</span>
                    <span aria-hidden>
                      = {value} {check?.ok === false ? "✗" : check?.ok ? "✓" : ""}
                    </span>
                  </span>
                )}
                {wrong && p.label_local && (
                  <span className={`${k.margin} ${hand}`}>
                    <span className="sr-only">{words.hwWrongLine(i + 1, p.label_local)}</span>
                    <span aria-hidden>{p.label_local}</span>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        {p.correct && (
          <div className={`${k.tick} ${s.hand}`} role="img" aria-label={words.hwAllRight}>
            ✓
          </div>
        )}
      </article>
      {p.feedback_local && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={k.cardNote} style={{ color: p.correct ? "var(--green)" : "var(--ink)" }}>
            {p.feedback_local}
          </p>
          <Listen text={p.feedback_local} language={language} words={words} label={words.hwProblem(n)} />
        </div>
      )}
    </div>
  );
}

type Status = { name: "idle" } | { name: "reading" } | { name: "done"; result: PageResponse } | { name: "error"; text: string };

/**
 * F3: the child photographs their own homework page; one call reads every problem and the red pen marks the wrong
 * step. `photo` null shows the empty state; a new Blob starts a new read. `preview` is an object URL the parent owns
 * (created in the tap, revoked when the child leaves). `onTakePhoto` must open the file input synchronously (it runs
 * inside the tap, which the camera needs on iOS).
 */
export function Homework({
  studentId,
  language,
  words,
  photo,
  preview,
  quizDone,
  onTakePhoto,
  onFix,
  onLeave,
}: {
  studentId: string;
  language: Lang;
  words: Words;
  photo: Blob | null;
  preview: string | null;
  quizDone: boolean;
  onTakePhoto: () => void;
  onFix: () => void;
  onLeave: () => void;
}) {
  // the parent keys this component per photo, so a new photo mounts a fresh read
  const [status, setStatus] = useState<Status>(() => (photo ? { name: "reading" } : { name: "idle" }));

  useEffect(() => {
    if (!photo) return;
    let live = true;
    (async () => {
      try {
        const small = await shrink(photo);
        const r = await api.page(small, { studentId }, "homework", language);
        if (!live) return;
        setStatus({ name: "done", result: r });
        track("homework_checked", {
          problems: r.problems.length,
          wrong: r.summary?.wrong ?? r.problems.filter((p) => !p.correct && !p.needs_typed_answer).length,
          unreadable: r.unreadable,
        });
      } catch (e) {
        if (!live) return;
        setStatus({
          name: "error",
          text: e instanceof ApiError ? errorText(words, e.code, e.message) : words.offline,
        });
      }
    })();
    return () => {
      live = false;
    };
  }, [photo, studentId, language, words]);

  const leaveLabel = quizDone ? words.hwDone : words.hwBack;
  const leave = (
    <button type="button" className={`${s.button} ${k.big}`} onClick={onLeave}>
      {leaveLabel}
    </button>
  );

  if (status.name === "idle") {
    return (
      <section className="flex flex-col gap-4" aria-label={words.checkHomework}>
        <h2 className={`${s.hand} text-[1.4em]`}>{words.checkHomework}</h2>
        <div className={k.emptyPage}>
          <CameraIcon />
          <p>{words.hwIntro}</p>
        </div>
        <button type="button" className={`${s.button} ${s.primary} ${k.big}`} onClick={onTakePhoto}>
          <CameraIcon />
          {words.hwTakePhoto}
        </button>
        {leave}
      </section>
    );
  }

  if (status.name === "reading") {
    return (
      <section className="flex flex-col gap-4" aria-label={words.checkHomework}>
        <h2 className={`${s.hand} text-[1.4em]`}>{words.checkHomework}</h2>
        <div className={k.scanning} role="status" aria-live="polite" aria-busy>
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt={words.hwPhotoAlt} className={k.previewImg} />
          )}
          <div className={k.sweep} aria-hidden />
          <span className={k.scanningLabel}>{words.hwReading}</span>
        </div>
      </section>
    );
  }

  if (status.name === "error") {
    return (
      <section className="flex flex-col gap-4" aria-label={words.checkHomework}>
        <h2 className={`${s.hand} text-[1.4em]`}>{words.checkHomework}</h2>
        <div className={`${s.feedItem} ${s.challenge}`} role="alert">
          {status.text}
        </div>
        <button type="button" className={`${s.button} ${s.primary} ${k.big}`} onClick={onTakePhoto}>
          <CameraIcon />
          {words.hwRetake}
        </button>
        {leave}
      </section>
    );
  }

  const r = status.result;
  if (r.unreadable || r.problems.length === 0) {
    return (
      <section className="flex flex-col gap-4" aria-label={words.checkHomework} aria-live="polite">
        <h2 className={`${s.hand} text-[1.4em]`}>{words.checkHomework}</h2>
        <div className={k.emptyPage} role="status">
          <p className="text-[1.05em]" style={{ color: "var(--ink)" }}>
            {words.hwUnreadable}
          </p>
        </div>
        <button type="button" className={`${s.button} ${s.primary} ${k.big}`} onClick={onTakePhoto}>
          <CameraIcon />
          {words.hwRetake}
        </button>
        {leave}
      </section>
    );
  }

  const wrong = r.problems.filter((p) => !p.correct && !p.needs_typed_answer);
  const needsFix = (r.summary?.gaps_opened ?? 0) > 0 || wrong.length > 0;
  const concept = wrong[0] ? (words.concepts[wrong[0].concept_id] ?? null) : null;
  const parentText = words.parentMessage(r.problems.length, wrong.length, concept);
  const parentHref = `https://wa.me/?text=${encodeURIComponent(parentText)}`;

  return (
    <section className="flex flex-col gap-4" aria-label={words.checkHomework} aria-live="polite">
      <div className="flex flex-col gap-1">
        <h2 className={`${s.hand} text-[1.4em]`}>{words.checkHomework}</h2>
        <p role="status" className="text-[1.1em] font-semibold">
          <span className={wrong.length ? "" : s.highlight}>{words.hwSummary(r.problems.length, wrong.length)}</span>
        </p>
      </div>
      {r.problems.map((p, i) => (
        <ProblemCard key={i} p={p} n={i + 1} words={words} language={language} />
      ))}
      {r.saved && <p className={`${s.muted} text-[0.9em]`}>{words.hwSaved}</p>}
      {r.repeat && <p className={`${s.muted} text-[0.9em]`}>{words.hwRepeat}</p>}
      <div className="flex flex-col gap-2">
        {needsFix && (
          <button type="button" className={`${s.button} ${s.primary} ${k.big}`} onClick={onFix}>
            {words.fixNow}
          </button>
        )}
        <a className={k.link} href={parentHref} target="_blank" rel="noopener noreferrer">
          {words.sendParent}
        </a>
        <button type="button" className={`${s.button} ${k.big}`} onClick={onTakePhoto}>
          <CameraIcon />
          {words.hwAnother}
        </button>
        {leave}
      </div>
    </section>
  );
}
