import { FIXTURES } from "./fixtures";
import * as T from "./types";

export class ApiError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

async function request<TResponse>(path: string, options?: RequestInit): Promise<TResponse> {
  const url = `/backend${path}`;
  const res = await fetch(url, { ...options, cache: "no-store" });
  if (!res.ok) {
    let errData;
    try {
      errData = await res.json();
    } catch {
      throw new Error(`HTTP error ${res.status}`);
    }
    if (errData?.error?.message) {
      throw new ApiError(errData.error.message, errData.error.code || "unknown");
    }
    throw new Error(`HTTP error ${res.status}`);
  }
  return res.json() as Promise<TResponse>;
}

async function withFixture<TResponse>(fixtureFn: () => TResponse | Promise<TResponse>, apiCall: () => Promise<TResponse>): Promise<TResponse> {
  if (process.env.NEXT_PUBLIC_USE_FIXTURES === "1") {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return fixtureFn();
  }
  return apiCall();
}

export const api = {
  getHealth: () =>
    withFixture(FIXTURES.getHealth, () => request<{ ok: boolean; version: string; demo_mode: boolean; providers: { nebius: boolean; vertex: boolean } }>("/health")),
  getMediaVoice: (id: string) =>
    withFixture(FIXTURES.getMediaVoice, async () => {
      const res = await fetch(`/backend/media/voice?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.blob();
    }),
  getTopic: () =>
    withFixture(FIXTURES.getTopic, () => request<T.TopicResponse>("/topic")),
    
  createSession: (data: { class_name: string; code?: string }) =>
    withFixture(FIXTURES.createSession, () =>
      request<T.SessionLookup & { join_url: string }>("/sessions/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
    ),

  lookupSession: (code: string) =>
    withFixture(FIXTURES.lookupSession, () => request<T.SessionLookup>(`/sessions/lookup?code=${encodeURIComponent(code)}`)),

  joinSession: (data: { code: string; nickname: string; language: T.Lang }) =>
    withFixture(() => FIXTURES.joinSession(data.nickname, data.language), () =>
      request<T.JoinResponse>("/students/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
    ),

  getExaminerNext: (data: { student_id: string }) =>
    withFixture(FIXTURES.getExaminerNext, () =>
      request<T.NextResponse>("/agents/examiner/next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
    ),

  answerQuestion: (data: { student_id: string; question_id: string; answer: string }) =>
    withFixture(FIXTURES.answerQuestion, () =>
      request<T.AnswerResponse>("/agents/diagnostician/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
    ),

  photoDiagnose: (student_id: string, question_id: string, image: File | Blob) =>
    withFixture(FIXTURES.photoDiagnose, () => {
      const formData = new FormData();
      formData.append("student_id", student_id);
      formData.append("question_id", question_id);
      formData.append("image", image);
      return request<T.PhotoResponse>("/agents/diagnostician/photo", {
        method: "POST",
        body: formData,
      });
    }),

  getCuratorLesson: (data: { student_id: string }) =>
    withFixture(FIXTURES.getCuratorLesson, () =>
      request<T.LessonResponse>("/agents/curator/lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
    ),

  submitRetry: (data: { student_id: string; answers: { question_id: string; answer: string }[] }) =>
    withFixture(FIXTURES.submitRetry, () =>
      request<T.RetryResponse>("/agents/examiner/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
    ),

  runSimulator: (data: { session_id: string; n?: number }) =>
    withFixture(FIXTURES.runSimulator, () =>
      request<{ students_added: number; answers: number; gaps_closed: number; llm_calls: number }>("/agents/simulator/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
    ),

  analyzeClass: (data: { session_id: string }) =>
    withFixture(FIXTURES.analyzeClass, () =>
      request<T.AnalyzeResponse>("/agents/analyst/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
    ),

  approveRecommendation: (data: { recommendation_id: string }) =>
    withFixture(FIXTURES.approveRecommendation, () =>
      request<{ ok: boolean }>("/teacher/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
    ),

  getDashboard: (session_id: string) =>
    withFixture(FIXTURES.getDashboard, () =>
      request<T.Dashboard>(`/teacher/dashboard?session_id=${encodeURIComponent(session_id)}`)
    ),

  getEvents: (session_id: string, after: number) =>
    withFixture(FIXTURES.getEvents, () =>
      request<T.EventsResponse>(`/teacher/events?session_id=${encodeURIComponent(session_id)}&after=${after}`)
    ),

  getStudentDetail: (student_id: string) =>
    withFixture(FIXTURES.getStudentDetail, () =>
      request<T.StudentDetail>(`/teacher/student?student_id=${encodeURIComponent(student_id)}`)
    ),

  parentMessage: (data: { student_id: string }) =>
    withFixture(FIXTURES.parentMessage, () =>
      request<T.ParentMessage>("/agents/coach/parent-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
    ),

  resetAdmin: (token: string) =>
    withFixture(FIXTURES.resetAdmin, () =>
      request<{ ok: boolean }>("/admin/reset", {
        method: "POST",
        headers: { "X-Admin-Token": token },
      })
    ),

  getJudgesSummary: () =>
    withFixture(FIXTURES.getJudgesSummary, () => request<T.JudgesSummary>("/judges/summary")),
};
