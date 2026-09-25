"""The teacher has the last word: confirm or correct any diagnosis in one tap. Every review is kept, so we can
report how often teachers agree with the AI, and corrections become teacher-verified data."""

from .. import rules
from ..db import get_conn, log_event, now, row, rows, transaction
from ..errors import ApiError
from ..topic import get_topic
from . import state

VERDICTS = {"agree", "change_tag", "change_step", "mark_correct"}


def _replay_mastery(conn, student_id: str, concept_id: str) -> float:
    """Mastery on one concept, recomputed from every graded answer in order (after a correction)."""
    value = rules.START_MASTERY
    for r in rows(
        conn,
        "SELECT correct FROM response WHERE student_id = ? AND concept_id = ? ORDER BY id",
        (student_id, concept_id),
    ):
        value = rules.update_mastery(value, bool(r["correct"]))
    gap = row(conn, "SELECT status FROM gap WHERE student_id = ? AND concept_id = ?", (student_id, concept_id))
    if gap and gap["status"] == "closed":
        value = rules.closed_mastery(value)
    conn.execute(
        "INSERT OR REPLACE INTO mastery (student_id, concept_id, value) VALUES (?, ?, ?)",
        (student_id, concept_id, value),
    )
    return value


def review(student_id: str, question_id: str, verdict: str, tag: str | None = None, step: int | None = None) -> dict:
    topic = get_topic()
    if verdict not in VERDICTS:
        raise ApiError(422, "bad_verdict", "Choose agree, change_tag, change_step or mark_correct.")
    if verdict == "change_tag" and tag not in topic.tags:
        raise ApiError(422, "bad_tag", "Pick one of the listed mistakes.")
    with get_conn() as conn, transaction(conn):
        student = state.require_student(conn, student_id)
        resp = row(
            conn,
            "SELECT * FROM response WHERE student_id = ? AND question_id = ? ORDER BY id DESC LIMIT 1",
            (student_id, question_id),
        )
        if not resp:
            raise ApiError(404, "nothing_to_review", "There is no diagnosis for this student and question yet.")
        concept = topic.concept(resp["concept_id"])
        new_tag, new_correct, new_step = resp["tag"], bool(resp["correct"]), resp["error_step"]
        if verdict == "change_tag":
            new_tag, new_correct = tag, False
        elif verdict == "change_step":
            new_step = step
        elif verdict == "mark_correct":
            new_tag, new_correct, new_step = None, True, None
        conn.execute(
            "UPDATE response SET tag = ?, correct = ?, error_step = ?, source = ? WHERE id = ?",
            (new_tag, int(new_correct), new_step, "teacher" if verdict != "agree" else resp["source"], resp["id"]),
        )
        conn.execute(
            "INSERT INTO review (response_id, student_id, question_id, verdict, ai_tag, teacher_tag, ai_step, "
            "teacher_step, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (resp["id"], student_id, question_id, verdict, resp["tag"], new_tag, resp["error_step"], new_step, now()),
        )
        mastery_after = state.mastery_map(conn, student_id).get(resp["concept_id"], rules.START_MASTERY)
        if verdict in ("change_tag", "mark_correct"):
            mastery_after = _replay_mastery(conn, student_id, resp["concept_id"])
            gap = row(
                conn, "SELECT status FROM gap WHERE student_id = ? AND concept_id = ?", (student_id, resp["concept_id"])
            )
            if gap and gap["status"] == "open":
                if mastery_after >= rules.GAP_BELOW:
                    conn.execute(
                        "DELETE FROM gap WHERE student_id = ? AND concept_id = ?", (student_id, resp["concept_id"])
                    )
                else:
                    conn.execute(
                        "UPDATE gap SET tag = ? WHERE student_id = ? AND concept_id = ?",
                        (new_tag, student_id, resp["concept_id"]),
                    )
            elif not new_correct and rules.opens_gap(False, new_tag, mastery_after):
                conn.execute(
                    "INSERT OR REPLACE INTO gap (student_id, concept_id, status, tag, opened_at, closed_at) "
                    "VALUES (?, ?, 'open', ?, ?, NULL)",
                    (student_id, resp["concept_id"], new_tag, now()),
                )
        if verdict == "agree":
            what = "confirmed the AI's diagnosis"
        elif verdict == "mark_correct":
            what = "marked the work right (the AI had it wrong)"
        elif verdict == "change_step":
            what = f"moved the wrong step from {resp['error_step']} to {new_step}"
        else:
            what = f"changed the mistake to '{topic.tag(new_tag).label()}'"
        log_event(
            conn,
            student["session_id"],
            "Teacher",
            "review",
            f"{student['nickname']} · {question_id} on {concept.short}: {what}",
            student_id,
        )
    return {
        "ok": True,
        "correct": new_correct,
        "misconception_tag": new_tag,
        "error_step": new_step,
        "mastery_after": mastery_after,
    }


def agreement() -> dict | None:
    """How often teachers kept the AI's photo diagnosis unchanged."""
    with get_conn() as conn:
        r = conn.execute(
            "SELECT count(*), sum(verdict = 'agree') FROM review v JOIN response p ON p.id = v.response_id "
            "WHERE p.phase = 'photo'"
        ).fetchone()
    total, agreed = r[0], r[1] or 0
    return {"agreed": agreed, "total": total} if total else None
