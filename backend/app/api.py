"""HTTP routes. One endpoint per agent action; IDs travel in the body or query string, never in the path."""

import asyncio
import json
import secrets
import time
from collections import defaultdict, deque
from typing import Literal

from fastapi import APIRouter, File, Form, Header, Request, Response, UploadFile
from pydantic import BaseModel, Field

from . import seed, voice
from .agents import analyst, coach, curator, diagnostician, examiner, pages, review, simulator, state
from .config import settings
from .db import get_conn, log_event, new_id, now, transaction
from .errors import ApiError
from .llm.providers import providers_status
from .nicknames import clean_nickname
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
    roll_no: int | None = Field(default=None, ge=1, le=999)


class StudentRef(BaseModel):
    student_id: str


class Answer(BaseModel):
    student_id: str
    question_id: str
    answer: str = Field(min_length=1, max_length=120)
    # "photo": the teacher typed the final answer from an unreadable page; it never counts toward the student's quiz
    phase: Literal["quiz", "photo"] = "quiz"


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


class RemoveStudent(BaseModel):
    student_id: str


class FilePage(BaseModel):
    student_id: str
    mode: Literal["homework", "snap"] = "snap"
    problems: list[dict] = Field(max_length=6)


class Speak(BaseModel):
    text: str = Field(min_length=1, max_length=1200)
    language: Lang = "en"


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
def join(body: Join, request: Request) -> dict:
    _limit(request, "join", 30)
    with get_conn() as conn:
        session = state.session_by_code(conn, body.code)
        nickname = clean_nickname(body.nickname)
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
        n_students = conn.execute("SELECT count(*) FROM student WHERE session_id = ?", (session["id"],)).fetchone()[0]
        if n_students >= settings.max_students_per_class:
            raise ApiError(409, "class_full", "This class is full. Ask your teacher to make room.")
        existing = None
        if body.roll_no is not None:
            # a child who joins with their roll number resumes the roster entry the teacher imported
            existing = conn.execute(
                "SELECT id, nickname, language FROM student WHERE session_id = ? AND roll_no = ? AND kind = 'real'",
                (session["id"], body.roll_no),
            ).fetchone()
        if existing:
            with transaction(conn):
                conn.execute("UPDATE student SET language = ? WHERE id = ?", (body.language, existing["id"]))
            return {
                "student_id": existing["id"],
                "session_id": session["id"],
                "nickname": existing["nickname"],
                "language": body.language,
                "resumed": True,
            }
        student_id = new_id("stu")
        with transaction(conn):
            conn.execute(
                "INSERT INTO student (id, session_id, nickname, language, kind, created_at, roll_no) "
                "VALUES (?, ?, ?, ?, 'real', ?, ?)",
                (student_id, session["id"], nickname, body.language, now(), body.roll_no),
            )
            if body.roll_no is None:
                seed.assign_roll_numbers(conn, session["id"])
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
    _limit(request, "answer", 120)
    return await diagnostician.answer(body.student_id, body.question_id, body.answer.strip(), body.phase)


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


@router.post("/agents/diagnostician/page")
async def diagnostician_page(
    request: Request,
    image: UploadFile = File(...),
    student_id: str | None = Form(default=None),
    session_id: str | None = Form(default=None),
    mode: Literal["homework", "snap"] = Form(default="homework"),
    language: Lang | None = Form(default=None),
) -> dict:
    """A whole notebook page: the header names the child (roll number, else nickname), every problem is found and
    judged by exact arithmetic. Homework: the child sends student_id. Snap: the teacher sends session_id and the page
    is filed by its header, or comes back unassigned for one tap."""
    _limit(request, "photo", 60)
    data = await image.read(diagnostician.MAX_IMAGE_BYTES + 1)
    return await pages.page(data, session_id=session_id, student_id=student_id, mode=mode, language=language)


@router.post("/agents/diagnostician/page/file")
def diagnostician_page_file(body: FilePage, request: Request) -> dict:
    """Files readings that came back unassigned under the student the teacher picked (text only, never the photo)."""
    _limit(request, "answer", 120)
    return pages.file_page(body.student_id, body.problems, body.mode)


@router.get("/teacher/digest")
def teacher_digest(session_id: str, hours: int = 24) -> dict:
    return analyst.digest(session_id, hours)


@router.post("/media/speak")
async def media_speak(body: Speak, request: Request) -> dict:
    """Text-to-speech for a lesson or feedback, for children who read slowly. Returns the clip's URL."""
    _limit(request, "speak", 30)
    url = voice.voice_note(body.text, body.language, lambda _tel: None)
    if url is None:
        raise ApiError(503, "no_voice", "Voice is not available on this deployment.")
    return {"audio_url": url}


