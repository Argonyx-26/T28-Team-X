"""HTTP routes. One endpoint per agent action; IDs travel in the body or query string, never in the path."""

import asyncio
import secrets
import time
from collections import defaultdict, deque
from typing import Literal

from fastapi import APIRouter, File, Form, Header, Request, Response, UploadFile
from pydantic import BaseModel, Field

from . import seed, voice
from .agents import analyst, coach, curator, diagnostician, examiner, review, simulator, state
from .config import settings
from .db import get_conn, log_event, new_id, now, transaction
from .errors import ApiError
from .llm.providers import providers_status
from .topic import get_topic

router = APIRouter()

Lang = Literal["en", "hi", "kn"]


class CreateSession(BaseModel):
    class_name: str = Field(min_length=1, max_length=80)
    code: str | None = Field(default=None, max_length=12)


class Join(BaseModel):
    code: str = Field(min_length=1, max_length=12)
    nickname: str = Field(min_length=1, max_length=40)
    language: Lang = "en"


class StudentRef(BaseModel):
    student_id: str


class Answer(BaseModel):
    student_id: str
    question_id: str
    answer: str = Field(min_length=1, max_length=120)


class RetryAnswer(BaseModel):
    question_id: str
    answer: str = Field(min_length=1, max_length=120)


class Retry(BaseModel):
    student_id: str
    answers: list[RetryAnswer] = Field(min_length=1, max_length=4)


class Simulate(BaseModel):
    session_id: str
    n: int = Field(default=30, ge=1, le=60)


class SessionRef(BaseModel):
    session_id: str


class Review(BaseModel):
    student_id: str
    question_id: str
    verdict: Literal["agree", "change_tag", "change_step", "mark_correct"]
    tag: str | None = None
    step: int | None = Field(default=None, ge=1, le=12)


class Approve(BaseModel):
    recommendation_id: str


# a small per-IP limiter for the endpoints that cost money
_hits: dict[str, deque] = defaultdict(deque)


def _limit(request: Request, key: str, per_minute: int) -> None:
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "?").split(",")[0].strip()
    q = _hits[f"{key}:{ip}"]
    t = time.monotonic()
    while q and t - q[0] > 60:
        q.popleft()
    if len(q) >= per_minute:
        raise ApiError(429, "slow_down", "Too many requests. Wait a minute and try again.")
    q.append(t)


@router.get("/health")
def health() -> dict:
    return {"ok": True, "version": settings.version, "demo_mode": settings.demo_mode, "providers": providers_status()}


@router.get("/topic")
def topic() -> dict:
    t = get_topic()
    return {
        "topic": {"id": t.id, "name": t.name},
        "concepts": [
            {"id": c.id, "name": c.name, "short": c.short, "prereqs": list(c.prereqs), "names": c.names}
            for c in t.concepts
        ],
        "edges": [list(e) for e in t.edges],
        "tags": [{"tag": tag.tag, "labels": tag.labels} for tag in t.tags.values()],
        "photo_questions": [
            {"id": q.id, "stem": q.stem, "concept_id": q.concept_id} for q in t.questions if q.kind == "photo"
        ],
    }


def _lookup(conn, session: dict) -> dict:
    n = conn.execute("SELECT count(*) FROM student WHERE session_id = ?", (session["id"],)).fetchone()[0]
    return {
        "session_id": session["id"],
        "code": session["code"],
        "class_name": session["class_name"],
        "topic_name": get_topic().name,
        "n_students": n,
    }


@router.post("/sessions/create")
def create_session(body: CreateSession) -> dict:
    code = (body.code or secrets.token_hex(2)).strip().upper()
    with get_conn() as conn, transaction(conn):
        if conn.execute("SELECT 1 FROM session WHERE upper(code) = ?", (code,)).fetchone():
            raise ApiError(409, "code_taken", "That class code is already in use.")
        session = {"id": new_id("ses"), "code": code, "class_name": body.class_name.strip()}
        conn.execute(
            "INSERT INTO session (id, code, class_name, topic_id, created_at) VALUES (?, ?, ?, ?, ?)",
            (session["id"], code, session["class_name"], get_topic().id, now()),
        )
        out = _lookup(conn, session)
    return {**out, "join_url": f"{settings.public_app_url}/join/{code}"}


@router.get("/sessions/lookup")
def lookup(code: str) -> dict:
    with get_conn() as conn:
        return _lookup(conn, state.session_by_code(conn, code))


@router.post("/students/join")
def join(body: Join) -> dict:
    nickname = body.nickname.strip()
    with get_conn() as conn:
        session = state.session_by_code(conn, body.code)
        if session["id"] == seed.DEMO_SESSION_ID and nickname.lower() == "asha":
            if not conn.execute("SELECT 1 FROM student WHERE id = ?", (seed.ASHA_ID,)).fetchone():
                with transaction(conn):
                    seed.create_asha(conn)
            return {
                "student_id": seed.ASHA_ID,
                "session_id": session["id"],
                "nickname": "Asha",
                "language": "kn",
                "resumed": True,
            }
        student_id = new_id("stu")
        with transaction(conn):
            conn.execute(
                "INSERT INTO student (id, session_id, nickname, language, kind, created_at) "
                "VALUES (?, ?, ?, ?, 'real', ?)",
                (student_id, session["id"], nickname, body.language, now()),
            )
            log_event(conn, session["id"], "Examiner", "join", f"{nickname} joined ({body.language})", student_id)
    return {
        "student_id": student_id,
        "session_id": session["id"],
        "nickname": nickname,
        "language": body.language,
        "resumed": False,
    }


