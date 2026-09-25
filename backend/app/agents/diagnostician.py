"""The Diagnostician: answer key and rules first; the LLM only for unfamiliar typed answers and handwriting."""

import io

from PIL import Image, ImageOps

from .. import rules
from ..db import get_conn, log_event, row, transaction
from ..errors import ApiError
from ..fraction_math import parse_answer
from ..i18n import feedback as feedback_text
from ..llm import prompts
from ..llm.providers import generate
from ..llm.schemas import PhotoDiagnosis, TextDiagnosis
from ..topic import Question, get_topic
from . import state

MAX_IMAGE_BYTES = 12 * 1024 * 1024


def _tag_list() -> str:
    return "\n".join(f"- {t.tag}: {t.definition}" for t in get_topic().tags.values())


def _question_block(q: Question) -> str:
    return (
        f"Question: {q.stem}\nCorrect answer: {q.answer}\nCorrect method: {q.method}\n"
        f"Simplest form required: {'yes' if q.simplest else 'no'}\n\nAllowed misconception tags:\n{_tag_list()}"
    )


async def answer(student_id: str, question_id: str, answer_text: str) -> dict:
    topic = get_topic()
    q = state.require_question(question_id, ("mcq", "text", "photo"))
    with get_conn() as conn:
        student = state.require_student(conn, student_id)
        previous = row(
            conn,
            "SELECT * FROM response WHERE student_id = ? AND question_id = ? AND phase = 'quiz' ORDER BY id DESC",
            (student_id, question_id),
        )
        mastery_now = state.mastery_map(conn, student_id).get(q.concept_id, rules.START_MASTERY)
    language = student["language"]
    if previous:  # a double tap or a retried request: return the first result instead of counting twice
        tag = previous["tag"]
        label = topic.tag(tag).label(language) if tag else None
        return {
            "correct": bool(previous["correct"]),
            "misconception_tag": tag,
            "label": label,
            "label_en": topic.tag(tag).label() if tag else None,
            "feedback": feedback_text(language, bool(previous["correct"]), tag, label, q.answer),
            "correct_answer": q.answer,
            "source": previous["source"],
            "confidence": previous["confidence"],
            "concept_id": q.concept_id,
            "mastery_before": mastery_now,
            "mastery_after": mastery_now,
            "gap_opened": False,
            "telemetry": [],
        }
    telemetry: list[dict] = []
    llm_feedback = None

    if q.kind == "mcq":
        diagnosis = rules.diagnose_mcq(q, answer_text)
        if diagnosis is None:
            raise ApiError(422, "not_an_option", "That answer isn't one of the options.")
        correct, tag, source, confidence = diagnosis.correct, diagnosis.tag, diagnosis.source, diagnosis.confidence
    else:
        diagnosis = rules.diagnose_typed(q, answer_text)
        if diagnosis is not None:
            correct, tag, source, confidence = diagnosis.correct, diagnosis.tag, diagnosis.source, diagnosis.confidence
        else:
            # the rules can't place this answer, so ask the LLM for the most likely misconception
            prompt = (
                f"{_question_block(q)}\n\nStudent's typed answer: {answer_text}\n"
                f"Write feedback_student in {prompts.LANGUAGE_NAMES.get(language, 'English')}."
            )
            result, telemetry = await generate(
                "Diagnostician", "diagnose", prompts.DIAGNOSE_TEXT, prompt, TextDiagnosis
            )
            correct = False  # the rules already checked the value; a different value is never correct
            if result:
                tag, confidence = rules.validate_llm_tag(topic, result.misconception_tag, result.confidence)
                source, llm_feedback = "llm", result.feedback_student
            else:
                tag, confidence, source = "unclassified", 0.0, "template"

    label = topic.tag(tag).label(language) if tag else None
    with get_conn() as conn, transaction(conn):
        outcome = state.record_response(
            conn,
            student_id,
            q,
            answer=answer_text,
            correct=correct,
            tag=tag,
            source=source,
            confidence=confidence,
            phase="quiz",
        )
        if student["kind"] != "simulated":
            verdict = "correct" if correct else f"{tag} ({topic.tag(tag).label()})"
            gap_note = "; gap opened" if outcome["gap_opened"] else ""
            log_event(
                conn,
                student["session_id"],
                "Diagnostician",
                "diagnose",
                f"{student['nickname']} · {q.id} '{answer_text}': {verdict} [{source}]{gap_note}",
                student_id,
                telemetry,
            )
    return {
        "correct": correct,
        "misconception_tag": tag,
        "label": label,
        "label_en": topic.tag(tag).label() if tag else None,
        "feedback": llm_feedback or feedback_text(language, correct, tag, label, q.answer),
        "correct_answer": q.answer,
        "source": source,
        "confidence": confidence,
        "concept_id": q.concept_id,
        **outcome,
        "telemetry": telemetry,
    }


