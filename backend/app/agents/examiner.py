"""The Examiner: picks the next question by rules and grades retries exactly."""

from .. import rules
from ..config import settings
from ..db import get_conn, log_event, transaction
from ..errors import ApiError
from ..topic import get_topic
from . import state


def question_out(question, student_id: str, language: str = "en") -> dict:
    topic = get_topic()
    return {
        "id": question.id,
        "kind": question.kind,
        "stem": question.stem,
        "options": rules.shuffled_options(question, student_id) if question.kind == "mcq" else None,
        "concept_id": question.concept_id,
        "concept_name": topic.concept(question.concept_id).name_in(language),
    }


def next_question(student_id: str) -> dict:
    topic = get_topic()
    with get_conn() as conn:
        student = state.require_student(conn, student_id)
        done_count = state.quiz_count(conn, student_id)
        total = settings.quiz_length
        if done_count >= total:
            return {"done": True, "index": done_count, "total": total, "question": None, "reason": "Quiz complete."}
        picked = rules.pick_next(
            topic,
            state.mastery_map(conn, student_id),
            state.asked_counts(conn, student_id),
            state.seen_questions(conn, student_id),
        )
        if not picked:
            return {
                "done": True,
                "index": done_count,
                "total": total,
                "question": None,
                "reason": "No more questions in the bank for this student.",
            }
        question, reason = picked
        if student["kind"] != "simulated":
            with transaction(conn):
                log_event(
                    conn,
                    student["session_id"],
                    "Examiner",
                    "select_question",
                    f"{student['nickname']}: {question.id} · {reason}",
                    student_id,
                )
        return {
            "done": False,
            "index": done_count + 1,
            "total": total,
            "question": question_out(question, student_id, student["language"]),
            "reason": reason,
        }


def retry(student_id: str, answers: list[dict]) -> dict:
    topic = get_topic()
    if not answers:
        raise ApiError(422, "no_answers", "Send the answers to both retry questions.")
    questions = [state.require_question(a["question_id"], ("mcq", "text")) for a in answers]
    concept_ids = {q.concept_id for q in questions}
    if len(concept_ids) != 1:
        raise ApiError(422, "mixed_concepts", "Retry questions must all be on the same concept.")
    concept_id = concept_ids.pop()
    with get_conn() as conn:
        student = state.require_student(conn, student_id)
        results = []
        with transaction(conn):
            for q, a in zip(questions, answers, strict=True):
                ok = rules.grade_exact(q, a["answer"])
                diagnosis = (
                    rules.diagnose_mcq(q, a["answer"]) if q.kind == "mcq" else rules.diagnose_typed(q, a["answer"])
                )
                tag = None if ok else (diagnosis.tag if diagnosis else "unclassified")
                state.record_response(
                    conn,
                    student_id,
                    q,
                    answer=a["answer"],
                    correct=ok,
                    tag=tag,
                    source="rule",
                    confidence=1.0,
                    phase="retry",
                )
                results.append({"question_id": q.id, "correct": ok, "correct_answer": q.answer})
            all_right = len(results) >= 2 and all(r["correct"] for r in results)
            has_gap = (
                conn.execute(
                    "SELECT 1 FROM gap WHERE student_id = ? AND concept_id = ? AND status = 'open'",
                    (student_id, concept_id),
                ).fetchone()
                is not None
            )
            concept = topic.concept(concept_id)
            right = sum(r["correct"] for r in results)
            log_event(
                conn,
                student["session_id"],
                "Examiner",
                "retry",
                f"{student['nickname']}: {right} of {len(results)} retry items right on {concept.short}",
                student_id,
            )
            if all_right and has_gap:
                mastery_after = state.close_gap(conn, student_id, concept_id)
                log_event(
                    conn,
                    student["session_id"],
                    "Examiner",
                    "gap_closed",
                    f"{student['nickname']} closed the gap on {concept.name} (both retries right)",
                    student_id,
                )
                gap_closed = True
            else:
                mastery_after = state.mastery_map(conn, student_id).get(concept_id, rules.START_MASTERY)
                gap_closed = False
    return {"gap_closed": gap_closed, "concept_id": concept_id, "mastery_after": mastery_after, "results": results}
