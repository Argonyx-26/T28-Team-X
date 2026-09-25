"""The Analyst's read side: the class dashboard, the agent feed, one student's detail and the judges' numbers."""

import json
import statistics

from .. import costs
from ..config import settings
from ..db import get_conn, row, rows
from ..errors import ApiError
from ..topic import get_topic
from . import review, state


def _recommendations(conn, session_id: str) -> list[dict]:
    latest = row(
        conn,
        "SELECT run_id FROM recommendation WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
        (session_id,),
    )
    if not latest:
        return []
    out = []
    for r in rows(
        conn, "SELECT * FROM recommendation WHERE run_id = ? AND stage = 'final' ORDER BY rowid", (latest["run_id"],)
    ):
        payload = json.loads(r["payload_json"])
        out.append(
            {
                **payload,
                "id": r["id"],
                "stage": "final",
                "flagged": bool(r["flagged"]),
                "analyst_note": r["analyst_note"],
                "approved": r["approved_at"] is not None,
            }
        )
    return out


def dashboard(session_id: str) -> dict:
    topic = get_topic()
    with get_conn() as conn:
        session = state.require_session(conn, session_id)
        students, mastery, responses, gaps, analysis = state.analyse_class(conn, session_id)
        recommendations = _recommendations(conn, session_id)
    assessed: dict[str, set[str]] = {}
    for r in responses:
        assessed.setdefault(r["student_id"], set()).add(r["concept_id"])
    by_id = {s["id"]: s for s in students}

    def refs(ids):
        return [{"id": i, "nickname": by_id[i]["nickname"]} for i in ids]

    return {
        "session_id": session["id"],
        "class_name": session["class_name"],
        "code": session["code"],
        "n_students": len(students),
        "n_simulated": sum(1 for s in students if s["kind"] == "simulated"),
        "concepts": [
            {
                "id": c.id,
                "name": c.name,
                "short": c.short,
                "avg": c.avg,
                "responders": c.responders,
                "below_gap": c.below_gap,
                "open_gaps": c.open_gaps,
                "top": [{"tag": t, "label": topic.tag(t).label(), "students": k} for t, k in c.top],
            }
            for c in analysis.concepts
        ],
        "edges": [list(e) for e in topic.edges],
        "heatmap": {
            "concept_ids": topic.concept_ids,
            "students": [
                {
                    "id": s["id"],
                    "nickname": s["nickname"],
                    "kind": s["kind"],
                    "language": s["language"],
                    "roll_no": s.get("roll_no"),
                }
                for s in students
            ],
            "cells": [
                [
                    mastery[s["id"]].get(cid) if cid in assessed.get(s["id"], set()) else None
                    for cid in topic.concept_ids
                ]
                for s in students
            ],
        },
        "groups": {k: refs(v) for k, v in analysis.groups.items()},
        "focus_concept": analysis.focus_concept,
        "gaps": {"open": analysis.gaps_open, "closed": analysis.gaps_closed, "rate": analysis.gap_rate},
        "recommendations": recommendations,
    }


def events(session_id: str, after: int = 0, limit: int = 200) -> dict:
    with get_conn() as conn:
        items = rows(
            conn,
            "SELECT e.seq, e.ts, e.agent, e.action, e.reason, e.student_id, e.telemetry_json, s.nickname "
            "FROM agent_event e LEFT JOIN student s ON s.id = e.student_id "
            "WHERE e.session_id = ? AND e.seq > ? ORDER BY e.seq LIMIT ?",
            (session_id, after, limit),
        )
    events_out = [
        {
            "seq": e["seq"],
            "ts": e["ts"],
            "agent": e["agent"],
            "action": e["action"],
            "reason": e["reason"],
            "student_id": e["student_id"],
            "student_nickname": e["nickname"],
            "telemetry": json.loads(e["telemetry_json"] or "[]"),
        }
        for e in items
    ]
    return {"events": events_out, "last_seq": events_out[-1]["seq"] if events_out else after}