def prepare_image(data: bytes) -> bytes:
    if not data:
        raise ApiError(422, "empty_image", "The photo was empty. Try again.")
    if len(data) > MAX_IMAGE_BYTES:
        raise ApiError(413, "image_too_large", "That photo is too large. Try a photo under 12 MB.")
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img).convert("RGB")
    except Exception as exc:
        raise ApiError(422, "not_an_image", "That file isn't a photo we can read.") from exc
    img.thumbnail((1280, 1280))
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=85)
    return out.getvalue()


def _known_wrong_tag(q: Question, final_answer: str | None) -> str | None:
    parsed = parse_answer(final_answer)
    if not parsed:
        return None
    for wrong, tag in q.wrong_answers.items():
        known = parse_answer(wrong)
        if known and known.value == parsed.value:
            return tag
    return None


async def photo(student_id: str, question_id: str, image: bytes) -> dict:
    topic = get_topic()
    q = state.require_question(question_id, ("photo", "text", "mcq"))
    with get_conn() as conn:
        student = state.require_student(conn, student_id)
    jpeg = prepare_image(image)
    prompt = f"{_question_block(q)}\n\nThe photo shows this student's working for the question above."
    result, telemetry = await generate(
        "Diagnostician",
        "diagnose_photo",
        prompts.DIAGNOSE_PHOTO,
        prompt,
        PhotoDiagnosis,
        image=jpeg,
        route=("vertex", "nebius"),
        validate=lambda r: len([s for s in r.steps if s.strip()]) > 0,
    )
    base = {"student_id": student_id, "question_id": q.id, "concept_id": q.concept_id, "telemetry": telemetry}
    if result is None:
        with get_conn() as conn, transaction(conn):
            log_event(
                conn,
                student["session_id"],
                "Diagnostician",
                "diagnose_photo",
                f"{student['nickname']} · {q.id}: couldn't read the photo; asked for a typed answer",
                student_id,
                telemetry,
            )
        return {
            **base,
            "steps": [],
            "final_answer_read": None,
            "correct": False,
            "error_step": None,
            "misconception_tag": None,
            "label": None,
            "confidence": 0.0,
            "feedback": "I couldn't read this clearly. Please type the final answer.",
            "source": "vision",
            "needs_typed_answer": True,
            "mastery_after": None,
            "gap_opened": False,
        }

    steps = [s.strip() for s in result.steps if s.strip()][:12]
    tag, confidence = rules.validate_llm_tag(topic, result.misconception_tag, result.confidence)
    correct, source = result.correct, "vision"
    # rules check the model: the final answer's exact value decides right or wrong
    final = parse_answer(result.final_answer_read)
    expected = parse_answer(q.answer)
    if final and expected and (final.value == expected.value) != correct:
        correct, source = final.value == expected.value, "vision+rule"
    if not correct:
        known = _known_wrong_tag(q, result.final_answer_read)
        if known and tag == "unclassified":
            tag, confidence, source = known, max(confidence, 0.7), "vision+rule"
    error_step = result.error_step if not correct else None
    if error_step is not None and not 1 <= error_step <= len(steps):
        error_step = None
    if correct:
        tag = None
    needs_typed = not correct and tag == "unclassified"

    outcome = {"mastery_after": None, "gap_opened": False}
    with get_conn() as conn, transaction(conn):
        if not needs_typed:
            outcome = state.record_response(
                conn,
                student_id,
                q,
                answer=result.final_answer_read or "",
                correct=correct,
                tag=tag,
                source=source,
                confidence=confidence,
                phase="photo",
                error_step=error_step,
            )
        if correct:
            what = "all steps right"
        elif error_step:
            what = f"step {error_step} '{steps[error_step - 1]}': {topic.tag(tag).label()}"
        else:
            what = topic.tag(tag).label()
        log_event(
            conn,
            student["session_id"],
            "Diagnostician",
            "diagnose_photo",
            f"{student['nickname']} · {q.id}: {what} ({confidence:.2f}, {source})",
            student_id,
            telemetry,
        )
    return {
        **base,
        "steps": steps,
        "final_answer_read": result.final_answer_read,
        "correct": correct,
        "error_step": error_step,
        "misconception_tag": tag,
        "label": topic.tag(tag).label() if tag else None,
        "confidence": confidence,
        "feedback": result.feedback_student,
        "source": source,
        "needs_typed_answer": needs_typed,
        "mastery_after": outcome["mastery_after"],
        "gap_opened": outcome["gap_opened"],
    }
