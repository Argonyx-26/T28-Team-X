"""SQLite storage. One connection per request; WAL so the dashboard can read while answers are written."""

import json
import sqlite3
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime

from .config import settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, class_name TEXT NOT NULL, topic_id TEXT NOT NULL, created_at TEXT
);
CREATE TABLE IF NOT EXISTS student (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, nickname TEXT NOT NULL, language TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'real', created_at TEXT
);
CREATE INDEX IF NOT EXISTS student_session ON student(session_id);
CREATE TABLE IF NOT EXISTS mastery (
  student_id TEXT NOT NULL, concept_id TEXT NOT NULL, value REAL NOT NULL, PRIMARY KEY (student_id, concept_id)
);
CREATE TABLE IF NOT EXISTS response (
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL, question_id TEXT NOT NULL, concept_id TEXT NOT NULL,
  answer TEXT, correct INTEGER NOT NULL, tag TEXT, source TEXT, confidence REAL, error_step INTEGER,
  phase TEXT NOT NULL, created_at TEXT
);
CREATE INDEX IF NOT EXISTS response_student ON response(student_id);
CREATE TABLE IF NOT EXISTS gap (
  student_id TEXT NOT NULL, concept_id TEXT NOT NULL, status TEXT NOT NULL, tag TEXT,
  opened_at TEXT, closed_at TEXT, PRIMARY KEY (student_id, concept_id)
);
CREATE TABLE IF NOT EXISTS agent_event (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, ts TEXT NOT NULL, agent TEXT NOT NULL,
  action TEXT NOT NULL, reason TEXT NOT NULL, student_id TEXT, telemetry_json TEXT
);
CREATE INDEX IF NOT EXISTS event_session ON agent_event(session_id, seq);
CREATE TABLE IF NOT EXISTS recommendation (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, run_id TEXT NOT NULL, payload_json TEXT NOT NULL,
  stage TEXT NOT NULL, flagged INTEGER NOT NULL DEFAULT 0, analyst_note TEXT, approved_at TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS llm_cache (
  key TEXT PRIMARY KEY, agent TEXT, provider TEXT, model TEXT, response_json TEXT NOT NULL, created_at TEXT
);
CREATE TABLE IF NOT EXISTS review (
  id INTEGER PRIMARY KEY AUTOINCREMENT, response_id INTEGER NOT NULL, student_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  verdict TEXT NOT NULL, ai_tag TEXT, teacher_tag TEXT, ai_step INTEGER, teacher_step INTEGER, created_at TEXT
);
CREATE TABLE IF NOT EXISTS lesson_cache (key TEXT PRIMARY KEY, payload_json TEXT NOT NULL, created_at TEXT);
"""


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def connect() -> sqlite3.Connection:
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(settings.db_path, timeout=5, check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """Short write transactions only. Never await an LLM inside one."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise


MIGRATIONS = [
    # problems outside the bank (question_id AUTO) keep the problem as read from the page
    "ALTER TABLE response ADD COLUMN stem TEXT",
    # the roll number written at the top of a page files it under the right child (F2 snap mode)
    "ALTER TABLE student ADD COLUMN roll_no INTEGER",
]


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(SCHEMA)
        for sql in MIGRATIONS:
            try:
                conn.execute(sql)
            except sqlite3.OperationalError:
                pass  # already applied


def rows(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> list[dict]:
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def row(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> dict | None:
    r = conn.execute(sql, params).fetchone()
    return dict(r) if r else None


def log_event(
    conn: sqlite3.Connection,
    session_id: str,
    agent: str,
    action: str,
    reason: str,
    student_id: str | None = None,
    telemetry: list[dict] | None = None,
) -> None:
    conn.execute(
        "INSERT INTO agent_event (session_id, ts, agent, action, reason, student_id, telemetry_json) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (session_id, now(), agent, action, reason[:240], student_id, json.dumps(telemetry or [])),
    )
