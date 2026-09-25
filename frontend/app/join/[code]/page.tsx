"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import type {
  AnswerResponse,
  Lang,
  NextResponse,
  QuestionOut,
  SessionLookup,
} from "@/lib/types";

const languages: { value: Lang; label: string }[] = [
  { value: "en", label: "English" },
  { value: "hi", label: "हिन्दी" },
  { value: "kn", label: "ಕನ್ನಡ" },
];

const uiText = {
  en: {
    question: "Question",
    of: "of",
    check: "Check answer",
    checking: "Checking...",
    correct: "Correct!",
    answer: "The answer is",
    next: "Next",
    name: "What should we call you?",
    language: "Choose your language",
    join: "Join class",
    joining: "Joining...",
    placeholder: "Enter your name",
    choose: "Choose an answer",
    typeHint: "e.g. 3/4 or 1 1/2",
    classNotFound: "Class not found",
    askTeacher: "Ask your teacher for the class code.",
    tryAgain: "Could not join the class. Please try again.",
  },
  hi: {
    question: "प्रश्न",
    of: "में से",
    check: "उत्तर जाँचें",
    checking: "जाँच रहे हैं...",
    correct: "सही!",
    answer: "उत्तर है",
    next: "आगे",
    name: "आपका नाम क्या है?",
    language: "भाषा चुनें",
    join: "कक्षा में शामिल हों",
    joining: "शामिल हो रहे हैं...",
    placeholder: "अपना नाम लिखें",
    choose: "एक उत्तर चुनें",
    typeHint: "जैसे 3/4 या 1 1/2",
    classNotFound: "कक्षा नहीं मिली",
    askTeacher: "कक्षा कोड के लिए अपने शिक्षक से पूछें।",
    tryAgain: "कक्षा में शामिल नहीं हो सके। फिर कोशिश करें।",
  },
  kn: {
    question: "ಪ್ರಶ್ನೆ",
    of: "ರಲ್ಲಿ",
    check: "ಉತ್ತರ ಪರಿಶೀಲಿಸಿ",
    checking: "ಪರಿಶೀಲಿಸಲಾಗುತ್ತಿದೆ...",
    correct: "ಸರಿಯಾಗಿದೆ!",
    answer: "ಉತ್ತರ",
    next: "ಮುಂದೆ",
    name: "ನಿಮ್ಮ ಹೆಸರು ಏನು?",
    language: "ಭಾಷೆಯನ್ನು ಆಯ್ಕೆಮಾಡಿ",
    join: "ತರಗತಿಗೆ ಸೇರಿ",
    joining: "ಸೇರುತ್ತಿದೆ...",
    placeholder: "ನಿಮ್ಮ ಹೆಸರು ನಮೂದಿಸಿ",
    choose: "ಒಂದು ಉತ್ತರ ಆಯ್ಕೆಮಾಡಿ",
    typeHint: "ಉದಾ. 3/4 ಅಥವಾ 1 1/2",
    classNotFound: "ತರಗತಿ ಕಂಡುಬಂದಿಲ್ಲ",
    askTeacher: "ತರಗತಿ ಕೋಡ್‌ಗಾಗಿ ನಿಮ್ಮ ಶಿಕ್ಷಕರನ್ನು ಕೇಳಿ.",
    tryAgain: "ತರಗತಿಗೆ ಸೇರಲಾಗಲಿಲ್ಲ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
  },
} as const;