@router.post("/agents/examiner/next")
def examiner_next(body: StudentRef) -> dict:
    return examiner.next_question(body.student_id)


@router.post("/agents/diagnostician/answer")
async def diagnostician_answer(body: Answer, request: Request) -> dict:
    _limit(request, "answer", 60)
    return await diagnostician.answer(body.student_id, body.question_id, body.answer.strip())


@router.post("/agents/diagnostician/photo")
async def diagnostician_photo(
    request: Request,
    student_id: str = Form(...),
    question_id: str = Form(...),
    image: UploadFile = File(...),
) -> dict:
    _limit(request, "photo", 60)
    data = await image.read(diagnostician.MAX_IMAGE_BYTES + 1)
    return await diagnostician.photo(student_id, question_id, data)


@router.post("/agents/diagnostician/stack")
async def diagnostician_stack(
    request: Request,
    question_id: str = Form(...),
    student_ids: list[str] = Form(...),
    images: list[UploadFile] = File(...),
) -> dict:
    """A pile of notebooks: one photo per student, read in parallel (at most 6 at a time)."""
    _limit(request, "stack", 5)
    if len(student_ids) != len(images) or not 1 <= len(images) <= 40:
        raise ApiError(422, "stack_mismatch", "Send one student per photo, up to 40 photos.")
    gate = asyncio.Semaphore(6)

    async def one(student_id: str, image: UploadFile) -> dict:
        async with gate:
            try:
                data = await image.read(diagnostician.MAX_IMAGE_BYTES + 1)
                return await diagnostician.photo(student_id, question_id, data)
            except ApiError as exc:
                return {"student_id": student_id, "error": {"code": exc.code, "message": exc.message}}

    results = await asyncio.gather(*(one(s, i) for s, i in zip(student_ids, images, strict=True)))
    return {"results": results}


@router.post("/agents/curator/lesson")
async def curator_lesson(body: StudentRef) -> dict:
    return await curator.lesson(body.student_id)


@router.post("/agents/examiner/retry")
def examiner_retry(body: Retry) -> dict:
    return examiner.retry(body.student_id, [a.model_dump() for a in body.answers])


@router.post("/agents/simulator/run")
def simulator_run(body: Simulate, request: Request) -> dict:
    _limit(request, "simulate", 3)
    with get_conn() as conn:
        state.require_session(conn, body.session_id)
        start = conn.execute(
            "SELECT count(*) FROM student WHERE session_id = ? AND kind = 'simulated'", (body.session_id,)
        ).fetchone()[0]
        with transaction(conn):
            return simulator.run(conn, body.session_id, body.n, start=start)


@router.post("/agents/analyst/analyze")
async def analyst_analyze(body: SessionRef, request: Request) -> dict:
    _limit(request, "analyze", 10)
    return await coach.analyze(body.session_id)


@router.post("/teacher/approve")
def teacher_approve(body: Approve) -> dict:
    return coach.approve(body.recommendation_id)


@router.post("/teacher/review")
def teacher_review(body: Review) -> dict:
    """The teacher confirms or corrects a diagnosis. The teacher always has the last word."""
    return review.review(body.student_id, body.question_id, body.verdict, body.tag, body.step)


@router.get("/teacher/dashboard")
def teacher_dashboard(session_id: str) -> dict:
    return analyst.dashboard(session_id)


@router.get("/teacher/worksheet")
def teacher_worksheet(session_id: str, concept_id: str, tag: str) -> dict:
    return analyst.worksheet(session_id, concept_id, tag)


@router.get("/teacher/events")
def teacher_events(session_id: str, after: int = 0) -> dict:
    return analyst.events(session_id, after)


@router.get("/teacher/student")
def teacher_student(student_id: str) -> dict:
    return analyst.student_detail(student_id)


@router.post("/agents/coach/parent-message")
async def coach_parent_message(body: StudentRef, request: Request) -> dict:
    _limit(request, "parent", 20)
    return await coach.parent_message(body.student_id)


@router.get("/media/voice")
async def media_voice(id: str) -> Response:
    audio = await voice.clip(id)
    if audio is None:
        raise ApiError(404, "voice_note_expired", "That voice note has expired. Create it again.")
    return Response(audio, media_type="audio/mpeg")


@router.get("/judges/summary")
def judges_summary() -> dict:
    return analyst.judges_summary()


def _check_admin(token: str | None) -> None:
    if not token or not secrets.compare_digest(token, settings.admin_token):
        raise ApiError(401, "unauthorized", "Admin token required.")


@router.post("/admin/reset")
def admin_reset(x_admin_token: str | None = Header(default=None)) -> dict:
    _check_admin(x_admin_token)
    seed.reset()
    return {"ok": True}


@router.post("/admin/warm-lessons")
async def admin_warm(x_admin_token: str | None = Header(default=None)) -> dict:
    """Pre-generates lessons for the most common mistakes; save the result as data/lessons_cache.json."""
    _check_admin(x_admin_token)
    return {"lessons": await curator.warm(curator.DEMO_PAIRS)}