@router.post("/agents/curator/lesson")
async def curator_lesson(body: StudentRef) -> dict:
    return await curator.lesson(body.student_id)


@router.post("/agents/examiner/retry")
def examiner_retry(body: Retry) -> dict:
    return examiner.retry(body.student_id, [a.model_dump() for a in body.answers])


@router.post("/agents/simulator/run")
def simulator_run(body: Simulate, request: Request, x_admin_token: str | None = Header(default=None)) -> dict:
    _limit(request, "simulate", 3)
    if body.session_id == seed.DEMO_SESSION_ID:
        _check_admin(x_admin_token)  # the judged class stays as seeded; any other class can simulate freely
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
def teacher_approve(body: Approve, request: Request) -> dict:
    _limit(request, "approve", 30)
    return coach.approve(body.recommendation_id)


@router.post("/teacher/review")
def teacher_review(body: Review, request: Request) -> dict:
    """The teacher confirms or corrects a diagnosis. The teacher always has the last word."""
    _limit(request, "review", 60)
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


@router.post("/admin/remove-student")
def admin_remove_student(body: RemoveStudent, x_admin_token: str | None = Header(default=None)) -> dict:
    """Takes a student off the class list and heatmap (an abusive or accidental join during a live class)."""
    _check_admin(x_admin_token)
    with get_conn() as conn, transaction(conn):
        student = state.require_student(conn, body.student_id)
        if student["id"] == seed.ASHA_ID:
            raise ApiError(409, "demo_student", "Asha is the demo student; reset the class instead.")
        for table in ("review", "response", "mastery", "gap"):
            conn.execute(f"DELETE FROM {table} WHERE student_id = ?", (body.student_id,))  # noqa: S608
        conn.execute("DELETE FROM student WHERE id = ?", (body.student_id,))
        log_event(
            conn, student["session_id"], "Teacher", "remove_student", f"Removed {student['nickname']} from the class"
        )
    return {"ok": True}


@router.get("/admin/health")
def admin_health(x_admin_token: str | None = Header(default=None)) -> dict:
    """What the presenter checks before the demo: the API, the providers, the caches and the demo class."""
    _check_admin(x_admin_token)
    with get_conn() as conn:
        llm_cache = conn.execute("SELECT count(*) FROM llm_cache").fetchone()[0]
        lesson_cache = conn.execute("SELECT count(*) FROM lesson_cache").fetchone()[0]
        students = conn.execute(
            "SELECT count(*) FROM student WHERE session_id = ?", (seed.DEMO_SESSION_ID,)
        ).fetchone()[0]
        real = conn.execute(
            "SELECT count(*) FROM student WHERE session_id = ? AND kind = 'real'", (seed.DEMO_SESSION_ID,)
        ).fetchone()[0]
        photo_ms = [
            t["ms"]
            for (tj,) in conn.execute(
                "SELECT telemetry_json FROM agent_event WHERE action = 'diagnose_photo' ORDER BY seq DESC LIMIT 50"
            )
            for t in json.loads(tj or "[]")
            if t.get("ok") and not t.get("cached")
        ]
    return {
        "ok": True,
        "version": settings.version,
        "demo_mode": settings.demo_mode,
        "providers": providers_status(),
        "vision_model": settings.vertex_vision_model,
        "text_model": settings.vertex_model,
        "cache": {"llm": llm_cache, "lessons": lesson_cache},
        "demo_class": {"students": students, "real_joins": real},
        "last_photo_ms": photo_ms[:10],
    }


@router.get("/admin/cache-export")
def admin_cache_export(x_admin_token: str | None = Header(default=None)) -> dict:
    """The LLM cache as rows, so the demo-critical answers can be saved as data/llm_cache_seed.jsonl."""
    _check_admin(x_admin_token)
    with get_conn() as conn:
        items = [
            dict(r)
            for r in conn.execute(
                "SELECT key, agent, provider, model, response_json, created_at FROM llm_cache ORDER BY created_at"
            ).fetchall()
        ]
    return {"rows": items}


@router.post("/admin/warm-lessons")
async def admin_warm(x_admin_token: str | None = Header(default=None)) -> dict:
    """Pre-generates lessons for the most common mistakes; save the result as data/lessons_cache.json."""
    _check_admin(x_admin_token)
    return {"lessons": await curator.warm(curator.DEMO_PAIRS)}
