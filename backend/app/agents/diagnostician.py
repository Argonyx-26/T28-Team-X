"""The Diagnostician: answer key and rules first; the LLM only for unfamiliar typed answers and handwriting."""

import hashlib
import io
import re
import time
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
MAX_PIXELS = 40_000_000
MIN_SIDE = 300
REPEAT_SECONDS = 600
# the same photo sent again (a double tap, a retry, a second upload) is answered from here and counted once
_recent: dict[tuple, tuple[float, dict]] = {}


def recent(key: tuple) -> dict | None:
    hit = _recent.get(key)
    if hit and time.monotonic() - hit[0] < REPEAT_SECONDS:
        return {**hit[1], "repeat": True}
    return None


def remember(key: tuple, result: dict) -> None:
    now_ = time.monotonic()
    for k in [k for k, (t, _) in _recent.items() if now_ - t >= REPEAT_SECONDS]:
        _recent.pop(k, None)
    _recent[key] = (now_, result)


# "AUTO": a problem outside the bank; the problem is whatever the student wrote first, and arithmetic judges it
AUTO = "AUTO"
_PLACEHOLDER = Question(id=AUTO, concept_id="C4", kind="photo", stem="Any fraction problem", answer="", method="")


def question_for(question_id: str) -> Question:
    if question_id.upper() == AUTO:
        return _PLACEHOLDER
    return state.require_question(question_id, ("photo",))


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
        again = row(
            conn,
            "SELECT id FROM response WHERE student_id = ? AND question_id = ? AND phase = ?",
            (student_id, question_id, phase),
        )
        if again:
            # two taps raced past the first check while the model was thinking: count the answer once
            outcome = {"mastery_before": mastery_now, "mastery_after": mastery_now, "gap_opened": False}
        else:
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
        if student["kind"] != "simulated" and not again:
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
    except Exception as exc:
        raise ApiError(422, "not_an_image", "That file isn't a photo we can read.") from exc
    if min(img.width, img.height) < MIN_SIDE:
        # a thumbnail can't be read; the model would invent a sum rather than say so
        raise ApiError(
            422, "image_too_small", "That photo is too small to read. Take it closer, with the page filling the screen."
        )
    if img.width * img.height > MAX_PIXELS:
        # a tiny file can decode into a huge image; refuse it before decoding (the API runs on one small instance)
        raise ApiError(413, "image_too_large", "That photo is too large. Try a normal phone photo.")
    try:
        img.draft("RGB", (1600, 1600))  # JPEGs decode at a smaller size straight away
        img = ImageOps.exif_transpose(img)
        img.thumbnail((1280, 1280))
        img = img.convert("RGB")
    except Exception as exc:
        raise ApiError(422, "not_an_image", "That file isn't a photo we can read.") from exc
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


def _is_other_problem(q: Question, steps: list[str]) -> bool:
    """The first problem line on the page has other fractions than the picked bank problem (a word problem is compared
    by its numbers, so the cake problem written out in words still matches P4)."""
    from .pages import match_bank

    found = verifier._first_expression(steps)
    line = steps[found[0]] if found else (steps[0] if steps else "")
    written = verifier.written_fractions(_problem_text(line))
    wanted = verifier.written_fractions(q.stem)
    if not written or not wanted:
        return False
    if sorted(written) == sorted(wanted):
        return False
    # the same problem in simplest terms ("6/8" for "3/4") still counts as the same problem
    from fractions import Fraction

    as_values = lambda xs: sorted(Fraction(x) for x in xs)  # noqa: E731
    return as_values(written) != as_values(wanted) and match_bank(steps[0]) is not q


def _bank_problem_on(steps: list[str]) -> Question | None:
    """The bank photo problem the page actually shows, if it is one."""
    from .pages import match_bank

    found = verifier._first_expression(steps)
    line = steps[found[0]] if found else (steps[0] if steps else "")
    return match_bank(_problem_text(line)) or match_bank(steps[0] if steps else "")


def _no_working(q: Question, steps: list[str], result: PhotoDiagnosis) -> dict:
    return {
        "rule_check": {"status": "unverified", "note": "No fraction working was found on this page."},
        "steps": steps,
        "final_answer_read": None,
        "correct": False,
        "error_step": None,
        "misconception_tag": None,
        "label": None,
        "confidence": 0.0,
        "feedback": "No fraction working was found. Photograph the page with the working, closer and in good light.",
        "source": "vision",
        "needs_typed_answer": True,
        "no_working": True,
        "line_values": [],
        "line_boxes": None,
        "reproduced_by": None,
        "verifier": None,
        "problem": q.stem,
    }


