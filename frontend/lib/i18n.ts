import { Lang } from "./types";

type Strings = {
  join: string;
  questionNofM: (n: number, m: number) => string;
  checkAnswer: string;
  correct: string;
  notQuite: string;
  theAnswerIs: (answer: string) => string;
  lesson: string;
  try2More: string;
  gapClosed: string;
  keepPractising: string;
  teacherNotified: string;
  loading: string;
  error: string;
  retry: string;
};

const en: Strings = {
  join: "Join",
  questionNofM: (n, m) => `Question ${n} of ${m}`,
  checkAnswer: "Check answer",
  correct: "Correct!",
  notQuite: "Not quite",
  theAnswerIs: (answer) => `The answer is ${answer}`,
  lesson: "Lesson",
  try2More: "Try 2 more to close this gap",
  gapClosed: "Gap closed",
  keepPractising: "Keep practising",
  teacherNotified: "Your teacher has been notified",
  loading: "Loading...",
  error: "Error",
  retry: "Retry",
};

const hi: Strings = {
  join: "शामिल हों",
  questionNofM: (n, m) => `प्रश्न ${n} / ${m}`,
  checkAnswer: "उत्तर जांचें",
  correct: "सही!",
  notQuite: "पूरी तरह से नहीं",
  theAnswerIs: (answer) => `उत्तर है ${answer}`,
  lesson: "पाठ",
  try2More: "इस कमी को दूर करने के लिए 2 और प्रयास करें",
  gapClosed: "कमी दूर हो गई",
  keepPractising: "अभ्यास करते रहें",
  teacherNotified: "आपके शिक्षक को सूचित कर दिया गया है",
  loading: "लोड हो रहा है...",
  error: "त्रुटि",
  retry: "पुनः प्रयास करें",
};

const kn: Strings = {
  join: "ಸೇರಿ",
  questionNofM: (n, m) => `ಪ್ರಶ್ನೆ ${n} / ${m}`,
  checkAnswer: "ಉತ್ತರ ಪರಿಶೀಲಿಸಿ",
  correct: "ಸರಿ!",
  notQuite: "ಸರಿಯಾಗಿಲ್ಲ",
  theAnswerIs: (answer) => `ಉತ್ತರ ${answer}`,
  lesson: "ಪಾಠ",
  try2More: "ಈ ಕೊರತೆಯನ್ನು ನೀಗಿಸಲು ಇನ್ನೂ 2 ಪ್ರಯತ್ನಿಸಿ",
  gapClosed: "ಕೊರತೆ ನೀಗಿದೆ",
  keepPractising: "ಅಭ್ಯಾಸ ಮುಂದುವರಿಸಿ",
  teacherNotified: "ನಿಮ್ಮ ಶಿಕ್ಷಕರಿಗೆ ತಿಳಿಸಲಾಗಿದೆ",
  loading: "ಲೋಡ್ ಆಗುತ್ತಿದೆ...",
  error: "ದೋಷ",
  retry: "ಮರುಪ್ರಯತ್ನಿಸಿ",
};

export const i18n: Record<Lang, Strings> = { en, hi, kn };

export function getI18n(lang: Lang | undefined | null): Strings {
  return i18n[lang || "en"];
}
