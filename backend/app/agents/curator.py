"""The Curator: a micro-lesson in the student's language for their top gap, plus 2 retry items from the bank."""

import asyncio
import json
import logging

from .. import rules
from ..config import settings
from ..db import get_conn, log_event, now, row, transaction
from ..i18n import LANGUAGE_LABELS
from ..llm import prompts
from ..llm.providers import generate
from ..llm.schemas import LessonOut
from ..topic import get_topic
from . import state
from .examiner import question_out

log = logging.getLogger("gurugraph.curator")

# the mistakes the demo and a typical class hit most; pre-generated in en/hi/kn and reviewed by a native reader
DEMO_PAIRS = [
    ("C4", "add_denominators"),
    ("C4", "unlike_denominators"),
    ("C7", "divide_no_flip"),
    ("C7", "divide_flip_first"),
    ("C5", "bigger_denominator_bigger"),
    ("C6", "whole_times_both"),
    ("C8", "word_problem_operation"),
    ("C1", "equivalence_additive"),
]

_jobs: dict[str, asyncio.Task] = {}
_last_telemetry: dict[str, list[dict]] = {}


def lesson_key(concept_id: str, tag: str, language: str) -> str:
    return f"{get_topic().id}|{concept_id}|{tag}|{language}"


def _example_method(concept_id: str, tag: str) -> str:
    topic = get_topic()
    qs = topic.questions_for(concept_id, ("mcq", "text"))
    targeted = [q for q in qs if tag in q.distractor_tags or tag in q.wrong_answers.values()]
    return (targeted or qs)[0].method


def template_lesson(concept_id: str, tag: str) -> dict:
    """English fallback when no verified localized lesson is available. Never cached."""
    topic = get_topic()
    t = topic.tag(tag)
    practice = [{"question": q.stem, "answer": q.answer} for q in topic.questions_for(concept_id, ("mcq", "text"))[:3]]
    md = (
        f"**It looks like you {t.label()}.**\n\n{t.definition}\n\n"
        f"**The right way:** {_example_method(concept_id, tag)}\n\n"
        "**Tip:** check each step before you move to the next line."
    )
    return {"language": "en", "lesson_md": md, "practice": practice, "translated": False}


async def _generate(key: str, concept_id: str, tag: str, language: str) -> dict | None:
    topic = get_topic()
    concept, t = topic.concept(concept_id), topic.tag(tag)
    prompt = (
        f"Concept: {concept.name} ({concept.name_in(language)})\n"
        f"The student's mistake: {t.label()}. Definition: {t.definition}\n"
        f"A correct worked method: {_example_method(concept_id, tag)}\n"
        f"Target language: {prompts.LANGUAGE_NAMES.get(language, 'English')}. Set the language field to '{language}'."
    )
    route = ("vertex", "nebius") if language in ("kn", "hi") else ("nebius", "vertex")
    result, telemetry = await generate(
        "Curator",
        "lesson",
        prompts.CURATOR,
        prompt,
        LessonOut,
        route=route,
        timeout=25,
        validate=lambda r: len(r.practice) >= 3 and rules.is_in_language(r.lesson_md, language),
    )
    _last_telemetry[key] = telemetry
    if not result:
        return None
    payload = {
        "language": language,
        "lesson_md": result.lesson_md.strip(),
        "practice": [p.model_dump() for p in result.practice[:3]],
        "translated": True,
    }
    with get_conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO lesson_cache (key, payload_json, created_at) VALUES (?, ?, ?)",
            (key, json.dumps(payload, ensure_ascii=False), now()),
        )
    return payload


async def _job(
    key: str,
    concept_id: str,
    tag: str,
    language: str,
    session_id: str | None,
    student_id: str | None,
    nickname: str | None,
) -> dict | None:
    try:
        payload = await _generate(key, concept_id, tag, language)
    except Exception:
        log.exception("lesson generation failed for %s", key)
        payload = None
    if session_id:
        telemetry = _last_telemetry.get(key, [])
        what = "written and language-checked" if payload else "fell back to the English template"
        with get_conn() as conn, transaction(conn):
            log_event(
                conn,
                session_id,
                "Curator",
                "lesson",
                f"{nickname}: {LANGUAGE_LABELS.get(language, language)} lesson on {tag} {what}",
                student_id,
                telemetry,
            )
    return payload


def _cached(key: str) -> dict | None:
    with get_conn() as conn:
        r = row(conn, "SELECT payload_json FROM lesson_cache WHERE key = ?", (key,))
    return json.loads(r["payload_json"]) if r else None


async def lesson(student_id: str) -> dict:
    topic = get_topic()
    with get_conn() as conn:
        student = state.require_student(conn, student_id)
        gap = state.top_open_gap(conn, student_id)
        seen = state.seen_questions(conn, student_id)
    if not gap:
        return {"status": "none", "lesson": None, "retry": None, "telemetry": []}
    concept_id, tag, language = gap["concept_id"], gap["tag"] or "unclassified", student["language"]
    retry = [question_out(q, student_id) for q in rules.pick_retry(topic, concept_id, tag, seen)]
    key = lesson_key(concept_id, tag, language)

    payload = _cached(key)
    if payload is None and (settings.demo_mode == "cached" or tag == "unclassified"):
        payload = template_lesson(concept_id, tag)
    if payload is None:
        job = _jobs.get(key)
        if job is None or (job.done() and job.result() is not None and _cached(key) is None):
            _jobs[key] = asyncio.create_task(
                _job(key, concept_id, tag, language, student["session_id"], student_id, student["nickname"])
            )
            return {"status": "generating", "lesson": None, "retry": None, "telemetry": []}
        if not job.done():
            return {"status": "generating", "lesson": None, "retry": None, "telemetry": []}
        payload = job.result() or template_lesson(concept_id, tag)
        if not job.result():
            _jobs.pop(key, None)  # let a later request try the provider again

    concept, t = topic.concept(concept_id), topic.tag(tag)
    lesson_out = {
        **payload,
        "language_label": LANGUAGE_LABELS.get(payload["language"], payload["language"]),
        "concept_id": concept_id,
        "concept_name": concept.name_in(payload["language"]),
        "tag": tag,
        "label": t.label(payload["language"]),
    }
    return {"status": "ready", "lesson": lesson_out, "retry": retry, "telemetry": _last_telemetry.get(key, [])}


async def warm(pairs: list[tuple[str, str]], languages=("en", "hi", "kn")) -> dict[str, dict]:
    """Pre-generate lessons (Risheeth reviews them) and return what is now cached."""
    out: dict[str, dict] = {}
    for concept_id, tag in pairs:
        for language in languages:
            key = lesson_key(concept_id, tag, language)
            payload = _cached(key) or await _generate(key, concept_id, tag, language)
            if payload:
                out[key] = payload
    return out


def load_cache_file() -> int:
    path = settings.data_dir / "lessons_cache.json"
    if not path.exists():
        return 0
    data = json.loads(path.read_text(encoding="utf-8"))
    with get_conn() as conn:
        for key, payload in data.items():
            conn.execute(
                "INSERT OR IGNORE INTO lesson_cache (key, payload_json, created_at) VALUES (?, ?, ?)",
                (key, json.dumps(payload, ensure_ascii=False), now()),
            )
    return len(data)