def _problem_text(line: str) -> str:
    """The problem as posed on a line of working: "1) 3/8 + 1/8 = 4/16" -> "3/8 + 1/8"."""
    segs = verifier.split_chain(line)
    if len(segs) > 1 and verifier._BLANK.search(segs[1].text):
        # "2/3 = ?/6": the blank is part of the question
        return verifier.strip_enumerator(f"{segs[0].text} = {segs[1].text}").strip()
    return verifier.strip_enumerator(segs[0].text if segs else line).strip()


# four numbers in a row, separated by commas or dashes: "280,95,350,531", "100,43-118,369" (corner to corner)
_SEP = r"\s*[,\-–]\s*"
_NUM = r"(\d+(?:\.\d+)?)"
_BOX = re.compile(_NUM + _SEP + _NUM + _SEP + _NUM + _SEP + _NUM)


def split_block(box: str, n: int) -> list[str]:
    """One box drawn around a whole problem, cut into n equal rows: working on ruled paper is evenly spaced, so row k
    is where line k is. Empty when the box can't hold n lines."""
    m = _BOX.search(box)
    if not m or n < 2:
        return []
    ymin, xmin, ymax, xmax = (float(x) for x in m.groups())
    step = (ymax - ymin) / n
    if step < 8:
        return []
    return [f"{round(ymin + k * step)},{round(xmin)},{round(ymin + (k + 1) * step)},{round(xmax)}" for k in range(n)]


def box_groups(boxes: list[str] | None) -> list[str]:
    """One "ymin,xmin,ymax,xmax" string per box, however loosely the model wrote them ("280,95,350, 531],", several in
    one string, a comment after)."""
    joined = " ; ".join(str(b) for b in boxes or [])
    return [",".join(g) for g in _BOX.findall(joined)]


def line_boxes(boxes: list[str], n_steps: int) -> list[list[int] | None] | None:
    """The model's box per transcribed line, validated: inside the image, top to bottom, sensible sizes. None when the
    set fails, so the UI falls back to the transcript view."""
    if not boxes or n_steps < 1:
        return None
    groups = _BOX.findall(" ; ".join(box_groups(boxes)))
    if len(groups) < n_steps:
        return None
    out: list[list[int] | None] = []
    last_y = -1
    for group in groups[:n_steps]:
        ymin, xmin, ymax, xmax = (int(float(x)) for x in group)
        if not (0 <= ymin < ymax <= 1000 and 0 <= xmin < xmax <= 1000):
            return None
        if not (8 <= ymax - ymin <= 400 and 30 <= xmax - xmin <= 1000):
            return None
        if ymin < last_y - 40:  # lines run down the page; a little overlap is fine
            return None
        last_y = ymin
        out.append([ymin, xmin, ymax, xmax])
    return out


