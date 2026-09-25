"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

import { FLAGS } from "@/lib/flags";
import { track } from "@/lib/raah";

import {
  type AnswerResponse,
  ApiError,
  type Lang,
  type LessonResponse,
  type QuestionOut,
  type RetryResponse,
  api,
} from "../../../teacher/[code]/_dashboard/api";
import s from "../../../teacher/[code]/_dashboard/dashboard.module.css";
import { fontVars } from "../../../teacher/[code]/_dashboard/fonts";
import { Homework, HomeworkButton } from "./homework";
import { Listen, speakable } from "./listen";
import k from "./student.module.css";
import { LANGS, WORDS, errorText } from "./words";

type Me = { studentId: string; nickname: string; language: Lang };
type Phase =
  | { name: "loading" }
  | { name: "join" }
  | { name: "question"; q: QuestionOut; index: number; total: number }
  | { name: "feedback"; q: QuestionOut; index: number; total: number; chosen: string; result: AnswerResponse }
  | { name: "lesson"; data: LessonResponse | null }
  | { name: "retry"; items: QuestionOut[] }
  | { name: "result"; result: RetryResponse }
  | { name: "done"; caughtUp: boolean }
  // F3: the child's own homework page; photo null is the "take a photo" screen; seq keys one read per photo
  | { name: "homework"; photo: Blob | null; seq: number; quizDone: boolean };

const storeKey = (code: string) => `gurugraph:${code.toUpperCase()}`;
const DEMO_SESSION_ID = "ses_7b";

function load(code: string): Me | null {
  try {
    const raw = localStorage.getItem(storeKey(code));
    return raw ? (JSON.parse(raw) as Me) : null;
  } catch {
    return null;
  }
}

function save(code: string, me: Me) {
  try {
    localStorage.setItem(storeKey(code), JSON.stringify(me));
  } catch {
    // private mode: the flow still works for this visit
  }
}

function AnswerInput({
  q,
  words,
  disabled,
  onAnswer,
}: {
  q: QuestionOut;
  words: (typeof WORDS)["en"];
  disabled: boolean;
  onAnswer: (answer: string) => void;
}) {
  const [typed, setTyped] = useState("");
  if (q.kind === "mcq" && q.options) {
    return (
      <div className="flex flex-col gap-2.5">
        {q.options.map((o) => (
          <button key={o} type="button" className={`${k.option} ${s.hand}`} disabled={disabled} onClick={() => onAnswer(o)}>
            {o}
          </button>
        ))}
      </div>
    );
  }
  return (
    <form
      className="flex flex-col gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (typed.trim()) onAnswer(typed.trim());
      }}
    >
      <input
        className={`${k.input} ${s.hand}`}
        inputMode="text"
        autoComplete="off"
        placeholder={words.typeHint}
        aria-label={words.typeHint}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
      />
      <button type="submit" className={`${s.button} ${s.primary} ${k.big}`} disabled={disabled || !typed.trim()}>
        {words.check}
      </button>
    </form>
  );
}

