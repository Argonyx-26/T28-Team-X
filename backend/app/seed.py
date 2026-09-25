"""Seed on boot (Cloud Run's disk resets on every deploy): class 7B, 30 simulated students and Asha."""

import json
import logging

from .agents import curator, simulator, state
from .config import settings
from .db import get_conn, log_event, now, transaction
from .topic import get_topic

log = logging.getLogger("gurugraph.seed")

DEMO_CODE = "7B"
DEMO_SESSION_ID = "ses_7b"
ASHA_ID = "stu_asha_7b"
DEMO_SCHOOL_ID = "demo"
# two more simulated classes in the same school, so the school view has something to compare (F6)
SIBLING_CLASSES = [("ses_7a", "7A", "Class 7A · Fractions"), ("ses_7c", "7C", "Class 7C · Fractions")]
# Asha has practised the basics already, so the Examiner's first pick for her is C4 (adding fractions)
ASHA_HISTORY = [("Q01", True), ("Q04", True), ("Q05", True), ("Q09", True)]


def create_asha(conn) -> None:
    topic = get_topic()
    conn.execute(
        "INSERT INTO student (id, session_id, nickname, language, kind, created_at, roll_no) "
        "VALUES (?, ?, 'Asha', 'kn', 'demo', ?, 1)",
        (ASHA_ID, DEMO_SESSION_ID, now()),
    )
    for qid, ok in ASHA_HISTORY:
        q = topic.question(qid)
        state.record_response(
            conn, ASHA_ID, q, answer=q.answer, correct=ok, tag=None, source="key", confidence=1.0, phase="history"
        )


def load_cache_seed() -> int:
    """Loads data/llm_cache_seed.jsonl (the demo-critical AI answers) into the LLM cache when it is missing them, so a
    fresh deploy starts warm. The UI still marks these answers "cached"."""
    path = settings.llm_cache_seed
    if not path.exists():
        return 0
    n = 0
    with get_conn() as conn, transaction(conn):
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            cur = conn.execute(
                "INSERT OR IGNORE INTO llm_cache (key, agent, provider, model, response_json, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (r["key"], r.get("agent"), r.get("provider"), r.get("model"), r["response_json"], r.get("created_at")),
            )
            n += cur.rowcount
    if n:
        log.info("loaded %d cached AI answers from the seed", n)
    return n


def assign_roll_numbers(conn, session_id: str, start: int = 1) -> None:
    """Roll numbers in class-list order for students who have none (a page's header files it under the right child)."""
    taken = {
        r[0]
        for r in conn.execute("SELECT roll_no FROM student WHERE session_id = ? AND roll_no IS NOT NULL", (session_id,))
    }
    n = start
    for (sid,) in conn.execute(
        "SELECT id FROM student WHERE session_id = ? AND roll_no IS NULL ORDER BY created_at, rowid", (session_id,)
    ).fetchall():
        while n in taken:
            n += 1
        conn.execute("UPDATE student SET roll_no = ? WHERE id = ?", (n, sid))
        taken.add(n)


def seed() -> bool:
    """Idempotent. Returns True when it created the demo class."""
    topic = get_topic()
    curator.load_cache_file()
    load_cache_seed()
    with get_conn() as conn:
        if conn.execute("SELECT 1 FROM session WHERE id = ?", (DEMO_SESSION_ID,)).fetchone():
            return False
        with transaction(conn):
            conn.execute(
                "INSERT INTO session (id, code, class_name, topic_id, created_at, school_id) VALUES (?, ?, ?, ?, ?, ?)",
                (DEMO_SESSION_ID, DEMO_CODE, "Class 7B · Fractions", topic.id, now(), DEMO_SCHOOL_ID),
            )
            simulator.run(conn, DEMO_SESSION_ID, 30)
            assign_roll_numbers(conn, DEMO_SESSION_ID, start=2)
            create_asha(conn)
            for sid, code, name in SIBLING_CLASSES:
                conn.execute(
                    "INSERT INTO session (id, code, class_name, topic_id, created_at, school_id) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (sid, code, name, topic.id, now(), DEMO_SCHOOL_ID),
                )
                simulator.run(conn, sid, 30)
                assign_roll_numbers(conn, sid)
            log_event(
                conn,
                DEMO_SESSION_ID,
                "Examiner",
                "select_question",
                "Class 7B ready: 30 simulated students and Asha (demo student)",
            )
    return True


def reset() -> None:
    """Wipe the demo classes (7A, 7B, 7C and anything in the sample school), then seed them again. Other classes, the
    LLM cache and the lesson cache stay. The Curator's in-memory notes about who was
    already told about a lesson go too, or a fresh Asha's lesson would never show in the feed."""
    curator._jobs.clear()
    curator._last_telemetry.clear()
    curator._announced.clear()
    from .agents import diagnostician

    diagnostician._recent.clear()
    demo = (DEMO_SESSION_ID, *(sid for sid, _, _ in SIBLING_CLASSES))
    # only the demo classes: a class a visitor made on their own phone keeps working through a demo reset
    sessions = f"SELECT id FROM session WHERE id IN ({', '.join('?' * len(demo))}) OR school_id = ?"
    students = f"SELECT id FROM student WHERE session_id IN ({sessions})"
    args = (*demo, DEMO_SCHOOL_ID)
    with get_conn() as conn, transaction(conn):
        for table in ("review", "response", "mastery", "gap"):
            conn.execute(f"DELETE FROM {table} WHERE student_id IN ({students})", args)  # noqa: S608 - fixed names
        for table in ("agent_event", "recommendation", "student"):
            conn.execute(f"DELETE FROM {table} WHERE session_id IN ({sessions})", args)  # noqa: S608 - fixed names
        conn.execute(f"DELETE FROM session WHERE id IN ({sessions})", args)  # noqa: S608 - fixed names
    seed()
