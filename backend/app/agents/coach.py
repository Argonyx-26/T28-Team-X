"""The Coach plans; the Analyst audits every plan against each student's answers with binding rules.

The Coach sees what a teacher's mark book shows (averages and gap counts). The Analyst sees who made which mistake.
That difference is why a first draft often gets challenged.
"""

import json
import re
from urllib.parse import quote

from .. import rules, voice
from ..db import get_conn, log_event, new_id, now, row, transaction
from ..errors import ApiError
from ..i18n import PARENT_TEMPLATE
from ..llm import prompts
from ..llm.providers import generate
from ..llm.schemas import CoachPlan, ParentMessageOut, RecommendationOut
from ..topic import get_topic
from . import state

AUDIENCES = {"whole_class", "reteach_group", "practice_group", "extend_group", "individuals"}
MAX_ROUNDS = 2


def _teacher_view(analysis) -> str:
    """What a mark book shows: averages and gap counts, but not which child made which mistake."""
    concepts = [
        {
            "concept_id": c.id,
            "name": c.name,
            "average_mastery_percent": None if c.avg is None else round(c.avg * 100),
            "open_gaps": c.open_gaps,
        }
        for c in analysis.concepts
    ]
    return json.dumps(
        {"class_size": analysis.n_students, "concepts": concepts, "focus_concept": analysis.focus_concept},
        ensure_ascii=False,
    )


def _audience_size(analysis, rec: dict) -> int:
    cid, tag, audience = rec.get("concept_id"), rec.get("misconception_tag"), rec.get("audience")
    showing = len(analysis.students_by_tag.get(cid, {}).get(tag, []))
    if audience == "whole_class":
        return analysis.n_students
    if audience in ("reteach_group", "individuals"):
        return showing or len(analysis.groups["reteach"])
    if audience == "practice_group":
        return len(analysis.groups["practice"]) if cid == analysis.focus_concept else analysis.n_students - showing
    if audience == "extend_group":
        return len(analysis.groups["extend"])
    return 0


def _names(text: str) -> str:
    """A teacher reads "Adding fractions", never "C5": concept ids the model copied from the summary become names."""
    topic = get_topic()
    return re.sub(
        r"\b(C\d{1,2})\b",
        lambda m: topic.concept(m.group(1)).name if topic.has_concept(m.group(1)) else m.group(1),
        text,
    )


def _normalize(recs: list[RecommendationOut] | list[dict], analysis, round_no: int, stage: str) -> list[dict]:
    topic = get_topic()
    out = []
    for r in recs[:2]:
        d = r.model_dump() if isinstance(r, RecommendationOut) else dict(r)
        d["audience"] = d.get("audience") if d.get("audience") in AUDIENCES else "whole_class"
        d["plan_5min"] = [_names(s.strip()) for s in d.get("plan_5min", []) if str(s).strip()]
        for key in ("headline", "worked_example", "why", "group_label"):
            if isinstance(d.get(key), str):
                d[key] = _names(d[key])
        cid, tag = d.get("concept_id"), d.get("misconception_tag")
        d["concept_name"] = topic.concept(cid).name if topic.has_concept(cid) else cid
        d["label"] = topic.tag(tag).label() if tag in topic.tags else tag
        d["n_students"] = _audience_size(analysis, d)
        d.update(
            {
                "id": new_id("rec"),
                "round": round_no,
                "stage": stage,
                "flagged": False,
                "analyst_note": None,
                "approved": False,
            }
        )
        out.append(d)
    return out


