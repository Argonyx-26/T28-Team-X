"""Seed on boot (Cloud Run's disk resets on every deploy): class 7B, 30 simulated students and Asha."""

from .agents import curator, simulator, state
from .db import get_conn, log_event, now, transaction
from .topic import get_topic

DEMO_CODE = "7B"
DEMO_SESSION_ID = "ses_7b"
ASHA_ID = "stu_asha_7b"
# Asha has practised the basics already, so the Examiner's first pick for her is C4 (adding fractions)
ASHA_HISTORY = [("Q01", True), ("Q04", True), ("Q05", True), ("Q09", True)]


def create_asha(conn) -> None:
    topic = get_topic()
    conn.execute(
        "INSERT INTO student (id, session_id, nickname, language, kind, created_at) "
        "VALUES (?, ?, 'Asha', 'kn', 'demo', ?)",
        (ASHA_ID, DEMO_SESSION_ID, now()),
    )
    for qid, ok in ASHA_HISTORY:
        q = topic.question(qid)
        state.record_response(
            conn, ASHA_ID, q, answer=q.answer, correct=ok, tag=None, source="key", confidence=1.0, phase="history"
        )


def seed() -> bool:
    """Idempotent. Returns True when it created the demo class."""
    topic = get_topic()
    curator.load_cache_file()
    with get_conn() as conn:
        if conn.execute("SELECT 1 FROM session WHERE id = ?", (DEMO_SESSION_ID,)).fetchone():
            return False
        with transaction(conn):
            conn.execute(
                "INSERT INTO session (id, code, class_name, topic_id, created_at) VALUES (?, ?, ?, ?, ?)",
                (DEMO_SESSION_ID, DEMO_CODE, "Class 7B · Fractions", topic.id, now()),
            )
            simulator.run(conn, DEMO_SESSION_ID, 30)
            create_asha(conn)
            log_event(
                conn,
                DEMO_SESSION_ID,
                "Examiner",
                "select_question",
                "Class 7B ready: 30 simulated students and Asha (demo student)",
            )
    return True


def reset() -> None:
    """Wipe everything except the LLM and lesson caches, then seed again."""
    with get_conn() as conn, transaction(conn):
        for table in ("response", "mastery", "gap", "agent_event", "recommendation", "student", "session"):
            conn.execute(f"DELETE FROM {table}")  # noqa: S608 - fixed table names
    seed()
