"""The demo path end to end through HTTP, offline."""

import io
import time

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.agents import curator
from app.main import app
from app.seed import ASHA_ID, DEMO_SESSION_ID

from .conftest import CALLS


@pytest.fixture
def client():
    curator._jobs.clear()
    curator._last_telemetry.clear()
    curator._announced.clear()
    with TestClient(app) as c:
        yield c


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (1600, 900), "white").save(buf, format="PNG")
    return buf.getvalue()


def _wrong_option(client, question) -> str:
    from app.topic import get_topic

    q = get_topic().question(question["id"])
    return next(o.text for o in q.options if o.tag == "add_denominators")


def _lesson_ready(client, student_id):
    for _ in range(100):
        r = client.post("/agents/curator/lesson", json={"student_id": student_id}).json()
        if r["status"] != "generating":
            return r
        time.sleep(0.02)
    raise AssertionError("lesson never became ready")


def test_health_topic_and_seeded_dashboard(client):
    h = client.get("/health").json()
    assert h["ok"] and h["providers"] == {"nebius": True, "vertex": True}
    assert client.get("/health").headers["cache-control"] == "no-store"
    t = client.get("/topic").json()
    assert len(t["concepts"]) == 8 and [p["id"] for p in t["photo_questions"]] == ["P1", "P2", "P3", "P4"]
    lookup = client.get("/sessions/lookup", params={"code": "7b"}).json()
    assert lookup["session_id"] == DEMO_SESSION_ID and lookup["n_students"] == 31
    d = client.get("/teacher/dashboard", params={"session_id": DEMO_SESSION_ID}).json()
    assert d["n_students"] == 31 and d["n_simulated"] == 30
    assert d["focus_concept"] == "C4"
    c4 = next(c for c in d["concepts"] if c["id"] == "C4")
    assert c4["top"][0]["tag"] == "add_denominators"
    assert len(d["heatmap"]["cells"]) == 31 and all(len(row) == 8 for row in d["heatmap"]["cells"])
    assert d["gaps"]["open"] > 0 and d["gaps"]["closed"] > 0
    assert CALLS == []  # seeding the simulated class used no LLM


def test_asha_demo_loop_closes_the_gap(client):
    j = client.post("/students/join", json={"code": "7B", "nickname": "asha", "language": "en"}).json()
    assert j["student_id"] == ASHA_ID and j["language"] == "kn"
    n = client.post("/agents/examiner/next", json={"student_id": ASHA_ID}).json()
    assert not n["done"] and n["question"]["concept_id"] == "C4" and n["question"]["kind"] == "mcq"
    a = client.post(
        "/agents/diagnostician/answer",
        json={
            "student_id": ASHA_ID,
            "question_id": n["question"]["id"],
            "answer": _wrong_option(client, n["question"]),
        },
    ).json()
    assert a["misconception_tag"] == "add_denominators" and a["source"] == "key" and a["gap_opened"]
    assert "ಛೇದ" in a["label"] and a["telemetry"] == []

    lesson = _lesson_ready(client, ASHA_ID)
    assert lesson["status"] == "ready" and lesson["lesson"]["language"] == "kn" and lesson["lesson"]["translated"]
    assert len(lesson["retry"]) == 2 and all(r["id"] != n["question"]["id"] for r in lesson["retry"])

    from app.topic import get_topic

    answers = [{"question_id": r["id"], "answer": get_topic().question(r["id"]).answer} for r in lesson["retry"]]
    result = client.post("/agents/examiner/retry", json={"student_id": ASHA_ID, "answers": answers}).json()
    assert result["gap_closed"] and result["mastery_after"] >= 0.6

    events = client.get("/teacher/events", params={"session_id": DEMO_SESSION_ID}).json()["events"]
    actions = [e["action"] for e in events]
    for expected in ("select_question", "diagnose", "lesson", "retry", "gap_closed"):
        assert expected in actions


def test_double_tap_counts_once(client):
    j = client.post("/students/join", json={"code": "7B", "nickname": "Ravi", "language": "hi"}).json()
    n = client.post("/agents/examiner/next", json={"student_id": j["student_id"]}).json()
    body = {"student_id": j["student_id"], "question_id": n["question"]["id"], "answer": n["question"]["options"][0]}
    first = client.post("/agents/diagnostician/answer", json=body).json()
    second = client.post("/agents/diagnostician/answer", json=body).json()
    assert first["correct"] == second["correct"]
    nxt = client.post("/agents/examiner/next", json={"student_id": j["student_id"]}).json()
    assert nxt["index"] == 2