def _template_draft(analysis) -> list[dict]:
    topic = get_topic()
    cid = analysis.focus_concept or topic.concept_ids[0]
    stats = analysis.stats(cid)
    tag = stats.top[0][0] if stats and stats.top else "unclassified"
    concept = topic.concept(cid)
    return [
        {
            "audience": "whole_class",
            "group_label": "Whole class",
            "concept_id": cid,
            "misconception_tag": tag,
            "headline": f"Re-teach {concept.name.lower()} to the whole class tomorrow",
            "plan_5min": [
                f"Write one {concept.short.lower()} example on the board",
                "Ask the class to solve it on slates",
                "Show the correct method step by step",
                "Give two quick practice questions",
            ],
            "worked_example": next(q.method for q in topic.questions_for(cid)),
            "why": f"{concept.name} has the most open gaps in the class ({stats.open_gaps if stats else 0}).",
        }
    ]


def _template_revision(recs: list[dict], critiques: list[dict], analysis) -> list[dict]:
    topic = get_topic()
    out = []
    for rec, crit in zip(recs, critiques, strict=True):
        if crit["verdict"] == "accept":
            out.append(rec)
            continue
        cid = rec["concept_id"] if topic.has_concept(rec.get("concept_id")) else analysis.focus_concept
        cid = cid or topic.concept_ids[0]
        stats = analysis.stats(cid)
        tag = stats.top[0][0] if stats and stats.top else rec.get("misconception_tag")
        who = analysis.students_by_tag.get(cid, {}).get(tag, [])
        k, n = len(who), analysis.n_students
        concept, t = topic.concept(cid), topic.tag(tag)
        out.append(
            {
                "audience": "reteach_group",
                "group_label": f"Group A ({k} students)",
                "concept_id": cid,
                "misconception_tag": tag,
                "headline": f"Re-teach {concept.short.lower()} to the {k} students who {t.label()}",
                "plan_5min": [
                    "Seat Group A together at the front",
                    f"Show why '{t.label()}' gives the wrong answer",
                    "Work one example together, step by step",
                    "Each student solves one on their own",
                ],
                "worked_example": next(
                    (q.method for q in topic.questions_for(cid) if tag in q.distractor_tags),
                    topic.questions_for(cid)[0].method,
                ),
                "why": f"{k} of {n} students show '{t.label()}' on {concept.name}; the other {n - k} practise instead.",
            }
        )
    if len(out) == 1 and out[0]["audience"] == "reteach_group":
        cid = out[0]["concept_id"]
        others = analysis.n_students - len(analysis.students_by_tag.get(cid, {}).get(out[0]["misconception_tag"], []))
        out.append(
            {
                "audience": "practice_group",
                "group_label": f"Group B ({others} students)",
                "concept_id": cid,
                "misconception_tag": out[0]["misconception_tag"],
                "headline": f"Group B practises 3 mixed {topic.concept(cid).short.lower()} items",
                "plan_5min": [
                    "Hand out 3 practice items",
                    "Students check answers in pairs",
                    "The teacher checks one answer per pair",
                ],
                "worked_example": topic.questions_for(cid)[1].method,
                "why": "They already avoid this mistake, so practice keeps them moving while Group A is re-taught.",
            }
        )
    return out


