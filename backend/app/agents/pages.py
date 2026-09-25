"""Reading a whole notebook page: the header (roll number, or a nickname as a fallback) and every problem on it.

Used by homework check (F3: the child or a parent photographs the page) and snap mode (F2: the teacher flips pages
under a phone). One vision call per page transcribes; the exact step verifier judges every problem. The photo stays
in memory and is discarded; only the readings are kept, filed under the child the header names.
"""

from __future__ import annotations

import re
from fractions import Fraction

from .. import verifier
from ..db import get_conn, log_event, transaction
from ..errors import ApiError
from ..i18n import feedback as feedback_text
from ..llm import prompts
from ..llm.providers import generate_hedged
from ..llm.schemas import PageRead, PhotoDiagnosis
from ..topic import Question, get_topic
from . import diagnostician, state

MAX_PROBLEMS = 6
_FRACTION = re.compile(r"(\d+)\s*/\s*(\d+)")


def _fractions(text: str) -> set[Fraction]:
    return {Fraction(int(a), int(b)) for a, b in _FRACTION.findall(text) if int(b)}


_INTEGER = re.compile(r"(?<![\d/])\b(\d+)\b(?!\s*/\s*\d)")


def _numbers(text: str) -> set[Fraction]:
    """Every number in a sentence: its fractions, plus the whole numbers that aren't part of one."""
    return _fractions(text) | {Fraction(int(n)) for n in _INTEGER.findall(text)}


def match_bank(first_line: str) -> Question | None:
    """A problem on the page that is one of the bank's photo problems: the same fractions exactly, or, for a word
    problem written out in words, the same numbers (the cake problem: 3/4 and 2). A bare sum like "2 + 3/4" is never
    matched to a story by its numbers alone."""
    seen = _fractions(first_line)
    photo = [q for q in get_topic().questions if q.kind == "photo"]
    if len(seen) >= 2:
        return next((q for q in photo if _fractions(q.stem) == seen), None)
    words = len(re.findall(r"[A-Za-z]{3,}", first_line))
    if words >= 3:
        numbers = _numbers(first_line)
        if len(numbers) >= 2:
            return next((q for q in photo if _numbers(q.stem) == numbers), None)
    return None


def diagnose_problem(lines: list[str], tag: str | None, error_step: int | None) -> dict:
    """One problem's working, judged by the verifier; the model's tag and step are its second opinion."""
    lines = [x.strip() for x in lines if x and x.strip()][:12]
    if not lines:
        raise ApiError(422, "empty_problem", "No working to read.")
    bank = match_bank(lines[0])
    q = bank or diagnostician._PLACEHOLDER
    guess = PhotoDiagnosis(
        steps=lines,
        final_answer_read=lines[-1].split("=")[-1].strip() if lines else None,
        correct=error_step in (None, 0),
        error_step=error_step or None,
        misconception_tag=tag or "unclassified",
        confidence=0.6 if tag else 0.3,
        feedback_student="",
    )
    out = diagnostician.combine(q, guess, lines)
    if bank is None:
        first = verifier.parse_expression(out.get("problem") or lines[0])
        problem = None
        if first is not None:
            try:
                problem = verifier.problem_from_node(first, first.value())
            except ZeroDivisionError:
                problem = None
        q = Question(
            id=diagnostician.AUTO,
            concept_id=verifier.guess_concept(problem),
            kind="photo",
            stem=out.get("problem") or lines[0],
            answer=(out.get("verifier") or {}).get("reference") or "",
            method="",
        )
    out.update({"question_id": q.id, "concept_id": q.concept_id, "problem": q.stem, "answer": q.answer})
    return out


async def read_page(jpeg: bytes, *, use_cache: bool = True) -> tuple[PageRead | None, list[dict]]:
    tags = "\n".join(f"- {t.tag}: {t.definition}" for t in get_topic().tags.values())
    prompt = f"Allowed misconception tags:\n{tags}\n\nThe photo shows one page of a student's fractions homework."
    result, telemetry = await generate_hedged(
        "Diagnostician",
        "read_page",
        prompts.READ_PAGE,
        prompt,
        PageRead,
        primary=("vertex",),
        backup=("vertex_alt", "nebius"),
        hedge_after=diagnostician.settings.hedge_after_s,
        image=jpeg,
        use_cache=use_cache,
        validate=lambda r: any(p.strip() for p in r.problems),
    )
    return result, telemetry


def _find_student(conn, session_id: str, roll_no: int | None, name: str | None) -> tuple[dict | None, str | None]:
    if roll_no is not None:
        s = state.row(conn, "SELECT * FROM student WHERE session_id = ? AND roll_no = ?", (session_id, roll_no))
        if s:
            return s, "roll"
    if name and name.strip():
        s = state.row(
            conn,
            "SELECT * FROM student WHERE session_id = ? AND lower(nickname) = lower(?)",
            (session_id, name.strip()),
        )
        if s:
            return s, "nickname"
    return None, None


