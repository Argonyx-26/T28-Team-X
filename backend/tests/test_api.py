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
    assert "ಛೇದ" in a["label"] and a["telemetry"] == [] and a["gap_open"]

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


def test_photo_of_a_different_problem_is_caught_and_not_saved(client):
    # the fake model reads 3/4 + 1/4 (P1); the teacher picked 2/3 + 1/6 (P2)
    before = client.get("/teacher/student", params={"student_id": ASHA_ID}).json()
    r = client.post(
        "/agents/diagnostician/photo",
        data={"student_id": ASHA_ID, "question_id": "P2"},
        files={"image": ("a.png", _png(), "image/png")},
    )
    assert r.status_code == 409 and r.json()["error"]["code"] == "wrong_problem"
    assert "3/4 + 1/4 = ?" in r.json()["error"]["message"]
    assert client.get("/teacher/student", params={"student_id": ASHA_ID}).json() == before


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
    audio = client.get(r["audio_url"])
    assert audio.status_code == 200 and audio.headers["content-type"] == "audio/mpeg"


def test_simulator_adds_students_without_llm(client):
    body = {"session_id": DEMO_SESSION_ID, "n": 5}
    assert client.post("/agents/simulator/run", json=body).status_code == 401
    r = client.post("/agents/simulator/run", json=body, headers={"X-Admin-Token": "secret"}).json()
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


def test_notebook_stack_reads_photos_in_parallel(client):
    ids = client.get("/teacher/dashboard", params={"session_id": DEMO_SESSION_ID}).json()["heatmap"]["students"][:3]
    files = [("images", (f"{i}.png", _png(), "image/png")) for i in range(3)]
    data = {"question_id": "P1", "student_ids": [s["id"] for s in ids]}
    r = client.post("/agents/diagnostician/stack", data=data, files=files).json()
    assert len(r["results"]) == 3 and all(x["error_step"] == 2 for x in r["results"])


def test_gap_open_is_reported_when_the_scan_opened_the_gap_first(client):
    # demo order: the teacher scans Asha's notebook (gap opens), then the judge answers wrong on her phone
    client.post(
        "/agents/diagnostician/photo",
        data={"student_id": ASHA_ID, "question_id": "P1"},
        files={"image": ("a.png", _png(), "image/png")},
    )
    n = client.post("/agents/examiner/next", json={"student_id": ASHA_ID}).json()
    a = client.post(
        "/agents/diagnostician/answer",
        json={
            "student_id": ASHA_ID,
            "question_id": n["question"]["id"],
            "answer": _wrong_option(client, n["question"]),
        },
    ).json()
    assert not a["gap_opened"] and a["gap_open"]


def test_photo_result_carries_rule_evidence(client):
    r = client.post(
        "/agents/diagnostician/photo",
        data={"student_id": ASHA_ID, "question_id": "P1"},
        files={"image": ("a.png", _png(), "image/png")},
    ).json()
    assert r["rule_check"]["status"] == "verified" and "4/8" in r["rule_check"]["note"]
    assert r["line_boxes"] == [[120, 80, 200, 520], [240, 80, 320, 700], [360, 80, 440, 420]]


def test_teacher_review_agree_and_correct(client):
    client.post(
        "/agents/diagnostician/photo",
        data={"student_id": ASHA_ID, "question_id": "P1"},
        files={"image": ("a.png", _png(), "image/png")},
    )
    body = {"student_id": ASHA_ID, "question_id": "P1"}
    assert client.post("/teacher/review", json={**body, "verdict": "agree"}).json()["ok"]
    changed = client.post(
        "/teacher/review", json={**body, "verdict": "change_tag", "tag": "unlike_denominators"}
    ).json()
    assert changed["misconception_tag"] == "unlike_denominators"
    fixed = client.post("/teacher/review", json={**body, "verdict": "mark_correct"}).json()
    assert fixed["correct"] and fixed["mastery_after"] >= 0.4
    d = client.get("/teacher/student", params={"student_id": ASHA_ID}).json()
    assert not [g for g in d["gaps"] if g["concept_id"] == "C4" and g["status"] == "open"]
    numbers = client.get("/judges/summary").json()["numbers"]
    assert any(n["label"].startswith("Photo diagnoses the teacher kept") and n["value"] == "1 of 3" for n in numbers)
    r = client.post("/teacher/review", json={**body, "verdict": "change_tag", "tag": "nope"})
    assert r.status_code == 422


def test_worksheet_for_the_reteach_group(client):
    r = client.get(
        "/teacher/worksheet", params={"session_id": DEMO_SESSION_ID, "concept_id": "C4", "tag": "add_denominators"}
    ).json()
    assert r["students"] and r["label"] == "added the denominators too" and len(r["items"]) == 6
    assert r["spot_the_mistake"]["student_answer"]
    assert (
        client.get(
            "/teacher/worksheet", params={"session_id": DEMO_SESSION_ID, "concept_id": "C9", "tag": "x"}
        ).status_code
        == 404
    )