async def analyze(session_id: str) -> dict:
    topic = get_topic()
    with get_conn() as conn:
        state.require_session(conn, session_id)
        students, _, _, _, analysis = state.analyse_class(conn, session_id)
    if not students:
        raise ApiError(409, "no_students", "No students have joined this class yet.")
    run_id = new_id("run")
    telemetry: list[dict] = []
    steps: list[dict] = []
    focus = analysis.focus_concept
    with get_conn() as conn, transaction(conn):
        fs = analysis.stats(focus) if focus else None
        top = f"; top mistake {fs.top[0][0]} ({fs.top[0][1]} students)" if fs and fs.top else ""
        log_event(
            conn,
            session_id,
            "Analyst",
            "analyze_class",
            f"{analysis.n_students} students · focus {focus} {topic.concept(focus).name if focus else ''}: "
            f"{fs.open_gaps if fs else 0} open gaps{top}",
        )

    tag_list = "\n".join(
        f"- {t.tag} (say: '{t.label()}'): {t.definition}" for t in topic.tags.values() if t.tag != "unclassified"
    )
    plan, tel = await generate(
        "Coach",
        "propose",
        prompts.COACH_PROPOSE,
        f"Class summary:\n{_teacher_view(analysis)}\n\nAllowed tags:\n{tag_list}",
        CoachPlan,
        validate=lambda p: 0 < len(p.recommendations) <= 2,
    )
    telemetry += tel
    recs = _normalize(plan.recommendations if plan else _template_draft(analysis), analysis, 0, "draft")
    source = "llm" if plan else "template"
    steps.append({"round": 0, "agent": "Coach", "action": "propose", "recommendations": recs, "source": source})
    with get_conn() as conn, transaction(conn):
        for r in recs:
            kind = "Draft" if plan else "Draft (built-in template)"
            log_event(conn, session_id, "Coach", "propose", f"{kind}: {r['headline']} ({r['group_label']})", None, tel)

    round_no = 0
    while True:
        critiques = []
        for i in range(len(recs)):
            verdict, reason = rules.critique(topic, analysis, recs, i)
            critiques.append({"index": i, "verdict": verdict, "reason": reason})
        steps.append({"round": round_no, "agent": "Analyst", "action": "critique", "critiques": critiques})
        with get_conn() as conn, transaction(conn):
            for c in critiques:
                action = "accept" if c["verdict"] == "accept" else "challenge"
                log_event(conn, session_id, "Analyst", action, f"Plan {c['index'] + 1}: {c['reason']}")
        if all(c["verdict"] == "accept" for c in critiques) or round_no == MAX_ROUNDS:
            break
        round_no += 1
        groups = {k: len(v) for k, v in analysis.groups.items()}
        review = json.dumps(
            {
                "plans": [
                    {
                        k: r[k]
                        for k in (
                            "audience",
                            "group_label",
                            "concept_id",
                            "misconception_tag",
                            "headline",
                            "plan_5min",
                            "worked_example",
                            "why",
                        )
                    }
                    for r in recs
                ],
                "analyst_verdicts": critiques,
                "learner_groups_on_focus_concept": groups,
                "students_showing_each_mistake": {
                    cid: {t: len(s) for t, s in tags.items()} for cid, tags in analysis.students_by_tag.items()
                },
                "class_size": analysis.n_students,
            },
            ensure_ascii=False,
        )
        plan, tel = await generate(
            "Coach",
            "revise",
            prompts.COACH_REVISE,
            f"{review}\n\nAllowed tags:\n{tag_list}",
            CoachPlan,
            validate=lambda p: 0 < len(p.recommendations) <= 2,
        )
        telemetry += tel
        revised = plan.recommendations if plan else _template_revision(recs, critiques, analysis)
        recs = _normalize(revised, analysis, round_no, "revised")
        source = "llm" if plan else "template"
        steps.append(
            {"round": round_no, "agent": "Coach", "action": "revise", "recommendations": recs, "source": source}
        )
        with get_conn() as conn, transaction(conn):
            for r in recs:
                kind = "Revised" if plan else "Revised (built-in template)"
                log_event(
                    conn, session_id, "Coach", "revise", f"{kind}: {r['headline']} ({r['group_label']})", None, tel
                )

    final = []
    with get_conn() as conn, transaction(conn):
        for rec, crit in zip(recs, critiques, strict=True):
            flagged = crit["verdict"] != "accept"
            item = {
                **rec,
                "id": new_id("rec"),
                "stage": "final",
                "flagged": flagged,
                "analyst_note": crit["reason"],
                "approved": False,
            }
            payload = {k: v for k, v in item.items() if k not in ("id", "stage", "flagged", "analyst_note", "approved")}
            conn.execute(
                "INSERT INTO recommendation (id, session_id, run_id, payload_json, stage, flagged, analyst_note, "
                "created_at) VALUES (?, ?, ?, ?, 'final', ?, ?, ?)",
                (
                    item["id"],
                    session_id,
                    run_id,
                    json.dumps(payload, ensure_ascii=False),
                    int(flagged),
                    crit["reason"],
                    now(),
                ),
            )
            if flagged:
                log_event(
                    conn,
                    session_id,
                    "Analyst",
                    "flag_for_teacher",
                    f"Still failing after {MAX_ROUNDS} rounds: {crit['reason']}",
                )
            final.append(item)
    return {"run_id": run_id, "rounds": round_no, "steps": steps, "final": final, "telemetry": telemetry}