def _localize(problem: dict, language: str) -> dict:
    topic = get_topic()
    tag = problem.get("misconception_tag")
    label = topic.tag(tag).label(language) if tag else None
    return {
        **problem,
        "label_local": label,
        "feedback_local": feedback_text(language, bool(problem["correct"]), tag, label, problem.get("answer") or ""),
    }


def file_problems(conn, student: dict, problems: list[dict], mode: str) -> dict:
    """Saves each problem's reading for the student and logs one feed event for the page. Inside a transaction."""
    topic = get_topic()
    gaps_opened = 0
    wrong = 0
    for p in problems:
        if p.get("needs_typed_answer"):
            continue
        q = topic.question(p["question_id"]) or Question(
            id=diagnostician.AUTO,
            concept_id=p["concept_id"],
            kind="photo",
            stem=p["problem"],
            answer=p.get("answer") or "",
            method="",
        )
        outcome = state.record_response(
            conn,
            student["id"],
            q,
            answer=p.get("final_answer_read") or "",
            correct=bool(p["correct"]),
            tag=p.get("misconception_tag"),
            source=p.get("source", "vision+rule"),
            confidence=float(p.get("confidence") or 0),
            phase=mode,
            error_step=p.get("error_step"),
            stem=q.stem if q.id == diagnostician.AUTO else None,
        )
        gaps_opened += int(outcome["gap_opened"])
        wrong += int(not p["correct"])
    who = f"{student['nickname']}" + (f" (roll {student['roll_no']})" if student.get("roll_no") else "")
    n = len(problems)
    label = "Homework" if mode == "homework" else "Snap"
    log_event(
        conn,
        student["session_id"],
        "Diagnostician",
        f"{mode}_page",
        f"{label} · {who} · {n} problem{'s' if n != 1 else ''} · {wrong} wrong"
        + (f" · {gaps_opened} new gap{'s' if gaps_opened != 1 else ''}" if gaps_opened else ""),
        student["id"],
    )
    return {"saved": n, "wrong": wrong, "gaps_opened": gaps_opened}


async def page(
    image: bytes, *, session_id: str | None, student_id: str | None, mode: str, language: str | None = None
) -> dict:
    """Reads one page. With a student_id (homework), it files under that child; without one (snap), it files under
    the child the roll number or nickname on the page names, or returns the readings unassigned."""
    with get_conn() as conn:
        given = state.require_student(conn, student_id) if student_id else None
        sid = given["session_id"] if given else session_id
        if not sid:
            raise ApiError(422, "no_class", "Send a student_id or a session_id.")
        state.require_session(conn, sid)
    result, telemetry = await read_page(diagnostician.prepare_image(image))
    base = {"session_id": sid, "mode": mode, "telemetry": telemetry}
    if result is None:
        return {
            **base,
            "student_id": given["id"] if given else None,
            "matched_by": "given" if given else None,
            "roll_no": None,
            "name_on_page": None,
            "problems": [],
            "saved": False,
            "unreadable": True,
        }
    raw_problems = [p for p in result.problems if p and p.strip()][:MAX_PROBLEMS]
    tags = list(result.tags or [])
    steps = list(result.error_steps or [])
    problems = []
    for i, text in enumerate(raw_problems):
        lines = [x for x in re.split(r"\s*\|\s*", text) if x.strip()]
        tag = tags[i] if i < len(tags) and tags[i] else None
        step = steps[i] if i < len(steps) and steps[i] else None
        try:
            problems.append(diagnose_problem(lines, tag, step))
        except ApiError:
            continue
    with get_conn() as conn:
        student, matched_by = (
            (given, "given") if given else _find_student(conn, sid, result.roll_no, result.name_on_page)
        )
        lang = language or (student["language"] if student else "en")
        problems = [_localize(p, lang) for p in problems]
        filed = None
        if student is not None and problems:
            with transaction(conn):
                filed = file_problems(conn, student, problems, mode)
    return {
        **base,
        "student_id": student["id"] if student else None,
        "student_nickname": student["nickname"] if student else None,
        "matched_by": matched_by,
        "roll_no": result.roll_no,
        "name_on_page": result.name_on_page,
        "problems": problems,
        "saved": filed is not None,
        "summary": filed,
        "unreadable": False,
    }


def file_page(student_id: str, problems: list[dict], mode: str) -> dict:
    """Files readings the client got back unassigned (snap mode: the teacher picks the child with one tap)."""
    with get_conn() as conn:
        student = state.require_student(conn, student_id)
        clean = []
        for p in problems[:MAX_PROBLEMS]:
            lines = [str(x) for x in (p.get("steps") or []) if str(x).strip()]
            if not lines:
                continue
            clean.append(diagnose_problem(lines, p.get("misconception_tag"), p.get("error_step")))
        clean = [_localize(p, student["language"]) for p in clean]
        with transaction(conn):
            filed = file_problems(conn, student, clean, mode) if clean else {"saved": 0, "wrong": 0, "gaps_opened": 0}
    return {"student_id": student["id"], "student_nickname": student["nickname"], "problems": clean, "summary": filed}
