"""The simulator: a class of 30 students answering through the same rules. Zero LLM calls, fully seeded."""

import sqlite3

from .. import rules
from ..db import log_event, new_id, now
from ..topic import get_topic
from . import state

NAMES = [
    "Aarav",
    "Diya",
    "Kiran",
    "Meera",
    "Rohan",
    "Ananya",
    "Vikram",
    "Sneha",
    "Arjun",
    "Pooja",
    "Rahul",
    "Kavya",
    "Nikhil",
    "Isha",
    "Manoj",
    "Divya",
    "Suresh",
    "Lakshmi",
    "Harsha",
    "Nandini",
    "Varun",
    "Shreya",
    "Pranav",
    "Bhavana",
    "Tejas",
    "Aishwarya",
    "Karthik",
    "Deepa",
    "Gowtham",
    "Swathi",
]
LANGS = ["kn", "en", "hi", "kn", "en", "kn"]

# (count, name, default p_correct, {concept: (p_correct, preferred mistake)})
ARCHETYPES = [
    (10, "steady", 0.85, {}),
    (9, "adds denominators", 0.75, {"C4": (0.15, "add_denominators"), "C8": (0.5, "add_denominators")}),
    (6, "division muddle", 0.7, {"C7": (0.2, "divide_no_flip"), "C6": (0.55, "whole_times_both")}),
    (5, "size of fractions", 0.65, {"C5": (0.25, "bigger_denominator_bigger"), "C1": (0.5, "equivalence_additive")}),
]


def personas() -> list[dict]:
    out, i = [], 0
    for count, archetype, base, specials in ARCHETYPES:
        for _ in range(count):
            out.append(
                {
                    "nickname": NAMES[i],
                    "language": LANGS[i % len(LANGS)],
                    "archetype": archetype,
                    "base": base,
                    "specials": specials,
                    "seed": f"sim-{i}",
                }
            )
            i += 1
    return out


def _answer_question(conn, student_id, q, p, preferred, rng, phase="quiz"):
    answer = rules.simulate_answer(rng, q, p, preferred)
    d = rules.diagnose_mcq(q, answer) if q.kind == "mcq" else rules.diagnose_typed(q, answer)
    if d is None:  # a wrong typed answer outside the table; the simulator never calls the LLM
        d = rules.RuleDiagnosis(False, "unclassified", "rule", 0.3)
    state.record_response(
        conn,
        student_id,
        q,
        answer=answer,
        correct=d.correct,
        tag=d.tag,
        source=d.source,
        confidence=d.confidence,
        phase=phase,
    )
    return d.correct


def run(conn: sqlite3.Connection, session_id: str, n: int = 30, start: int = 0) -> dict:
    """Must be called inside a transaction."""
    topic = get_topic()
    people = personas()
    answers = closed = 0
    added = 0
    for k in range(n):
        persona = people[(start + k) % len(people)]
        student_id = new_id("sim")
        nickname = persona["nickname"] if start + k < len(people) else f"{persona['nickname']} {start + k + 1}"
        conn.execute(
            "INSERT INTO student (id, session_id, nickname, language, kind, created_at) "
            "VALUES (?, ?, ?, ?, 'simulated', ?)",
            (student_id, session_id, nickname, persona["language"], now()),
        )
        rng = rules.stable_rng(persona["seed"], session_id, str(start + k))
        seen: set[str] = set()
        for concept in topic.concepts:
            p, preferred = persona["specials"].get(concept.id, (persona["base"], None))
            mcqs = [q for q in topic.questions_for(concept.id, ("mcq",)) if q.id not in seen]
            texts = [q for q in topic.questions_for(concept.id, ("text",)) if q.id not in seen]
            for q in (mcqs[:1] + texts[:1]) if texts else mcqs[:2]:
                _answer_question(conn, student_id, q, p, preferred, rng)
                seen.add(q.id)
                answers += 1
        # some students work through their lesson and retry, as a real class would during the session
        for gap in conn.execute(
            "SELECT concept_id, tag FROM gap WHERE student_id = ? AND status = 'open'", (student_id,)
        ).fetchall():
            if rng.random() > 0.5:
                continue
            p, preferred = persona["specials"].get(gap["concept_id"], (persona["base"], None))
            items = rules.pick_retry(topic, gap["concept_id"], gap["tag"], seen)
            results = [
                _answer_question(conn, student_id, q, min(0.9, p + 0.45), preferred, rng, "retry") for q in items
            ]
            answers += len(items)
            if len(results) == 2 and all(results):
                state.close_gap(conn, student_id, gap["concept_id"])
                closed += 1
        added += 1
    log_event(
        conn,
        session_id,
        "Simulator",
        "simulate",
        f"Added {added} simulated students ({answers} answers, {closed} gaps closed); rules only, 0 LLM calls",
    )
    return {"students_added": added, "answers": answers, "gaps_closed": closed, "llm_calls": 0}
