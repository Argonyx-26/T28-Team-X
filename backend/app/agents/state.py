"""Reads and writes shared by every agent. Write helpers must run inside db.transaction()."""

import sqlite3
from collections import Counter

from .. import rules
from ..db import now, row, rows
from ..errors import ApiError
from ..topic import CONCEPTUAL_EXCLUDED, Question, get_topic


def require_student(conn: sqlite3.Connection, student_id: str) -> dict:
    student = row(conn, "SELECT * FROM student WHERE id = ?", (student_id,))
    if not student:
        raise ApiError(404, "student_not_found", "That student doesn't exist. Join the class again.")
    return student


def require_session(conn: sqlite3.Connection, session_id: str) -> dict:
    session = row(conn, "SELECT * FROM session WHERE id = ?", (session_id,))
    if not session:
        raise ApiError(404, "session_not_found", "That class doesn't exist.")
    return session


def session_by_code(conn: sqlite3.Connection, code: str) -> dict:
    session = row(conn, "SELECT * FROM session WHERE upper(code) = upper(?)", (code.strip(),))
    if not session:
        raise ApiError(404, "class_not_found", "No class has that code. Ask your teacher for the class code.")
    return session


def require_question(question_id: str, kinds: tuple[str, ...]) -> Question:
    q = get_topic().question(question_id)
    if not q or q.kind not in kinds:
        raise ApiError(404, "question_not_found", f"Question {question_id} isn't available here.")
    return q


def mastery_map(conn: sqlite3.Connection, student_id: str) -> dict[str, float]:
    return {
        r["concept_id"]: r["value"]
        for r in rows(conn, "SELECT concept_id, value FROM mastery WHERE student_id = ?", (student_id,))
    }


def seen_questions(conn: sqlite3.Connection, student_id: str) -> set[str]:
    return {
        r["question_id"] for r in rows(conn, "SELECT question_id FROM response WHERE student_id = ?", (student_id,))
    }


def asked_counts(conn: sqlite3.Connection, student_id: str, phase: str = "quiz") -> dict[str, int]:
    out = rows(
        conn,
        "SELECT concept_id, count(*) AS n FROM response WHERE student_id = ? AND phase = ? GROUP BY concept_id",
        (student_id, phase),
    )
    return {r["concept_id"]: r["n"] for r in out}


def quiz_count(conn: sqlite3.Connection, student_id: str) -> int:
    return conn.execute(
        "SELECT count(*) FROM response WHERE student_id = ? AND phase = 'quiz'", (student_id,)
    ).fetchone()[0]


def _main_tag(conn: sqlite3.Connection, student_id: str, concept_id: str, fallback: str | None) -> str | None:
    tags = [
        r["tag"]
        for r in rows(
            conn,
            "SELECT tag FROM response WHERE student_id = ? AND concept_id = ? AND correct = 0 AND tag IS NOT NULL",
            (student_id, concept_id),
        )
    ]
    conceptual = [t for t in tags if t not in CONCEPTUAL_EXCLUDED]
    counted = Counter(conceptual or tags)
    return counted.most_common(1)[0][0] if counted else fallback


def record_response(
    conn: sqlite3.Connection,
    student_id: str,
    question: Question,
    *,
    answer: str,
    correct: bool,
    tag: str | None,
    source: str,
    confidence: float,
    phase: str,
    error_step: int | None = None,
    update_mastery: bool = True,
) -> dict:
    mastery = mastery_map(conn, student_id)
    before = mastery.get(question.concept_id, rules.START_MASTERY)
    after = rules.update_mastery(before, correct) if update_mastery else before
    conn.execute(
        "INSERT OR REPLACE INTO mastery (student_id, concept_id, value) VALUES (?, ?, ?)",
        (student_id, question.concept_id, after),
    )
    conn.execute(
        "INSERT INTO response (student_id, question_id, concept_id, answer, correct, tag, source, confidence, "
        "error_step, phase, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            student_id,
            question.id,
            question.concept_id,
            answer,
            int(correct),
            tag,
            source,
            confidence,
            error_step,
            phase,
            now(),
        ),
    )
    gap_opened = False
    existing = row(
        conn, "SELECT status FROM gap WHERE student_id = ? AND concept_id = ?", (student_id, question.concept_id)
    )
    if existing and existing["status"] == "open":
        conn.execute(
            "UPDATE gap SET tag = ? WHERE student_id = ? AND concept_id = ?",
            (_main_tag(conn, student_id, question.concept_id, tag), student_id, question.concept_id),
        )
    elif rules.opens_gap(correct, tag, after):
        conn.execute(
            "INSERT OR REPLACE INTO gap (student_id, concept_id, status, tag, opened_at, closed_at) "
            "VALUES (?, ?, 'open', ?, ?, NULL)",
            (student_id, question.concept_id, _main_tag(conn, student_id, question.concept_id, tag), now()),
        )
        gap_opened = True
    return {"mastery_before": before, "mastery_after": after, "gap_opened": gap_opened}


def top_open_gap(conn: sqlite3.Connection, student_id: str) -> dict | None:
    """The open gap with the lowest mastery."""
    return row(
        conn,
        "SELECT g.concept_id, g.tag, coalesce(m.value, 0.5) AS mastery FROM gap g "
        "LEFT JOIN mastery m ON m.student_id = g.student_id AND m.concept_id = g.concept_id "
        "WHERE g.student_id = ? AND g.status = 'open' ORDER BY mastery ASC, g.opened_at ASC LIMIT 1",
        (student_id,),
    )


def close_gap(conn: sqlite3.Connection, student_id: str, concept_id: str) -> float:
    value = mastery_map(conn, student_id).get(concept_id, rules.START_MASTERY)
    value = rules.closed_mastery(value)
    conn.execute(
        "INSERT OR REPLACE INTO mastery (student_id, concept_id, value) VALUES (?, ?, ?)",
        (student_id, concept_id, value),
    )
    conn.execute(
        "UPDATE gap SET status = 'closed', closed_at = ? WHERE student_id = ? AND concept_id = ?",
        (now(), student_id, concept_id),
    )
    return value


def class_state(conn: sqlite3.Connection, session_id: str):
    students = rows(
        conn,
        "SELECT id, nickname, language, kind FROM student WHERE session_id = ? "
        "ORDER BY kind = 'simulated', created_at, nickname",
        (session_id,),
    )
    ids = [s["id"] for s in students]
    mastery: dict[str, dict[str, float]] = {s: {} for s in ids}
    for r in rows(
        conn,
        "SELECT m.student_id, m.concept_id, m.value FROM mastery m JOIN student s ON s.id = m.student_id "
        "WHERE s.session_id = ?",
        (session_id,),
    ):
        mastery[r["student_id"]][r["concept_id"]] = r["value"]
    responses = rows(
        conn,
        "SELECT r.student_id, r.concept_id, r.correct, r.tag, r.phase FROM response r "
        "JOIN student s ON s.id = r.student_id WHERE s.session_id = ?",
        (session_id,),
    )
    gaps = rows(
        conn,
        "SELECT g.student_id, g.concept_id, g.status, g.tag FROM gap g JOIN student s ON s.id = g.student_id "
        "WHERE s.session_id = ?",
        (session_id,),
    )
    return students, mastery, responses, gaps


def analyse_class(conn: sqlite3.Connection, session_id: str):
    students, mastery, responses, gaps = class_state(conn, session_id)
    analysis = rules.aggregate(get_topic(), [s["id"] for s in students], mastery, responses, gaps)
    return students, mastery, responses, gaps, analysis