export function Student({ code }: { code: string }) {
  const params = useSearchParams();
  const asAsha = params.get("as")?.toLowerCase() === "asha";
  const [className, setClassName] = useState("");
  const [me, setMe] = useState<Me | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryLesson, setRetryLesson] = useState(false);
  const [name, setName] = useState("");
  const [lang, setLang] = useState<Lang>("en");
  const [retryAnswers, setRetryAnswers] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Record<number, boolean>>({});
  const quizDone = useRef(false);
  // F3: the hidden camera input lives here so any entry point can open it inside the tap
  const fileInput = useRef<HTMLInputElement>(null);
  const words = WORDS[me?.language ?? lang];

  const fail = useCallback((e: unknown, language: Lang = "en") => {
    setError(e instanceof ApiError ? errorText(WORDS[language], e.code, e.message) : WORDS[language].offline);
    setRetryLesson(false);
    setBusy(false);
  }, []);

  const openLesson = useCallback(
    async (who: Me) => {
      setError("");
      setRetryLesson(false);
      setPhase({ name: "lesson", data: null });
      try {
        for (let attempt = 0; attempt < 30; attempt++) {
          const r = await api.lesson(who.studentId);
          if (r.status !== "generating") {
            if (r.status === "none") setPhase({ name: "done", caughtUp: true });
            else {
              setPhase({ name: "lesson", data: r });
              track("lesson_viewed", { lang: r.lesson?.language, translated: r.lesson?.translated });
            }
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        // still being written after 45 s: say so and offer a retry instead of leaving a spinner up
        setError(WORDS[who.language].slow);
      } catch (e) {
        setError(e instanceof ApiError ? errorText(WORDS[who.language], e.code, e.message) : WORDS[who.language].offline);
      }
      setRetryLesson(true);
    },
    [],
  );

  const nextQuestion = useCallback(
    async (who: Me) => {
      setBusy(true);
      setError("");
      try {
        const n = await api.next(who.studentId);
        if (n.done || !n.question) {
          quizDone.current = true;
          await openLesson(who);
        } else {
          setPhase({ name: "question", q: n.question, index: n.index, total: n.total });
        }
        setBusy(false);
      } catch (e) {
        fail(e, who.language);
      }
    },
    [fail, openLesson],
  );

  const join = useCallback(
    async (nickname: string, language: Lang, then: "quiz" | "homework" = "quiz") => {
      setBusy(true);
      setError("");
      try {
        const j = await api.join(code, nickname, language);
        const who = { studentId: j.student_id, nickname: j.nickname, language: j.language };
        save(code, who);
        setMe(who);
        track("joined", { lang: who.language });
        if (then === "homework") {
          // straight to "take a photo"; the quiz waits until the child taps back
          setBusy(false);
          setPhase({ name: "homework", photo: null, seq: 0, quizDone: quizDone.current });
        } else await nextQuestion(who);
      } catch (e) {
        fail(e, language);
        setPhase({ name: "join" });
      }
    },
    [code, fail, nextQuestion],
  );

  /** Opens the camera (or the photo picker). Must run inside the tap: iOS ignores a click after an await. */
  const takePhoto = () => {
    setError("");
    fileInput.current?.click();
  };

  /** After the homework screen: the same continue as the result screen, so nothing about the quiz changes. */
  const leaveHomework = () => {
    if (!me) return;
    if (quizDone.current) void openLesson(me);
    else void nextQuestion(me);
  };

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const session = await api.lookup(code);
        if (!live) return;
        setClassName(session.class_name);
        const stored = load(code);
        // "?as=asha" resumes the demo student on the demo class only; anywhere else it must not create a student per visit
        if (asAsha && session.session_id === DEMO_SESSION_ID) {
          await join("Asha", "kn");
          return;
        }
        if (stored) {
          setMe(stored);
          await nextQuestion(stored);
        } else {
          setPhase({ name: "join" });
        }
      } catch (e) {
        if (!live) return;
        setError(e instanceof ApiError ? errorText(WORDS[lang], e.code, WORDS[lang].noClass) : WORDS[lang].offline);
        setPhase({ name: "join" });
      }
    })();
    return () => {
      live = false;
    };
    // run once per class code
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  async function answer(q: QuestionOut, index: number, total: number, chosen: string) {
    if (!me) return;
    setBusy(true);
    try {
      const result = await api.answer(me.studentId, q.id, chosen);
      setPhase({ name: "feedback", q, index, total, chosen, result });
      setBusy(false);
      track("diagnosed", { source: result.source, correct: result.correct, gap_open: result.gap_open });
    } catch (e) {
      fail(e, me.language);
    }
  }

  async function submitRetry(items: QuestionOut[]) {
    if (!me) return;
    setBusy(true);
    try {
      const result = await api.retry(
        me.studentId,
        items.map((q) => ({ question_id: q.id, answer: retryAnswers[q.id] ?? "" })),
      );
      setPhase({ name: "result", result });
      setBusy(false);
      track(result.gap_closed ? "gap_closed" : "gap_still_open", { concept: result.concept_id });
    } catch (e) {
      fail(e, me.language);
    }
  }

  const langClass = me?.language === "kn" || (!me && lang === "kn") ? s.kn : "";

  return (
    <main className={`${s.root} ${fontVars} ${langClass} min-h-dvh`}>
      <div className="mx-auto flex min-h-dvh max-w-[520px] flex-col gap-4 px-4 pb-8 pt-4">
        <header className="flex items-center justify-between gap-2">
          <span className={`${s.hand} text-[1.5em] font-bold`}>GuruGraph</span>
          <span className={`${s.muted} min-w-0 flex-1 truncate text-right text-[0.9em]`}>
            {me ? `${me.nickname} · ` : ""}
            {className}
          </span>
          {FLAGS.HOMEWORK && me && (phase.name === "question" || phase.name === "feedback") && (
            <HomeworkButton words={words} variant="icon" disabled={busy} onClick={takePhoto} />
          )}
        </header>

        {FLAGS.HOMEWORK && me && (
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            aria-label={words.hwTakePhoto}
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                setPhase((old) => ({
                  name: "homework",
                  photo: file,
                  seq: (old.name === "homework" ? old.seq : 0) + 1,
                  quizDone: quizDone.current,
                }));
              }
              e.target.value = "";
            }}
          />
        )}

        {error && (
          <div className={`${s.feedItem} ${s.challenge}`} role="alert">
            {error}
            {me && (
              <button
                type="button"
                className={`${s.button} mt-2`}
                onClick={() => void (retryLesson ? openLesson(me) : nextQuestion(me))}
              >
                {words.tryAgain}
              </button>
            )}
          </div>
        )}

        {phase.name === "loading" && (
          <div className="flex flex-col gap-3" aria-busy>
            <div className={`${s.sheet} h-24 animate-pulse`} />
            <div className={`${s.sheet} h-40 animate-pulse`} />
          </div>
        )}

        {phase.name === "join" && (
          <form
            className={`${s.sheet} flex flex-col gap-4 p-5`}
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) void join(name.trim(), lang);
            }}
          >
            <h1 className="text-[1.5em] font-semibold">{words.welcome}</h1>
            <label className="flex flex-col gap-1.5">
              <span className="font-medium">{words.yourName}</span>
              <input
                className={k.input}
                value={name}
                maxLength={30}
                autoComplete="given-name"
                placeholder={words.namePlaceholder}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 font-medium">{words.pickLanguage}</legend>
              <div className="grid grid-cols-3 gap-2">
                {LANGS.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    aria-pressed={lang === l.id}
                    onClick={() => setLang(l.id)}
                    className={`${k.lang} ${lang === l.id ? k.langOn : ""} ${l.id === "kn" ? s.kn : ""}`}
                  >
                    {l.name}
                  </button>
                ))}
              </div>
            </fieldset>
            <button type="submit" className={`${s.button} ${s.primary} ${k.big}`} disabled={busy || !name.trim()}>
              {busy ? words.joining : words.start}
            </button>
            {FLAGS.HOMEWORK && (
              <HomeworkButton
                words={words}
                variant="big"
                disabled={busy || !name.trim()}
                onClick={() => name.trim() && void join(name.trim(), lang, "homework")}
              />
            )}
          </form>
        )}

        {(phase.name === "question" || phase.name === "feedback") && (
          <section className="flex flex-col gap-4" aria-live="polite">
            <div>
              <div className="mb-1.5 flex justify-between text-[0.9em]">
                <span className="font-medium">{words.question(phase.index, phase.total)}</span>
                <span className={s.muted}>{phase.q.concept_name}</span>
              </div>
              <div className={s.meterTrack}>
                <div
                  className={s.meterFill}
                  style={{ width: `${(phase.index / phase.total) * 100}%`, background: "var(--ink-2)" }}
                />
              </div>
            </div>
            <div className={`${s.sheet} p-5`}>
              <p className={`${s.hand} ${k.stem}`}>{phase.q.stem}</p>
            </div>

            {phase.name === "question" ? (
              <AnswerInput
                key={phase.q.id}
                q={phase.q}
                words={words}
                disabled={busy}
                onAnswer={(a) => void answer(phase.q, phase.index, phase.total, a)}
              />
            ) : (
              <div className={`${k.feedback} ${phase.result.correct ? k.good : k.bad}`}>
                <p className="text-[1.3em] font-semibold">
                  {phase.result.correct ? `✓ ${words.correct}` : words.notQuite}
                </p>
                {!phase.result.correct && (
                  <>
                    <p className="mt-1">
                      <span className={`${s.hand} ${k.crossed}`}>{phase.chosen}</span>
                      {phase.result.label && <span className="ml-2">{phase.result.label}</span>}
                    </p>
                    <p className="mt-1 font-medium">{words.answerIs(phase.result.correct_answer)}</p>
                  </>
                )}
                <div className="mt-4 flex flex-col gap-2">
                  {!phase.result.correct && phase.result.gap_open && me && (
                    <button
                      type="button"
                      className={`${s.button} ${s.primary} ${k.big}`}
                      onClick={() => void openLesson(me)}
                    >
                      {words.fixNow}
                    </button>
                  )}
                  <button
                    type="button"
                    className={`${s.button} ${k.big}`}
                    disabled={busy}
                    onClick={() => me && void nextQuestion(me)}
                  >
                    {words.next}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {phase.name === "lesson" && !phase.data && !error && (
          <div className={`${s.sheet} flex flex-col gap-3 p-5`} role="status">
            <p className="font-medium">{words.writing}</p>
            <div className="h-4 w-3/4 animate-pulse rounded bg-[#eef1f6]" />
            <div className="h-4 w-full animate-pulse rounded bg-[#eef1f6]" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-[#eef1f6]" />
          </div>
        )}

        {phase.name === "lesson" && phase.data?.lesson && (
          <section className="flex flex-col gap-4">
            <div className={`${s.sheet} p-5`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className={`${s.hand} text-[1.4em]`}>{words.lesson}</h2>
                <span className={s.chip}>
                  {phase.data.lesson.translated ? phase.data.lesson.language_label : words.translationMissing}
                </span>
              </div>
              <p className="mb-2 text-[0.92em]" style={{ color: "var(--red-pen)" }}>
                {phase.data.lesson.concept_name} · {phase.data.lesson.label}
              </p>
              <div className={k.lesson}>
                <ReactMarkdown>{phase.data.lesson.lesson_md}</ReactMarkdown>
              </div>
              {me && (
                <div className="mt-1">
                  <Listen
                    text={speakable(phase.data.lesson.lesson_md)}
                    language={me.language}
                    words={words}
                    label={words.lesson}
                  />
                </div>
              )}
            </div>
            <div className={`${s.sheet} p-5`}>
              <h3 className="mb-2 font-semibold">{words.practise}</h3>
              <ol className="flex flex-col gap-2">
                {phase.data.lesson.practice.map((p, i) => (
                  <li key={i} className="flex items-center justify-between gap-3">
                    <span className={s.hand}>{p.question}</span>
                    {shown[i] ? (
                      <span className={`${s.hand} font-bold`} style={{ color: "var(--green)" }}>
                        {p.answer}
                      </span>
                    ) : (
                      <button type="button" className={s.button} onClick={() => setShown((x) => ({ ...x, [i]: true }))}>
                        {words.showAnswer}
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            </div>
            {phase.data.retry && phase.data.retry.length > 0 && (
              <button
                type="button"
                className={`${s.button} ${s.primary} ${k.big}`}
                onClick={() => {
                  setRetryAnswers({});
                  setPhase({ name: "retry", items: phase.data?.retry ?? [] });
                }}
              >
                {words.tryTwo}
              </button>
            )}
          </section>
        )}

        {phase.name === "retry" && (
          <section className="flex flex-col gap-4">
            {phase.items.map((q, i) => (
              <div key={q.id} className={`${s.sheet} flex flex-col gap-3 p-5`}>
                <p className={`${s.hand} ${k.stem}`}>
                  {i + 1}. {q.stem}
                </p>
                {q.kind === "mcq" && q.options ? (
                  <div className="flex flex-col gap-2">
                    {q.options.map((o) => (
                      <button
                        key={o}
                        type="button"
                        aria-pressed={retryAnswers[q.id] === o}
                        className={`${k.option} ${s.hand} ${retryAnswers[q.id] === o ? k.optionOn : ""}`}
                        onClick={() => setRetryAnswers((x) => ({ ...x, [q.id]: o }))}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                ) : (
                  <input
                    className={`${k.input} ${s.hand}`}
                    placeholder={words.typeHint}
                    aria-label={words.typeHint}
                    value={retryAnswers[q.id] ?? ""}
                    onChange={(e) => setRetryAnswers((x) => ({ ...x, [q.id]: e.target.value }))}
                  />
                )}
              </div>
            ))}
            <button
              type="button"
              className={`${s.button} ${s.primary} ${k.big}`}
              disabled={busy || phase.items.some((q) => !(retryAnswers[q.id] ?? "").trim())}
              onClick={() => void submitRetry(phase.items)}
            >
              {words.checkBoth}
            </button>
          </section>
        )}

        {phase.name === "result" && (
          <section className={`${s.sheet} flex flex-col items-center gap-3 p-6 text-center`} aria-live="polite">
            {phase.result.gap_closed ? (
              <>
                <div className={k.burst} aria-hidden>
                  {Array.from({ length: 12 }, (_, i) => (
                    <span key={i} style={{ ["--i" as string]: i }} />
                  ))}
                </div>
                <p className={`${k.closed} ${s.hand}`}>
                  <span className={s.highlight}>{words.gapClosed}</span>
                </p>
              </>
            ) : (
              <p className="text-[1.2em] font-semibold">{words.keepGoing}</p>
            )}
            <ul className="flex flex-col gap-1">
              {phase.result.results.map((r) => (
                <li key={r.question_id} style={{ color: r.correct ? "var(--green)" : "var(--red-pen)" }}>
                  {r.correct ? "✓" : "✗"} <span className={s.hand}>{r.correct_answer}</span>
                </li>
              ))}
            </ul>
            <p className={s.muted}>{words.teacherTold}</p>
            <button
              type="button"
              className={`${s.button} ${s.primary} ${k.big} w-full`}
              onClick={() => {
                if (!me) return;
                if (quizDone.current) void openLesson(me);
                else void nextQuestion(me);
              }}
            >
              {words.continueQuiz}
            </button>
            {FLAGS.HOMEWORK && me && <HomeworkButton words={words} variant="big" onClick={takePhoto} />}
          </section>
        )}

        {phase.name === "done" && (
          <section className={`${s.sheet} flex flex-col items-center gap-2 p-6 text-center`}>
            <p className={`${s.hand} text-[1.8em]`}>{words.allDone}</p>
            <p className={s.muted}>{phase.caughtUp ? words.caughtUp : words.allDoneNote}</p>
            {FLAGS.HOMEWORK && me && (
              <div className="mt-2 w-full">
                <HomeworkButton words={words} variant="big" onClick={takePhoto} />
              </div>
            )}
          </section>
        )}

        {phase.name === "homework" && me && (
          <Homework
            key={phase.seq}
            studentId={me.studentId}
            language={me.language}
            words={words}
            photo={phase.photo}
            quizDone={phase.quizDone}
            onTakePhoto={takePhoto}
            onFix={() => void openLesson(me)}
            onLeave={leaveHomework}
          />
        )}
      </div>
    </main>
  );
}
