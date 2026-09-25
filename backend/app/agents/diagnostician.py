"""The Diagnostician: answer key and rules first; the LLM only for unfamiliar typed answers and handwriting."""

import io
import re
from fractions import Fraction

from PIL import Image, ImageOps

from .. import rules, verifier
from ..config import settings
from ..db import get_conn, log_event, row, transaction
from ..errors import ApiError
from ..fraction_math import parse_answer
from ..i18n import feedback as feedback_text
from ..llm import prompts
from ..llm.providers import generate, generate_hedged
from ..llm.schemas import PhotoDiagnosis, TextDiagnosis
from ..topic import Question, get_topic
from . import state

MAX_IMAGE_BYTES = 12 * 1024 * 1024
# "AUTO": a problem outside the bank; the problem is whatever the student wrote first, and arithmetic judges it
AUTO = "AUTO"
_PLACEHOLDER = Question(id=AUTO, concept_id="C4", kind="photo", stem="Any fraction problem", answer="", method="")


def question_for(question_id: str) -> Question:
    if question_id.upper() == AUTO:
        return _PLACEHOLDER
    return state.require_question(question_id, ("photo", "text", "mcq"))


# the model reproduces each wrong procedure before choosing a tag; a small thinking budget makes that reliable
TEXT_THINKING = 1024


def _tag_list() -> str:
    return "\n".join(f"- {t.tag}: {t.definition}" for t in get_topic().tags.values())


def _question_block(q: Question) -> str:
    return (
        f"Question: {q.stem}\nCorrect answer: {q.answer}\nCorrect method: {q.method}\n"
        f"Simplest form required: {'yes' if q.simplest else 'no'}\n\nAllowed misconception tags:\n{_tag_list()}"
    )