def combine(q: Question, result: PhotoDiagnosis, steps: list[str]) -> dict:
    """The model transcribes; arithmetic judges. The model's own step and tag are a second opinion.

    When the two disagree, the verifier wins if a mal-rule reproduced the wrong line; otherwise the result is marked
    "please check" for the teacher."""
    topic = get_topic()
    # a name or roll number the model transcribed at the top is not working: drop it, and its box, and shift the
    # model's own step so every line number counts from the first line of working
    steps, dropped = verifier.strip_headers(steps)
    groups = box_groups(result.boxes)
    if len(groups) == 1 and len(steps) + dropped > 1:
        groups = split_block(groups[0], len(steps) + dropped)  # one box around the whole problem
    boxes = groups[dropped:]
    if not verifier.looks_like_working(steps):
        return _no_working(q, steps, result)
    if q.id != AUTO and _is_other_problem(q, steps):
        # the page shows another problem than the one picked: judge what is written, never the picked problem
        q = _bank_problem_on(steps) or _PLACEHOLDER
    model_step = result.error_step - dropped if result.error_step is not None else None
    if model_step is not None and model_step < 1:
        model_step = None
    verdict = check_steps(q, steps)
    if verdict.status == "unanswered":
        # never a green tick for a copied-out problem, and never a gap: the teacher sees it isn't finished
        out = _no_working(q, steps, result)
        out.update(
            {
                "rule_check": {"status": "unverified", "note": "No answer is written after the problem yet."},
                "feedback": "Finish the sum and write the answer, then scan it again.",
                "no_working": False,
                "unanswered": True,
                "line_values": [x.value for x in verdict.lines],
                "line_boxes": line_boxes(boxes, len(steps)),
                "verifier": verdict.as_dict(),
                "problem": _problem_text(steps[verdict.problem_line]) if q.id == AUTO and steps else q.stem,
                "judged_as": q.id,
            }
        )
        return out
    tag, confidence = rules.validate_llm_tag(topic, result.misconception_tag, result.confidence)
    correct, source = result.correct, "vision"
    error_step = model_step if not correct else None
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
            model_agrees = model_step == verdict.error_step and (tag == verdict.tag or verdict.tag is None)
            if verdict.reproduced_by:
                reproduced_by = verdict.reproduced_by
                tag, error_step = verdict.tag, verdict.error_step
                confidence = max(confidence, 0.9)
                rule_check = {"status": "verified", "note": verdict.evidence.capitalize()}
            elif verdict.tag and tag in (verdict.tag, "unclassified", None):
                # a rule gives the same value but not the child's written form: name it, but don't call it proof
                tag, error_step = verdict.tag, verdict.error_step
                rule_check = {"status": "consistent", "note": verdict.evidence}
            elif (
                not verdict.tag
                and verdict.evidence.startswith(("The blank", "The question", "Line"))
                and (
                    "isn't true" in verdict.evidence
                    or "divides by zero" in verdict.evidence
                    or "asks for" in verdict.evidence
                )
            ):
                # a side sum that isn't true, a zero denominator, or the wrong form: arithmetic is enough to say so
                error_step = verdict.error_step
                tag = tag if tag not in (None,) else "unclassified"  # never invent a name
                rule_check = {"status": "verified", "note": verdict.evidence}
            elif model_agrees or model_step is None:
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
                    "note": f"{verdict.evidence} The model circled line {model_step}; please check.",
                }
    elif verdict.status == "checked":
        # the problem is stated in words: the arithmetic of every line holds, and the model says whether it answers
        # the question (a story that needs × answered with +, "which is bigger", ...)
        source = "vision+rule"
        rule_check = {"status": "consistent", "note": verdict.evidence}
    elif q.id == AUTO:
        unread = verdict.evidence if verdict.evidence.startswith("Line ") else "No line could be read as arithmetic."
        rule_check = {"status": "unverified", "note": f"{unread[:-1]}, so only the model checked this."}
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
    feedback = result.feedback_student
    if correct != result.correct or (not correct and tag != result.misconception_tag):
        # the arithmetic overruled the model: its own words would contradict the verdict, so say it plainly
        answer = verdict.reference or (q.answer if q.id != AUTO else "")
        feedback = feedback_text("en", correct, tag, topic.tag(tag).label() if tag else None, answer or "")
    not_fractions = not verifier.has_fraction(steps)
    if not_fractions:
        # checked and shown, never filed: a whole-number slip is not a fractions gap
        tag = None
        rule_check = {
            **(rule_check or {"status": "unverified", "note": ""}),
            "note": (
                (rule_check or {}).get("note", "") + " Whole numbers only, so it isn't saved to the mark book."
            ).strip(),
        }
    return {
        "not_fractions": not_fractions,
        "rule_check": rule_check,
        "steps": steps,
        "final_answer_read": result.final_answer_read,
        "correct": correct,
        "error_step": error_step,
        "misconception_tag": tag,
        "label": topic.tag(tag).label() if tag else None,
        "confidence": confidence,
        "feedback": feedback,
        "source": source,
        "needs_typed_answer": not_fractions or (not correct and tag == "unclassified" and verdict.status != "verified"),
        "line_values": [x.value for x in verdict.lines],
        "line_boxes": line_boxes(boxes, len(steps)),
        "reproduced_by": reproduced_by,
        "verifier": verdict.as_dict(),
        "problem": (_problem_text(steps[verdict.problem_line]) if q.id == AUTO and steps else q.stem),
        "judged_as": q.id,
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
    jpeg = prepare_image(image)
    repeat_key = ("photo", student_id, q.id, hashlib.sha256(jpeg).hexdigest())
    earlier = recent(repeat_key)
    if earlier is not None:
        return earlier
    reading, telemetry = await read_photo(q, jpeg)
    picked = q
    if reading is not None and reading.get("judged_as") not in (None, q.id):
        q = topic.question(reading["judged_as"]) or _PLACEHOLDER
        shown = reading["problem"] if q.id == AUTO else q.stem
        reading["problem_note"] = f"This page shows {shown}, not {picked.stem}, so it was checked as written."
    if reading is not None and reading.get("no_working"):
        with get_conn() as conn, transaction(conn):
            log_event(
                conn,
                student["session_id"],
                "Diagnostician",
                "diagnose_photo",
                f"{student['nickname']}: no fraction working found on the photo; nothing saved",
                student_id,
                telemetry,
            )
        return {
            "student_id": student_id,
            "question_id": q.id,
            "concept_id": q.concept_id,
            "telemetry": telemetry,
            **reading,
            "mastery_after": None,
            "gap_opened": False,
        }
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
            "line_boxes": None,
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
    out = {**base, **reading, **outcome}
    remember(repeat_key, out)
    return out