def test_unfamiliar_typed_answer_goes_to_the_llm(client):
    j = client.post("/students/join", json={"code": "7B", "nickname": "Meena", "language": "en"}).json()
    a = client.post(
        "/agents/diagnostician/answer", json={"student_id": j["student_id"], "question_id": "Q16", "answer": "5/7"}
    ).json()
    assert a["source"] == "llm" and a["misconception_tag"] == "careless_arithmetic" and not a["correct"]
    assert a["telemetry"][0]["provider"] == "nebius" and a["telemetry"][0]["cost_paise"] > 0


def test_photo_diagnosis_circles_the_wrong_step(client):
    r = client.post(
        "/agents/diagnostician/photo",
        data={"student_id": ASHA_ID, "question_id": "P1"},
        files={"image": ("a.png", _png(), "image/png")},
    ).json()
    assert r["error_step"] == 2 and r["misconception_tag"] == "add_denominators" and not r["needs_typed_answer"]
    assert r["label"] == "added the denominators too" and r["telemetry"][0]["provider"] == "vertex"
    d = client.get("/teacher/dashboard", params={"session_id": DEMO_SESSION_ID}).json()
    asha = [s["id"] for s in d["heatmap"]["students"]].index(ASHA_ID)
    assert d["heatmap"]["cells"][asha][3] == 0.3  # C4 turned red


def test_bad_photo_is_a_friendly_error(client):
    r = client.post(
        "/agents/diagnostician/photo",
        data={"student_id": ASHA_ID, "question_id": "P1"},
        files={"image": ("a.png", b"not an image", "image/png")},
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "not_an_image"


def test_analyst_vetoes_then_coach_revises_then_teacher_approves(client):
    r = client.post("/agents/analyst/analyze", json={"session_id": DEMO_SESSION_ID}).json()
    kinds = [(s["agent"], s["action"]) for s in r["steps"]]
    assert kinds[:4] == [("Coach", "propose"), ("Analyst", "critique"), ("Coach", "revise"), ("Analyst", "critique")]
    challenge = r["steps"][1]["critiques"][0]
    assert challenge["verdict"] == "revise" and challenge["reason"].startswith("Only ")
    assert r["steps"][3]["critiques"][0]["verdict"] == "accept"
    final = r["final"][0]
    assert final["audience"] == "reteach_group" and not final["flagged"]
    assert client.post("/teacher/approve", json={"recommendation_id": final["id"]}).json() == {"ok": True}
    d = client.get("/teacher/dashboard", params={"session_id": DEMO_SESSION_ID}).json()
    assert d["recommendations"][0]["approved"]


def test_parent_message_in_kannada(client):
    r = client.post("/agents/coach/parent-message", json={"student_id": ASHA_ID}).json()
    assert r["language"] == "kn" and r["whatsapp_url"].startswith("https://wa.me/?text=")


def test_simulator_adds_students_without_llm(client):
    r = client.post("/agents/simulator/run", json={"session_id": DEMO_SESSION_ID, "n": 5}).json()
    assert r["students_added"] == 5 and r["llm_calls"] == 0
    assert CALLS == []


def test_errors_have_one_shape(client):
    r = client.post("/agents/examiner/next", json={"student_id": "nobody"})
    assert r.status_code == 404 and r.json()["error"]["code"] == "student_not_found"
    r = client.post("/students/join", json={"code": "ZZZ", "nickname": "x", "language": "en"})
    assert r.status_code == 404 and r.json()["error"]["code"] == "class_not_found"
    r = client.post("/students/join", json={"code": "7B", "nickname": "", "language": "en"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_request"
    assert client.post("/admin/reset").status_code == 401
    assert client.post("/admin/reset", headers={"X-Admin-Token": "secret"}).json() == {"ok": True}


def test_cached_demo_mode_needs_no_provider(client, monkeypatch):
    from app.config import settings

    j = client.post("/students/join", json={"code": "7B", "nickname": "Kiran", "language": "en"}).json()
    monkeypatch.setattr(settings, "demo_mode", "cached")
    a = client.post(
        "/agents/diagnostician/answer", json={"student_id": j["student_id"], "question_id": "Q16", "answer": "5/7"}
    ).json()
    assert a["source"] == "template" and a["misconception_tag"] == "unclassified"
    r = client.post("/agents/analyst/analyze", json={"session_id": DEMO_SESSION_ID}).json()
    assert r["steps"][1]["critiques"][0]["verdict"] == "revise" and r["final"]
    assert CALLS == []