async def answer(student_id: str, question_id: str, answer_text: str, phase: str = "quiz") -> dict:
    """phase "quiz" is the student's own quiz; "photo" is the teacher typing the final answer from an unreadable page,
    which must not shorten the student's quiz."""
    topic = get_topic()
    q = state.require_question(question_id, ("mcq", "text", "photo"))
    with get_conn() as conn:
        student = state.require_student(conn, student_id)
        previous = row(
            conn,
            "SELECT * FROM response WHERE student_id = ? AND question_id = ? AND phase = ? ORDER BY id DESC",
            (student_id, question_id, phase),
        )
        mastery_now = state.mastery_map(conn, student_id).get(q.concept_id, rules.START_MASTERY)
        gap_open_before = state.has_open_gap(conn, student_id, q.concept_id)
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
            "gap_open": gap_open_before,
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
                "Diagnostician", "diagnose", prompts.DIAGNOSE_TEXT, prompt, TextDiagnosis, thinking=TEXT_THINKING
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
            phase=phase,
        )
        if student["kind"] != "simulated":
            verdict = "correct" if correct else f"{tag} ({topic.tag(tag).label()})"
            gap_note = "; gap opened" if outcome["gap_opened"] else ""
            log_event(
                conn,
                student["session_id"],
                "Diagnostician",
                "diagnose",
                f"{student['nickname']} · {q.id} '{answer_text}'"
                f"{' (typed by the teacher)' if phase == 'photo' else ''}: {verdict} [{source}]{gap_note}",
                student_id,
                telemetry,
            )
    with get_conn() as conn:
        gap_open = state.has_open_gap(conn, student_id, q.concept_id)
    return {
        "correct": correct,
        "misconception_tag": tag,
        "label": label,
        "label_en": topic.tag(tag).label() if tag else None,
        "gap_open": gap_open,
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


_FRACTION = re.compile(r"(\d+)\s*/\s*(\d+)")


def _fractions(text: str) -> set[Fraction]:
    return {Fraction(int(a), int(b)) for a, b in _FRACTION.findall(text) if int(b)}


def looks_like_other_problem(q: Question, steps: list[str]) -> Question | None:
    """The teacher picked one problem but photographed another. Compares the fractions in the first line of working
    with each photo problem's; only a clear match to a different problem counts (exact arithmetic, no AI)."""
    seen = _fractions(steps[0]) if steps else set()
    if len(seen) < 2:
        return None

    def score(other: Question) -> int:
        stem = _fractions(other.stem)
        return len(stem & seen) - len(seen - stem)

    others = [x for x in get_topic().questions if x.kind == "photo" and x.id != q.id]
    best = max(others, key=score, default=None)
    if best is not None and score(best) >= 2 and score(best) > score(q):
        return best
    return None


def _known_wrong_tag(q: Question, final_answer: str | None) -> str | None:
    parsed = parse_answer(final_answer)
    if not parsed:
        return None
    for wrong, tag in q.wrong_answers.items():
        known = parse_answer(wrong)
        if known and known.value == parsed.value:
            return tag
    return None


def rule_check_for(q: Question, final_answer: str | None, correct: bool, tag: str | None) -> dict:
    """Independent evidence for the model's verdict, computed with exact fractions (no AI)."""
    read = parse_answer(final_answer)
    if read is None:
        return {
            "status": "unverified",
            "note": "The final answer couldn't be read as a number, so only the model checked this.",
        }
    shown = final_answer.strip() if final_answer else ""
    expected = parse_answer(q.answer)
    if correct:
        if expected and read.value == expected.value:
            return {"status": "verified", "note": f"{shown} equals the right answer {q.answer} (exact arithmetic)."}
        return {"status": "unverified", "note": "Marked right by the model only."}
    for wrong, wrong_tag in q.wrong_answers.items():
        known = parse_answer(wrong)
        if known and known.value == read.value:
            if wrong_tag == tag:
                label = get_topic().tag(tag).label()
                return {"status": "verified", "note": f"{shown} is exactly what you get if you {label}."}
            return {"status": "mismatch", "note": f"{shown} usually comes from a different mistake; please check."}
    if expected and read.value != expected.value:
        return {
            "status": "consistent",
            "note": f"{shown} is not the right answer ({q.answer}); the named mistake is the model's reading.",
        }
    return {"status": "unverified", "note": "Only the model checked this."}


def _problem_for(q: Question) -> verifier.Problem | None:
    if q.id == AUTO or not q.expr:
        return None
    return verifier.problem_from_bank_expr(q.expr, word_problem=q.concept_id == "C8")


def check_steps(q: Question, steps: list[str]) -> verifier.Verdict:
    """Exact arithmetic on the transcribed lines. For a bank question the reference is its expression; for AUTO the
    problem is the first line the student wrote."""
    if q.id == AUTO:
        return verifier.verify(steps)
    problem = _problem_for(q)
    reference = problem.reference if problem else (parse_answer(q.answer).value if parse_answer(q.answer) else None)
    return verifier.verify(
        steps,
        reference=reference,
        problem=problem,
        simplest_required=q.simplest,
        word_problem=q.concept_id == "C8",
    )


def combine(q: Question, result: PhotoDiagnosis, steps: list[str]) -> dict:
    """The model transcribes; arithmetic judges. The model's own step and tag are a second opinion.

    When the two disagree, the verifier wins if a mal-rule reproduced the wrong line; otherwise the result is marked
    "please check" for the teacher."""
    topic = get_topic()
    verdict = check_steps(q, steps)
    tag, confidence = rules.validate_llm_tag(topic, result.misconception_tag, result.confidence)
    correct, source = result.correct, "vision"
    error_step = result.error_step if not correct else None
    if error_step is not None and not 1 <= error_step <= len(steps):
        error_step = None
    rule_check = rule_check_for(q, result.final_answer_read, correct, tag) if q.id != AUTO else None
    reproduced_by = None
    if verdict.status == "verified":
        source = "vision+rule"
        if verdict.correct:
            correct, tag, error_step = True, None, None
            if verdict.tag == "not_fully_simplified":
                correct, tag, error_step = False, "not_fully_simplified", verdict.error_step
            rule_check = {"status": "verified", "note": verdict.evidence}
        else:
            correct = False
            model_agrees = result.error_step == verdict.error_step and (tag == verdict.tag or verdict.tag is None)
            if verdict.reproduced_by:
                reproduced_by = verdict.reproduced_by
                tag, error_step = verdict.tag, verdict.error_step
                confidence = max(confidence, 0.9)
                rule_check = {"status": "verified", "note": verdict.evidence.capitalize()}
            elif model_agrees or result.error_step is None:
                error_step = verdict.error_step
                rule_check = {
                    "status": "consistent",
                    "note": verdict.evidence + " The mistake's name is the model's reading.",
                }
            else:
                # the arithmetic finds a different wrong line from the model and no rule explains it
                error_step = verdict.error_step
                rule_check = {
                    "status": "mismatch",
                    "note": f"{verdict.evidence} The model circled line {result.error_step}; please check.",
                }
    elif q.id == AUTO:
        rule_check = {
            "status": "unverified",
            "note": "No line could be read as arithmetic, so only the model checked this.",
        }
    else:
        # nothing to compute (a word problem written in words): fall back to the final-answer rules
        final = parse_answer(result.final_answer_read)
        expected = parse_answer(q.answer)
        if final and expected and (final.value == expected.value) != correct:
            correct, source = final.value == expected.value, "vision+rule"
        if not correct:
            known = _known_wrong_tag(q, result.final_answer_read)
            if known and tag == "unclassified":
                tag, confidence, source = known, max(confidence, 0.7), "vision+rule"
        if correct:
            tag, error_step = None, None
        rule_check = rule_check_for(q, result.final_answer_read, correct, tag)
    if correct:
        tag = None
    return {
        "rule_check": rule_check,
        "steps": steps,
        "final_answer_read": result.final_answer_read,
        "correct": correct,
        "error_step": error_step,
        "misconception_tag": tag,
        "label": topic.tag(tag).label() if tag else None,
        "confidence": confidence,
        "feedback": result.feedback_student,
        "source": source,
        "needs_typed_answer": not correct and tag == "unclassified" and verdict.status != "verified",
        "line_values": [x.value for x in verdict.lines],
        "reproduced_by": reproduced_by,
        "verifier": verdict.as_dict(),
        "problem": (steps[verdict.problem_line] if q.id == AUTO and steps else q.stem),
    }


async def read_photo(q: Question, jpeg: bytes, *, use_cache: bool = True) -> tuple[dict | None, list[dict]]:
    """The vision model reads the working; rules then check its verdict. No database access (evals use this too)."""
    if q.id == AUTO:
        tags = _tag_list()
        prompt = f"Allowed misconception tags:\n{tags}\n\nThe photo shows a student's working for a problem they wrote."
        system = prompts.DIAGNOSE_PHOTO_ANY
    else:
        prompt = f"{_question_block(q)}\n\nThe photo shows this student's working for the question above."
        system = prompts.DIAGNOSE_PHOTO
    try:
        result, telemetry = await generate_hedged(
            "Diagnostician",
            "diagnose_photo",
            system,
            prompt,
            PhotoDiagnosis,
            primary=("vertex",),
            backup=("vertex_alt", "nebius"),
            hedge_after=settings.hedge_after_s,
            image=jpeg,
            use_cache=use_cache,
            validate=lambda r: len([s for s in r.steps if s.strip()]) > 0,
        )
    except ApiError as exc:
        if exc.code == "no_vision_provider":
            return None, [
                {
                    "agent": "Diagnostician",
                    "action": "diagnose_photo",
                    "error": exc.code,
                    "message": exc.message,
                    "ok": False,
                }
            ]
        raise
    if result is None:
        return None, telemetry
    steps = [s.strip() for s in result.steps if s.strip()][:12]
    return combine(q, result, steps), telemetry


async def photo(student_id: str, question_id: str, image: bytes) -> dict:
    topic = get_topic()
    q = question_for(question_id)
    with get_conn() as conn:
        student = state.require_student(conn, student_id)
    reading, telemetry = await read_photo(q, prepare_image(image))
    if reading is not None and q.id == AUTO:
        # a problem outside the bank: the concept follows the operator, and the problem line is kept with the answer
        verdict = reading["verifier"]
        first = verifier.parse_expression(reading["problem"]) if reading["steps"] else None
        problem = None
        if first is not None:
            try:
                problem = verifier.problem_from_node(first, first.value())
            except ZeroDivisionError:
                problem = None
        q = Question(
            id=AUTO,
            concept_id=verifier.guess_concept(problem),
            kind="photo",
            stem=reading["problem"],
            answer=verdict.get("reference") or "",
            method="",
        )
    base = {"student_id": student_id, "question_id": q.id, "concept_id": q.concept_id, "telemetry": telemetry}
    if reading is None:
        no_provider = any(t.get("error") == "no_vision_provider" for t in telemetry)
        if no_provider:
            raise ApiError(
                503,
                "no_vision_provider",
                "No vision provider configured. Set GCP_PROJECT for Vertex AI "
                "or NEBIUS_API_KEY with NEBIUS_VISION_MODEL for Nebius.",
            )
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
            "rule_check": {"status": "unverified", "note": "The photo couldn't be read."},
            "mastery_after": None,
            "gap_opened": False,
            "line_values": [],
            "reproduced_by": None,
            "verifier": None,
            "problem": q.stem,
        }

    other = looks_like_other_problem(q, reading["steps"]) if q.id != AUTO else None
    if other is not None:
        # nothing is saved: a diagnosis against the wrong problem would put a false gap on the heatmap
        raise ApiError(
            409,
            "wrong_problem",
            f"This page looks like “{other.stem}”, not “{q.stem}”. Nothing was saved. "
            "Pick the matching problem and scan again.",
        )

    outcome = {"mastery_after": None, "gap_opened": False}
    tag, error_step, steps = reading["misconception_tag"], reading["error_step"], reading["steps"]
    with get_conn() as conn, transaction(conn):
        if not reading["needs_typed_answer"]:
            outcome = state.record_response(
                conn,
                student_id,
                q,
                answer=reading["final_answer_read"] or "",
                correct=reading["correct"],
                tag=tag,
                source=reading["source"],
                confidence=reading["confidence"],
                phase="photo",
                error_step=error_step,
                stem=q.stem if q.id == AUTO else None,
            )
        if reading["correct"]:
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
            f"{student['nickname']} · {q.id}: {what} ({reading['confidence']:.2f}, {reading['source']})",
            student_id,
            telemetry,
        )
    return {**base, **reading, **outcome}