export default function StudentPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  const code = params.code;

  const [session, setSession] = useState<SessionLookup | null>(null);
  const [studentId, setStudentId] = useState("");
  const [language, setLanguage] = useState<Lang>("en");

  const [nickname, setNickname] = useState("");
  const [joinLanguage, setJoinLanguage] = useState<Lang>("en");

  const [question, setQuestion] = useState<QuestionOut | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [total, setTotal] = useState(5);

  const [selectedAnswer, setSelectedAnswer] = useState("");
  const [answer, setAnswer] = useState<AnswerResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const text = uiText[language];

  const loadQuestion = useCallback(
    async (id: string) => {
      setLoading(true);
      setError("");
      setAnswer(null);
      setSelectedAnswer("");

      try {
        const result: NextResponse = await api.getExaminerNext({
          student_id: id,
        });

        setQuestionIndex(result.index);
        setTotal(result.total);

        if (result.done || !result.question) {
          setQuestion(null);
          return;
        }

        setQuestion(result.question);
      } catch {
        setError("Could not load the question. Please try again.");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    async function initialise() {
      try {
        const stored = localStorage.getItem(`gurugraph:${code}:student`);

        if (stored) {
          const parsed = JSON.parse(stored) as {
            student_id: string;
            language: Lang;
          };

          setStudentId(parsed.student_id);
          setLanguage(parsed.language);
          await loadQuestion(parsed.student_id);
          return;
        }

        const result = await api.lookupSession(code);
        setSession(result);

        if (searchParams.get("as") === "asha") {
          setNickname("Asha");
          setJoinLanguage("kn");
        }
      } catch {
        setError("Ask your teacher for the class code.");
        setLoading(false);
      }
    }

    initialise();
  }, [code, loadQuestion, searchParams]);

  async function handleJoin(event: React.FormEvent) {
    event.preventDefault();

    if (!nickname.trim()) {
      setError("Please enter your name.");
      return;
    }

    setJoining(true);
    setError("");

    try {
      const result = await api.joinSession({
        code,
        nickname: nickname.trim(),
        language: joinLanguage,
      });

      localStorage.setItem(
        `gurugraph:${code}:student`,
        JSON.stringify({
          student_id: result.student_id,
          language: result.language,
        }),
      );

      setStudentId(result.student_id);
      setLanguage(result.language);
      setSession(null);

      if (searchParams.get("as") === "asha") {
        await loadQuestion(result.student_id);
      } else {
        await loadQuestion(result.student_id);
      }
    } catch {
      setError(text.tryAgain);
    } finally {
      setJoining(false);
    }
  }

  async function handleCheck() {
    if (!question || !studentId || !selectedAnswer.trim()) return;

    setChecking(true);
    setError("");

    try {
      const result = await api.answerQuestion({
        student_id: studentId,
        question_id: question.id,
        answer: selectedAnswer.trim(),
      });

      setAnswer(result);
    } catch {
      setError("Could not check your answer. Please try again.");
    } finally {
      setChecking(false);
    }
  }

  async function handleNext() {
    if (!studentId) return;
    await loadQuestion(studentId);
  }

  if (loading && !question && !session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-grid p-6">
        <div className="w-full max-w-md animate-pulse space-y-4">
          <div className="h-8 w-48 rounded bg-muted" />
          <div className="h-28 rounded-[18px] bg-muted" />
          <div className="h-14 rounded-[10px] bg-muted" />
        </div>
      </main>
    );
  }

  if (!studentId && session) {
    return (
      <main className="min-h-screen bg-grid px-4 py-8">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md items-center">
          <section className="w-full rounded-[18px] border bg-background p-5 shadow-sm sm:p-6">
            <p className="text-sm font-medium text-muted-foreground">
              GuruGraph
            </p>

            <h1 className="mt-2 text-3xl font-bold">
              {session.class_name}
            </h1>

            <p className="mt-1 text-muted-foreground">
              {session.topic_name}
            </p>

            <form onSubmit={handleJoin} className="mt-6 space-y-6">
              <div>
                <label
                  htmlFor="nickname"
                  className="mb-2 block text-sm font-medium"
                >
                  {uiText[joinLanguage].name}
                </label>

                <input
                  id="nickname"
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                  placeholder={uiText[joinLanguage].placeholder}
                  className="h-14 w-full rounded-[10px] border bg-background px-4 text-base outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <p className="mb-3 text-sm font-medium">
                  {uiText[joinLanguage].language}
                </p>

                <div className="grid gap-3">
                  {languages.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setJoinLanguage(item.value)}
                      className={`h-14 rounded-[10px] border px-4 text-left font-medium transition ${
                        joinLanguage === item.value
                          ? "border-primary bg-primary/10 ring-2 ring-primary"
                          : "hover:bg-muted"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <p
                  role="alert"
                  className="rounded-[10px] border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                >
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={joining}
                className="h-14 w-full rounded-[10px] bg-primary font-semibold text-primary-foreground disabled:opacity-60"
              >
                {joining
                  ? uiText[joinLanguage].joining
                  : uiText[joinLanguage].join}
              </button>
            </form>
          </section>
        </div>
      </main>
    );
  }

  if (!studentId) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-grid p-6">
        <div className="w-full max-w-md rounded-[18px] border bg-background p-6 text-center">
          <h1 className="text-2xl font-bold">{text.classNotFound}</h1>
          <p className="mt-3 text-muted-foreground">{text.askTeacher}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-grid px-4 py-6">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              GuruGraph
            </p>
            <h1 className="text-lg font-bold">
              {session?.class_name ?? "Your class"}
            </h1>
          </div>

          <span className="rounded-full border bg-background px-3 py-1 text-sm">
            {language === "en"
              ? "English"
              : language === "hi"
                ? "हिन्दी"
                : "ಕನ್ನಡ"}
          </span>
        </header>

        <section className="rounded-[18px] border bg-background p-5 shadow-sm sm:p-7">
          {loading ? (
            <div className="animate-pulse space-y-5">
              <div className="h-5 w-32 rounded bg-muted" />
              <div className="h-3 w-full rounded bg-muted" />
              <div className="h-24 rounded-xl bg-muted" />
              <div className="h-14 rounded-[10px] bg-muted" />
              <div className="h-14 rounded-[10px] bg-muted" />
            </div>
          ) : !question ? (
            <div className="py-10 text-center">
              <div className="text-5xl">✓</div>
              <h2 className="mt-4 text-2xl font-bold">
                You&apos;re all caught up!
              </h2>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between text-sm font-medium">
                <span>
                  {text.question} {questionIndex + 1} {text.of} {total}
                </span>
                <span className="text-muted-foreground">
                  {Math.round(((questionIndex + 1) / total) * 100)}%
                </span>
              </div>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{
                    width: `${Math.min(
                      100,
                      ((questionIndex + 1) / total) * 100,
                    )}%`,
                  }}
                />
              </div>

              <div className="mt-7">
                <h2 className="text-xl font-semibold leading-relaxed sm:text-2xl">
                  {question.stem}
                </h2>
              </div>

              <div className="mt-6 space-y-3">
                {question.kind === "mcq" && question.options
                  ? question.options.map((option) => (
                      <button
                        key={option}
                        type="button"
                        disabled={!!answer}
                        onClick={() => setSelectedAnswer(option)}
                        className={`min-h-14 w-full rounded-[10px] border px-4 text-left text-base transition ${
                          selectedAnswer === option
                            ? "border-primary bg-primary/10 ring-2 ring-primary"
                            : "hover:bg-muted"
                        } ${answer ? "cursor-default opacity-80" : ""}`}
                      >
                        {option}
                      </button>
                    ))
                  : (
                      <input
                        value={selectedAnswer}
                        onChange={(event) =>
                          setSelectedAnswer(event.target.value)
                        }
                        disabled={!!answer}
                        inputMode="text"
                        placeholder={text.typeHint}
                        className="h-14 w-full rounded-[10px] border bg-background px-4 text-lg outline-none focus:ring-2 focus:ring-primary"
                      />
                    )}
              </div>

              {error && (
                <p
                  role="alert"
                  className="mt-4 rounded-[10px] border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                >
                  {error}
                </p>
              )}

              {!answer ? (
                <button
                  type="button"
                  onClick={handleCheck}
                  disabled={checking || !selectedAnswer.trim()}
                  className="mt-6 h-14 w-full rounded-[10px] bg-primary text-base font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {checking ? text.checking : text.check}
                </button>
              ) : (
                <div
                  className={`mt-6 rounded-[14px] border p-5 ${
                    answer.correct
                      ? "border-green-500/30 bg-green-500/5"
                      : "border-red-500/30 bg-red-500/5"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`text-2xl font-bold ${
                        answer.correct ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {answer.correct ? "✓" : "✕"}
                    </span>

                    <div className="flex-1">
                      <h3 className="font-bold">
                        {answer.correct
                          ? text.correct
                          : answer.label || answer.feedback}
                      </h3>

                      <p className="mt-1 text-sm leading-relaxed">
                        {answer.feedback}
                      </p>

                      {!answer.correct && (
                        <p className="mt-2 text-sm font-medium">
                          {text.answer}{" "}
                          <span className="font-bold">
                            {answer.correct_answer}
                          </span>
                        </p>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleNext}
                    className="mt-5 h-12 w-full rounded-[10px] bg-primary font-semibold text-primary-foreground"
                  >
                    {text.next}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}