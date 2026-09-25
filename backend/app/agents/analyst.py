"""The Analyst's read side: the class dashboard, the agent feed, one student's detail and the judges' numbers."""

import json
import statistics

from ..config import settings
from ..db import get_conn, row, rows
from ..topic import get_topic
from . import state


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
                {"id": s["id"], "nickname": s["nickname"], "kind": s["kind"], "language": s["language"]}
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


def student_detail(student_id: str) -> dict:
    topic = get_topic()
    with get_conn() as conn:
        s = state.require_student(conn, student_id)
        mastery = state.mastery_map(conn, student_id)
        gaps = rows(conn, "SELECT concept_id, status, tag FROM gap WHERE student_id = ?", (student_id,))
        resp = rows(
            conn,
            "SELECT question_id, answer, correct, tag, source, phase, created_at, concept_id "
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
                "stem": (topic.question(r["question_id"]).stem if topic.question(r["question_id"]) else ""),
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
        real = conn.execute(
            "SELECT count(*), count(DISTINCT r.student_id) FROM response r JOIN student s ON s.id = r.student_id "
            "WHERE s.kind = 'real'"
        ).fetchone()
        numbers.append(
            {
                "label": "Answers from real students",
                "value": str(real[0]),
                "n": real[1],
                "method": "live count; excludes the 30 simulated students and the demo student",
            }
        )
        closed = conn.execute(
            "SELECT count(*) FROM gap g JOIN student s ON s.id = g.student_id "
            "WHERE s.kind = 'real' AND g.status = 'closed'"
        ).fetchone()[0]
        opened = conn.execute(
            "SELECT count(*) FROM gap g JOIN student s ON s.id = g.student_id WHERE s.kind = 'real'"
        ).fetchone()[0]
        if opened:
            numbers.append(
                {
                    "label": "Gaps closed by real students",
                    "value": f"{closed} of {opened}",
                    "n": opened,
                    "method": "a gap closes only when both retry items are right (exact grading)",
                }
            )
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
                "method": "measured server-side on live calls",
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
    results = settings.data_dir / "evals" / "results.json"
    if results.exists():
        numbers += json.loads(results.read_text(encoding="utf-8")).get("numbers", [])
    return {
        "numbers": numbers,
        "links": {
            "app": settings.public_app_url,
            "repo": settings.repo_url,
            "video": settings.video_url or None,
            "status_page": settings.status_page_url or None,
        },
    }