def approve(recommendation_id: str) -> dict:
    with get_conn() as conn, transaction(conn):
        rec = row(conn, "SELECT * FROM recommendation WHERE id = ?", (recommendation_id,))
        if not rec:
            raise ApiError(404, "recommendation_not_found", "That plan doesn't exist.")
        if rec["approved_at"] is None:
            conn.execute("UPDATE recommendation SET approved_at = ? WHERE id = ?", (now(), recommendation_id))
            headline = json.loads(rec["payload_json"]).get("headline", "")
            log_event(conn, rec["session_id"], "Teacher", "approve", f"Approved: {headline}")
    return {"ok": True}


async def parent_message(student_id: str) -> dict:
    topic = get_topic()
    with get_conn() as conn:
        student = state.require_student(conn, student_id)
        gap = state.top_open_gap(conn, student_id)
        last = row(conn, "SELECT concept_id FROM response WHERE student_id = ? ORDER BY id DESC LIMIT 1", (student_id,))
        good = row(
            conn,
            "SELECT concept_id FROM response WHERE student_id = ? AND correct = 1 ORDER BY id DESC LIMIT 1",
            (student_id,),
        )
    language = student["language"]
    cid = (gap or last or {"concept_id": topic.concept_ids[0]})["concept_id"]
    concept = topic.concept(cid)
    tag = gap["tag"] if gap else None
    example = next(
        (q.method for q in topic.questions_for(cid) if tag and tag in q.distractor_tags),
        topic.questions_for(cid)[0].method,
    )
    facts = {
        "child_name": student["nickname"],
        "practised": concept.name,
        "did_well_on": topic.concept(good["concept_id"]).name if good else None,
        "help_at_home_with": topic.tag(tag).definition if tag else f"more practice on {concept.name}",
        "one_example_of_the_right_method": example,
        "target_language": prompts.LANGUAGE_NAMES.get(language, "English"),
    }
    result, telemetry = await generate(
        "Coach",
        "parent_message",
        prompts.PARENT,
        json.dumps(facts, ensure_ascii=False),
        ParentMessageOut,
        route=("vertex", "vertex_alt", "nebius") if language in ("kn", "hi") else ("nebius", "vertex", "vertex_alt"),
        validate=lambda m: rules.is_in_language(m.message, language),
    )
    if result:
        message = result.message.strip()
    else:
        message = PARENT_TEMPLATE.get(language, PARENT_TEMPLATE["en"]).format(
            name=student["nickname"],
            concept=concept.name_in(language),
            focus=concept.name_in(language),
            example=example,
        )
    session_id, nickname = student["session_id"], student["nickname"]

    def voice_done(tel: dict) -> None:
        what = "ready" if tel["ok"] else "failed; the text message still works"
        with get_conn() as conn, transaction(conn):
            log_event(
                conn, session_id, "Coach", "voice_note", f"Voice note for {nickname}'s parent {what}", student_id, [tel]
            )

    audio_url = voice.voice_note(message, language, voice_done)
    with get_conn() as conn, transaction(conn):
        log_event(
            conn,
            student["session_id"],
            "Coach",
            "parent_message",
            f"Parent message for {student['nickname']} in {language} about {concept.short}",
            student_id,
            telemetry,
        )
    return {
        "language": language,
        "message": message,
        "whatsapp_url": f"https://wa.me/?text={quote(message)}",
        "audio_url": audio_url,
        "telemetry": telemetry,
    }