def test_photo_diagnosis_no_vision_provider_returns_clear_error(client, monkeypatch):
    from app.config import settings

    j = client.post("/students/join", json={"code": "7B", "nickname": "Test", "language": "en"}).json()
    # Remove all provider config
    monkeypatch.setattr(settings, "gcp_project", "")
    monkeypatch.setattr(settings, "nebius_api_key", "")
    monkeypatch.setattr(settings, "nebius_vision_model", "")
    # demo_mode stays "live" so it tries to call providers

    r = client.post(
        "/agents/diagnostician/photo",
        data={"student_id": j["student_id"], "question_id": "P1"},
        files={"image": ("a.png", _png(), "image/png")},
    )
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "no_vision_provider"
    assert "vision provider" in r.json()["error"]["message"].lower()


def test_teacher_typed_answer_after_unreadable_photo_does_not_shorten_the_quiz(client):
    j = client.post("/students/join", json={"code": "7B", "nickname": "Ravi", "language": "en"}).json()
    sid = j["student_id"]
    a = client.post(
        "/agents/diagnostician/answer",
        json={"student_id": sid, "question_id": "P1", "answer": "4/8", "phase": "photo"},
    ).json()
    assert a["misconception_tag"] == "add_denominators" and a["source"] == "rule"
    n = client.post("/agents/examiner/next", json={"student_id": sid}).json()
    assert n["index"] == 1  # the teacher's typed answer counted as a photo reading, not as quiz question 1
    detail = client.get("/teacher/student", params={"student_id": sid}).json()
    assert detail["responses"][0]["phase"] == "photo"