def school(school_id: str) -> dict:
    """Classes × concepts across one school, the top misconceptions, and which class needs which re-teach."""
    topic = get_topic()
    with get_conn() as conn:
        sessions = rows(
            conn, "SELECT id, code, class_name FROM session WHERE school_id = ? ORDER BY code", (school_id,)
        )
        if not sessions:
            raise ApiError(404, "school_not_found", "No school has that id.")
        classes = []
        tag_students: dict[str, set[str]] = {}
        tag_by_concept: dict[tuple[str, str], set[str]] = {}
        total_students = 0
        for ses in sessions:
            students, _, _, _, analysis = state.analyse_class(conn, ses["id"])
            total_students += len(students)
            focus = analysis.stats(analysis.focus_concept) if analysis.focus_concept else None
            top = focus.top[0] if focus and focus.top else None
            for cid, tags in analysis.students_by_tag.items():
                for tag, who in tags.items():
                    tag_students.setdefault(tag, set()).update(who)
                    tag_by_concept.setdefault((cid, tag), set()).update(who)
            classes.append(
                {
                    "session_id": ses["id"],
                    "code": ses["code"],
                    "class_name": ses["class_name"],
                    "n_students": len(students),
                    "averages": {c.id: c.avg for c in analysis.concepts},
                    "open_gaps": {c.id: c.open_gaps for c in analysis.concepts},
                    "focus_concept": analysis.focus_concept,
                    "reteach": (
                        {
                            "concept_id": analysis.focus_concept,
                            "concept_name": topic.concept(analysis.focus_concept).name,
                            "tag": top[0],
                            "label": topic.tag(top[0]).label(),
                            "students": top[1],
                        }
                        if top and analysis.focus_concept
                        else None
                    ),
                    "gaps": {"open": analysis.gaps_open, "closed": analysis.gaps_closed},
                }
            )
    top_tags = sorted(tag_students.items(), key=lambda kv: (-len(kv[1]), kv[0]))[:5]
    return {
        "school_id": school_id,
        "n_classes": len(classes),
        "n_students": total_students,
        "concepts": [{"id": c.id, "name": c.name, "short": c.short} for c in topic.concepts],
        "classes": classes,
        "top_misconceptions": [
            {
                "tag": tag,
                "label": topic.tag(tag).label(),
                "students": len(who),
                "concepts": sorted(
                    {cid for (cid, t) in tag_by_concept if t == tag}, key=lambda c: topic.concept_ids.index(c)
                ),
            }
            for tag, who in top_tags
        ],
    }


def digest(session_id: str, hours: int = 24) -> dict:
    """The morning card: since yesterday, how many homework pages came in and what gaps they opened."""
    from datetime import UTC, datetime, timedelta

    topic = get_topic()
    since = (datetime.now(UTC) - timedelta(hours=hours)).isoformat(timespec="seconds")
    with get_conn() as conn:
        state.require_session(conn, session_id)
        pages_ = rows(
            conn,
            "SELECT action, student_id FROM agent_event WHERE session_id = ? AND ts >= ? "
            "AND action IN ('homework_page', 'snap_page')",
            (session_id, since),
        )
        new_gaps = rows(
            conn,
            "SELECT g.concept_id, g.tag FROM gap g JOIN student s ON s.id = g.student_id "
            "WHERE s.session_id = ? AND g.status = 'open' AND g.opened_at >= ?",
            (session_id, since),
        )
        problems = rows(
            conn,
            "SELECT r.correct, r.concept_id, r.tag FROM response r JOIN student s ON s.id = r.student_id "
            "WHERE s.session_id = ? AND r.created_at >= ? AND r.phase IN ('homework', 'snap')",
            (session_id, since),
        )
    by_concept: dict[str, int] = {}
    for g in new_gaps:
        by_concept[g["concept_id"]] = by_concept.get(g["concept_id"], 0) + 1
    top = sorted(by_concept.items(), key=lambda kv: (-kv[1], kv[0]))[:2]
    return {
        "hours": hours,
        "homework_pages": sum(1 for p in pages_ if p["action"] == "homework_page"),
        "snap_pages": sum(1 for p in pages_ if p["action"] == "snap_page"),
        "students": len({p["student_id"] for p in pages_ if p["student_id"]}),
        "problems": len(problems),
        "wrong": sum(1 for p in problems if not p["correct"]),
        "new_gaps": len(new_gaps),
        "top_concepts": [{"id": c, "name": topic.concept(c).name, "gaps": n} for c, n in top],
    }


def student_detail(student_id: str) -> dict:
    topic = get_topic()
    with get_conn() as conn:
        s = state.require_student(conn, student_id)
        mastery = state.mastery_map(conn, student_id)
        gaps = rows(conn, "SELECT concept_id, status, tag FROM gap WHERE student_id = ?", (student_id,))
        resp = rows(
            conn,
            "SELECT question_id, answer, correct, tag, source, phase, created_at, concept_id, stem "
            "FROM response WHERE student_id = ? ORDER BY id DESC LIMIT 30",
            (student_id,),
        )
    assessed = sorted({r["concept_id"] for r in resp} | set(mastery))
    return {
        "id": s["id"],
        "nickname": s["nickname"],
        "language": s["language"],
        "kind": s["kind"],
        "mastery": mastery,
        "assessed": assessed,
        "gaps": [{**g, "label": topic.tag(g["tag"]).label() if g["tag"] else None} for g in gaps],
        "responses": [
            {
                "question_id": r["question_id"],
                "stem": (
                    topic.question(r["question_id"]).stem if topic.question(r["question_id"]) else r["stem"] or ""
                ),
                "answer": r["answer"],
                "correct": bool(r["correct"]),
                "tag": r["tag"],
                "label": topic.tag(r["tag"]).label() if r["tag"] else None,
                "source": r["source"],
                "phase": r["phase"],
                "created_at": r["created_at"],
            }
            for r in resp
        ],
    }


def judges_summary() -> dict:
    topic = get_topic()
    numbers = [
        {
            "label": "Questions in the verified bank",
            "value": str(len(topic.questions)),
            "n": None,
            "method": "every answer and distractor is checked by exact fraction arithmetic in our test suite",
        }
    ]
    with get_conn() as conn:
        photo_tel = []
        for (tj,) in conn.execute("SELECT telemetry_json FROM agent_event WHERE action = 'diagnose_photo'"):
            photo_tel += [t for t in json.loads(tj or "[]") if t.get("ok") and not t.get("cached")]
    if photo_tel:
        ms = [t["ms"] for t in photo_tel]
        paise = [t["cost_paise"] for t in photo_tel]
        numbers.append(
            {
                "label": "Median time to diagnose a notebook photo",
                "value": f"{statistics.median(ms) / 1000:.1f} s",
                "n": len(ms),
                "method": "measured server-side on every live photo call since the last reset, including our own tests",
            }
        )
        numbers.append(
            {
                "label": "Cost per photo diagnosis",
                "value": f"₹{statistics.mean(paise) / 100:.3f}",
                "n": len(paise),
                "method": "measured tokens x published per-token price, ₹88 per USD",
            }
        )
    units = costs.load_units()
    if units:
        u = units["unit_paise"]
        numbers.append(
            {
                "label": "AI cost per student per month",
                "value": f"₹{units['per_student_month_inr']:.2f}",
                "n": sum(units["n"].values()),
                "method": (
                    f"measured calls: photo ₹{u['diagnose_photo'] / 100:.2f}, lesson ₹{u['lesson'] / 100:.2f}, parent "
                    f"message ₹{u['parent_message'] / 100:.2f}, Kannada voice note ₹{u['voice_note'] / 100:.2f}, class "
                    f"plan ₹{u['plan'] / 100:.2f} shared by 30; one of each per student per week, 4 weeks"
                ),
            }
        )
    agreed = review.agreement()
    if agreed:
        numbers.append(
            {
                "label": "Photo diagnoses the teacher kept unchanged",
                "value": f"{agreed['agreed']} of {agreed['total']}",
                "n": agreed["total"],
                "method": "every teacher review since the last reset; a correction replaces the AI's verdict",
            }
        )
    results = settings.data_dir / "evals" / "results.json"
    if results.exists():
        numbers += json.loads(results.read_text(encoding="utf-8")).get("numbers", [])
    load = settings.data_dir / "evals" / "load.json"
    if load.exists():
        data = json.loads(load.read_text(encoding="utf-8"))
        a, pg = data.get("answers"), data.get("pages")
        if a:
            numbers.append(
                {
                    "label": "Answers under load (p50 / p95, errors)",
                    "value": f"{a['p50_ms']} ms / {a['p95_ms']} ms, {a['errors']} errors",
                    "n": a["requests"],
                    "method": f"{data['students']} simulated students answering at once through the rules path "
                    f"({a['rps']} requests/s over {a['wall_s']} s); own class, tagged revision, 1 instance",
                    "kind": "load",
                }
            )
        if pg:
            numbers.append(
                {
                    "label": "Notebook pages read 6 at a time under load",
                    "value": f"{pg['pages'] - pg['errors']}/{pg['pages']} read, p95 {pg['p95_s']} s",
                    "n": pg["pages"],
                    "method": f"{pg['pages']} photos sent 6 at a time on a no-traffic revision with 1 instance; "
                    f"{pg['gemini_calls']} model calls, the rest were repeats served from the cache, so this tests "
                    "the API and the queue, not model throughput",
                    "kind": "load",
                }
            )
    return {
        "numbers": numbers,
        "links": {
            "app": settings.public_app_url,
            "repo": settings.repo_url,
            "video": settings.video_url or None,
            "status_page": settings.status_page_url or None,
        },
    }


def worksheet(session_id: str, concept_id: str, tag: str) -> dict:
    """A printable sheet for the re-teach group: who, one worked example, practice, and a spot-the-mistake item."""
    topic = get_topic()
    if not topic.has_concept(concept_id) or tag not in topic.tags:
        raise ApiError(404, "worksheet_not_found", "Pick a concept and a mistake from this topic.")
    with get_conn() as conn:
        session = state.require_session(conn, session_id)
        students, _, _, _, analysis = state.analyse_class(conn, session_id)
    names = {s["id"]: s["nickname"] for s in students}
    who = sorted(names[s] for s in analysis.students_by_tag.get(concept_id, {}).get(tag, []) if s in names)
    concept, t = topic.concept(concept_id), topic.tag(tag)
    pool = topic.questions_for(concept_id, ("mcq", "text", "photo"))
    targeted = [q for q in pool if tag in q.distractor_tags or tag in q.wrong_answers.values()]
    items = (targeted + [q for q in pool if q not in targeted])[:6]
    example = next((q for q in targeted if q.kind == "photo"), targeted[0] if targeted else pool[0])
    wrong = next(
        (w for w, wt in example.wrong_answers.items() if wt == tag),
        next((o.text for o in example.options if o.tag == tag), None),
    )
    return {
        "class_name": session["class_name"],
        "concept_name": concept.name,
        "label": t.label(),
        "definition": t.definition,
        "students": who,
        "worked_example": example.method,
        "spot_the_mistake": {"question": example.stem, "student_answer": wrong} if wrong else None,
        "items": [{"question": q.stem, "answer": q.answer} for q in items],
    }