def test_nickname_rules_and_class_cap(client, monkeypatch):
    from app.config import settings

    for bad, code in [("x", "nickname_too_short"), ("bolimaga", "nickname_not_allowed"), ("??", "nickname_characters")]:
        r = client.post("/students/join", json={"code": "7B", "nickname": bad, "language": "kn"})
        assert r.status_code == 422 and r.json()["error"]["code"] == code, bad
    ok = client.post("/students/join", json={"code": "7B", "nickname": "  Ravi   Kumar ", "language": "kn"}).json()
    assert ok["nickname"] == "Ravi Kumar"
    monkeypatch.setattr(settings, "max_students_per_class", 32)
    r = client.post("/students/join", json={"code": "7B", "nickname": "Meena", "language": "hi"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "class_full"
    # Asha always resumes, even in a full class
    assert client.post("/students/join", json={"code": "7B", "nickname": "Asha", "language": "hi"}).json()["resumed"]


def test_admin_remove_student_health_and_cache_export(client):
    j = client.post("/students/join", json={"code": "7B", "nickname": "Troll", "language": "en"}).json()
    r = client.post("/admin/remove-student", json={"student_id": j["student_id"]})
    assert r.status_code == 401
    headers = {"X-Admin-Token": "secret"}
    assert client.post("/admin/remove-student", json={"student_id": j["student_id"]}, headers=headers).json()["ok"]
    d = client.get("/teacher/dashboard", params={"session_id": DEMO_SESSION_ID}).json()
    assert all(s["nickname"] != "Troll" for s in d["heatmap"]["students"])
    r = client.post("/admin/remove-student", json={"student_id": ASHA_ID}, headers=headers)
    assert r.status_code == 409
    h = client.get("/admin/health", headers=headers).json()
    assert h["ok"] and h["demo_class"]["students"] == 31 and "llm" in h["cache"]
    client.post("/agents/analyst/analyze", json={"session_id": DEMO_SESSION_ID})
    rows = client.get("/admin/cache-export", headers=headers).json()["rows"]
    assert rows and {"key", "agent", "response_json"} <= set(rows[0])


def test_cache_seed_loads_at_boot(tmp_path, monkeypatch):
    import json

    from app import seed
    from app.config import settings
    from app.db import get_conn, init_db

    seed_file = tmp_path / "llm_cache_seed.jsonl"
    monkeypatch.setattr(settings, "llm_cache_seed", seed_file)
    seed_file.write_text(
        json.dumps({"key": "k1", "agent": "Coach", "provider": "vertex", "model": "m", "response_json": "{}"}) + "\n",
        encoding="utf-8",
    )
    real_data = settings.data_dir
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    (tmp_path / "fractions.json").write_bytes((real_data / "fractions.json").read_bytes())
    init_db()
    assert seed.load_cache_seed() == 1
    assert seed.load_cache_seed() == 0  # idempotent
    with get_conn() as conn:
        assert conn.execute("SELECT count(*) FROM llm_cache WHERE key = 'k1'").fetchone()[0] == 1


def test_cors_is_not_a_wildcard(client):
    r = client.options(
        "/health",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"},
    )
    assert r.headers.get("access-control-allow-origin") != "*"
    r = client.options(
        "/health",
        headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET"},
    )
    assert r.headers.get("access-control-allow-origin") == "http://localhost:3000"


def test_photo_of_a_problem_outside_the_bank(client):
    # the fake model transcribes 3/4 + 1/4 = (3+1)/(4+4) = 4/8; with question AUTO the first line is the problem
    r = client.post(
        "/agents/diagnostician/photo",
        data={"student_id": ASHA_ID, "question_id": "AUTO"},
        files={"image": ("a.png", _png(), "image/png")},
    ).json()
    assert r["question_id"] == "AUTO" and r["concept_id"] == "C4" and r["problem"] == "3/4 + 1/4"
    assert (
        r["error_step"] == 2
        and r["misconception_tag"] == "add_denominators"
        and r["reproduced_by"] == "add_denominators"
    )
    assert r["line_values"] == ["1", "1/2", "1/2"] and r["rule_check"]["status"] == "verified"
    assert r["verifier"]["reference"] == "1" and r["source"] == "vision+rule"
    d = client.get("/teacher/student", params={"student_id": ASHA_ID}).json()
    assert d["responses"][0]["question_id"] == "AUTO" and d["responses"][0]["stem"] == "3/4 + 1/4"


def test_homework_page_files_every_problem_under_the_child(client):
    r = client.post(
        "/agents/diagnostician/page",
        data={"student_id": ASHA_ID, "mode": "homework"},
        files={"image": ("hw.png", _png(), "image/png")},
    ).json()
    assert r["student_id"] == ASHA_ID and r["matched_by"] == "given" and r["saved"] and len(r["problems"]) == 3
    p1, p2, p3 = r["problems"]
    assert p1["question_id"] == "P1" and p1["error_step"] == 2 and p1["misconception_tag"] == "add_denominators"
    assert p2["question_id"] == "AUTO" and p2["problem"] == "2/5 + 1/3" and p2["reproduced_by"] == "add_denominators"
    assert p3["correct"] and p3["misconception_tag"] is None
    assert "ಛೇದ" in p1["label_local"] and p1["feedback_local"]  # Asha learns in Kannada
    assert r["summary"] == {"saved": 3, "wrong": 2, "gaps_opened": 1}
    events = client.get("/teacher/events", params={"session_id": DEMO_SESSION_ID}).json()["events"]
    hw = [e for e in events if e["action"] == "homework_page"]
    assert hw and hw[-1]["reason"].startswith("Homework · Asha (roll 1) · 3 problems · 2 wrong")
    d = client.get("/teacher/digest", params={"session_id": DEMO_SESSION_ID}).json()
    assert d["homework_pages"] == 1 and d["problems"] == 3 and d["wrong"] == 2 and d["new_gaps"] >= 1
    assert d["top_concepts"][0]["id"] == "C4"
    # the child now has a gap, so "Fix this now" has a lesson
    lesson = _lesson_ready(client, ASHA_ID)
    assert lesson["status"] == "ready" and lesson["lesson"]["concept_id"] == "C4"


def test_snap_page_is_filed_by_roll_number_or_comes_back_unassigned(client):
    r = client.post(
        "/agents/diagnostician/page",
        data={"session_id": DEMO_SESSION_ID, "mode": "snap"},
        files={"image": ("p.png", _png(), "image/png")},
    ).json()
    assert r["roll_no"] == 1 and r["matched_by"] == "roll" and r["student_id"] == ASHA_ID and r["saved"]
    events = client.get("/teacher/events", params={"session_id": DEMO_SESSION_ID}).json()["events"]
    assert any(e["reason"].startswith("Snap · Asha (roll 1) · 3 problems · 2 wrong") for e in events)
    # a page whose header matches nobody comes back unassigned; one tap files it (text only, no photo)
    other = client.post("/sessions/create", json={"class_name": "Snap test"}).json()
    r = client.post(
        "/agents/diagnostician/page",
        data={"session_id": other["session_id"], "mode": "snap"},
        files={"image": ("p.png", _png(), "image/png")},
    ).json()
    assert r["student_id"] is None and not r["saved"] and len(r["problems"]) == 3
    j = client.post(
        "/students/join", json={"code": other["code"], "nickname": "Ravi", "language": "hi", "roll_no": 4}
    ).json()
    filed = client.post(
        "/agents/diagnostician/page/file",
        json={"student_id": j["student_id"], "mode": "snap", "problems": r["problems"]},
    ).json()
    assert filed["summary"]["saved"] == 3 and filed["problems"][0]["label_local"].startswith("हर")
    # joining again with the same roll number resumes that child
    again = client.post(
        "/students/join", json={"code": other["code"], "nickname": "Ravi K", "language": "hi", "roll_no": 4}
    ).json()
    assert again["student_id"] == j["student_id"] and again["resumed"]
    d = client.get("/teacher/dashboard", params={"session_id": DEMO_SESSION_ID}).json()
    rolls = {s["nickname"]: s["roll_no"] for s in d["heatmap"]["students"]}
    assert rolls["Asha"] == 1 and sorted(v for v in rolls.values() if v) == list(range(1, 32))


def test_speak_returns_a_clip(client):
    r = client.post("/media/speak", json={"text": "ಸರಿ! ಚೆನ್ನಾಗಿದೆ.", "language": "kn"}).json()
    assert r["audio_url"].startswith("/media/voice?id=")
    audio = client.get(r["audio_url"])
    assert audio.status_code == 200 and audio.headers["content-type"] == "audio/mpeg"
