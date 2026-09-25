"""The cases a careful reviewer tried against the checker and the API. Each one was wrong once; none may come back."""

import io
from fractions import Fraction as F

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import rules
from app.agents import curator, diagnostician
from app.config import settings
from app.llm.schemas import PhotoDiagnosis
from app.main import app
from app.seed import ASHA_ID, DEMO_SESSION_ID
from app.topic import get_topic
from app.verifier import parse_value, verify

from .conftest import CALLS


@pytest.fixture
def client():
    curator._jobs.clear()
    curator._last_telemetry.clear()
    curator._announced.clear()
    with TestClient(app) as c:
        yield c


def _png(size=(1600, 900)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, "white").save(buf, format="PNG")
    return buf.getvalue()


# ---------- the checker ----------


def test_side_working_only_has_to_be_true_in_itself():
    v = verify(["1/2 + 1/3", "LCM of 2 and 3 = 6", "1/2 = 3/6", "1/3 = 2/6", "= 3/6 + 2/6", "= 5/6"])
    assert v.correct and v.status == "verified"
    v = verify(["1/2 + 1/3", "1/2 = 3/6", "1/3 = 3/6", "= 3/6 + 2/6", "= 5/6"])
    assert not v.correct and v.error_step == 3 and v.evidence == "Line 3 isn't true: 1/3 is not equal to 3/6."


def test_division_by_a_fraction_and_by_zero():
    assert verify(["4 ÷ 1/2", "= 4 × 2", "= 8"]).correct
    v = verify(["4 ÷ 1/2", "= 4 × 1/2", "= 2"])
    assert v.error_step == 2 and v.tag == "divide_no_flip"
    v = verify(["3/4 + 1/4", "= 4/0"])
    assert v.correct is False and v.error_step == 2 and "divides by zero" in v.evidence


def test_fractions_as_phones_and_fonts_write_them():
    assert parse_value("1½") == F(3, 2) and parse_value("¾") == F(3, 4) and parse_value("2⁄3") == F(2, 3)
    assert verify(["1½ + 1/4", "= 7/4"]).correct


def test_a_word_problem_outside_the_bank_is_left_to_the_model():
    v = verify(["Riya ate 1/4 of a pizza and Sam ate 2/4. How much did they eat?", "1/4 + 2/4 = 3/4"])
    assert v.status == "checked" and v.correct is None


def test_what_the_question_asks_for_is_checked():
    assert verify(["Simplify 6/8", "= 3/4"]).correct
    v = verify(["Simplify 12/16", "= 6/8"])
    assert v.tag == "not_fully_simplified" and v.evidence == "6/8 equals 3/4 but is not in simplest form."
    assert verify(["Write 7/4 as a mixed number", "= 1 3/4"]).correct
    v = verify(["Write 7/4 as a mixed number", "= 7/4"])
    assert v.correct is False and v.evidence == "The question asks for a mixed number."
    assert verify(["Convert 2 1/3 to an improper fraction", "= 7/3"]).correct
    assert verify(["2/3 = ?/12", "= 8/12"]).correct and verify(["2/3 = 8/?", "= 8/12"]).correct


def test_dates_and_problem_numbers_are_not_maths():
    v = verify(["Date: 12/9/25", "Roll no 14", "3/4 + 1/4", "= 4/8"])
    assert v.reference == "1" and v.tag == "add_denominators"
    assert verify(["12/09/2025", "1/2 + 1/4", "= 3/4"]).correct
    for first in ("iii) 3/5 + 1/5", "iv. 3/5 + 1/5", "(ii) 3/5 + 1/5"):
        v = verify([first, "= 4/5"])
        assert v.correct and v.reference == "4/5", first


def test_a_mistake_is_named_only_when_a_rule_writes_what_the_child_wrote():
    # 2/4 has the value adding the denominators gives (4/8), but not its written form
    v = verify(["3/4 + 1/4", "= 2/4"], reference=F(1))
    assert v.correct is False and v.tag is None and v.reproduced_by is None


def test_comparisons_are_checked_as_written():
    v = verify(["Compare 3/5 and 5/8", "3/5 > 5/8"])
    assert v.correct is False and v.error_step == 2 and v.evidence == "Line 2 isn't true: 3/5 is smaller than 5/8."
    assert verify(["Compare 3/5 and 5/8", "3/5 < 5/8"]).status == "checked"
    v = verify(["Which is bigger, 3/5 or 5/8?", "3/5 = 24/40", "5/8 = 25/40", "5/8 is bigger"])
    assert v.status == "checked" and v.reference is None
    v = verify(["Which is bigger, 3/5 or 5/8?", "3/5 = 24/40", "5/8 = 24/40", "3/5 is bigger"])
    assert v.correct is False and v.error_step == 3


def test_loosely_written_boxes_still_circle_the_right_line():
    loose = ["280,95,350, 531],    ", "381,133,446,766]", "464,144,539,399]"]
    assert diagnostician.line_boxes(loose, 3) == [[280, 95, 350, 531], [381, 133, 446, 766], [464, 144, 539, 399]]
    together = ["[280,95,350,531], [381,133,446,766]; 464,144,539,399 (answer)"]
    assert diagnostician.line_boxes(together, 3) == diagnostician.line_boxes(loose, 3)
    assert diagnostician.line_boxes(["1,2,3"], 1) is None


# ---------- typed answers ----------


@pytest.mark.parametrize(
    ("qid", "typed", "right"),
    [
        ("Q04", "3", True),
        ("Q04", "2/3", True),  # the whole fraction for "2/?"
        ("Q04", "4/6 = 2/3", True),
        ("Q12", "15/20", True),  # the whole fraction for "?/20"
        ("Q16", "3/5+1/5=4/5", True),  # the sum written out
        ("Q16", "⅘", True),
        ("Q21", "3/4 > 5/8", True),
        ("Q21", "5/8 < 3/4", True),
        ("Q21", "5/8 > 3/4", False),  # the child says 5/8 is bigger
        ("Q25", "1½", True),
        ("Q29", "5/6 ÷ 5/12 = 2", True),
    ],
)
def test_typed_answers_are_read_as_meant(qid, typed, right):
    assert rules.grade_exact(get_topic().question(qid), typed) is right


# ---------- the API ----------


def test_the_same_photo_twice_is_counted_once(client):
    body = {"student_id": ASHA_ID, "question_id": "P1"}
    first = client.post("/agents/diagnostician/photo", data=body, files={"image": ("a.png", _png(), "image/png")})
    again = client.post("/agents/diagnostician/photo", data=body, files={"image": ("a.png", _png(), "image/png")})
    assert first.status_code == again.status_code == 200
    assert again.json()["repeat"] and again.json()["mastery_after"] == first.json()["mastery_after"]
    assert [c for c in CALLS if c[0] == "PhotoDiagnosis"] == [("PhotoDiagnosis", "image")]


def test_a_huge_image_is_refused_before_it_is_decoded(client, monkeypatch):
    monkeypatch.setattr(diagnostician, "MAX_PIXELS", 1_000_000)
    r = client.post(
        "/agents/diagnostician/photo",
        data={"student_id": ASHA_ID, "question_id": "P1"},
        files={"image": ("big.png", _png((2000, 1000)), "image/png")},
    )
    assert r.status_code == 413 and r.json()["error"]["code"] == "image_too_large"


def test_photos_are_only_for_photo_problems(client):
    r = client.post(
        "/agents/diagnostician/photo",
        data={"student_id": ASHA_ID, "question_id": "Q01"},
        files={"image": ("a.png", _png(), "image/png")},
    )
    assert r.status_code in (404, 422)


def test_bad_inputs_are_refused_plainly(client):
    assert client.post("/sessions/create", json={"class_name": "   "}).status_code == 422
    for hours in (0, 100000):
        r = client.get("/teacher/digest", params={"session_id": DEMO_SESSION_ID, "hours": hours})
        assert r.status_code == 422
    same = [{"question_id": "Q16", "answer": "4/5"}, {"question_id": "Q16", "answer": "4/5"}]
    r = client.post("/agents/examiner/retry", json={"student_id": ASHA_ID, "answers": same})
    assert r.status_code == 422 and r.json()["error"]["code"] == "repeated_question"
    client.post(
        "/agents/diagnostician/photo",
        data={"student_id": ASHA_ID, "question_id": "P1"},
        files={"image": ("a.png", _png(), "image/png")},
    )
    r = client.post("/teacher/review", json={"student_id": ASHA_ID, "question_id": "P1", "verdict": "change_step"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "no_step"
    r = client.post(
        "/agents/diagnostician/page/file",
        json={"student_id": ASHA_ID, "problems": [{"steps": ["x" * 201]}]},
    )
    assert r.status_code == 422


def test_approving_twice_logs_once(client):
    final = client.post("/agents/analyst/analyze", json={"session_id": DEMO_SESSION_ID}).json()["final"][0]
    for _ in range(2):
        assert client.post("/teacher/approve", json={"recommendation_id": final["id"]}).json() == {"ok": True}
    feed = client.get("/teacher/events", params={"session_id": DEMO_SESSION_ID}).json()["events"]
    assert sum(1 for e in feed if e["action"] == "approve") == 1


def test_the_demo_samples_are_answered_from_the_saved_cache(monkeypatch):
    """The sample pages on the scan screen must come from the committed cache, never a live call on stage. If this
    fails, a prompt changed: warm the live API and save the cache again (python -m app.tools cache-seed <api>)."""
    monkeypatch.setattr(settings, "llm_cache_seed", settings.data_dir / "llm_cache_seed.jsonl")
    samples = settings.data_dir.parent / "frontend" / "public" / "samples"
    with TestClient(app) as c:
        d = c.get("/teacher/dashboard", params={"session_id": DEMO_SESSION_ID}).json()
        who = {s["nickname"].lower(): s["id"] for s in d["heatmap"]["students"]}
        for name, qid, file in [
            ("asha", "P1", "asha-p1-photo.jpg"),
            ("asha", "P2", "asha-p2-photo.jpg"),
            ("asha", "P3", "asha-p3-photo.jpg"),
            ("rahul", "P3", "rahul-p3.jpg"),
            ("meera", "P4", "meera-p4.jpg"),
        ]:
            r = c.post(
                "/agents/diagnostician/photo",
                data={"student_id": who.get(name, ASHA_ID), "question_id": qid},
                files={"image": (file, (samples / file).read_bytes(), "image/jpeg")},
            ).json()
            assert all(t.get("cached") for t in r["telemetry"]), f"{file} is not in the saved cache"
    assert not [x for x in CALLS if x[0] == "PhotoDiagnosis"]


# ---------- found by the live audit ----------


def test_a_bank_problem_needs_the_same_operation_not_just_the_same_fractions():
    from app.agents.pages import diagnose_problem, match_bank

    assert match_bank("3/4 - 1/4") is None and match_bank("3/4 x 1/4") is None and match_bank("2/3 - 1/6") is None
    assert match_bank("1/4 + 3/4").id == "P1" and match_bank("Q1) 3/4 + 1/4 = ?").id == "P1"
    right = diagnose_problem(["2) 3/4 - 1/4 = 2/4 = 1/2"], None, None)
    assert right["correct"] and right["question_id"] == "AUTO"
    right = diagnose_problem(["2/3 - 1/6", "= 4/6 - 1/6", "= 3/6 = 1/2"], "unlike_denominators", 2)
    assert right["correct"]


def test_a_problem_copied_out_with_no_answer_is_not_marked():
    from app.agents.pages import diagnose_problem

    for lines in (
        ["5/6 - 1/6 ="],
        ["5/6 - 1/6", "= ?"],
        ["5/6 - 1/6", "= 4/"],
        ["Simplify 6/8"],
        ["3/4 + 1/4", "LCM = 4"],
    ):
        assert verify(lines).status == "unanswered", lines
        out = diagnose_problem(lines, None, None)
        assert not out["correct"] and out["needs_typed_answer"] and out["unanswered"], lines


def test_whole_number_slips_are_not_fraction_gaps():
    from app.agents.pages import diagnose_problem

    out = diagnose_problem(["1) 12 x 3 = 38"], "careless_arithmetic", 1)
    assert out["not_fractions"] and out["needs_typed_answer"] and out["misconception_tag"] is None
    assert out["correct"] is False and "isn't saved" in out["rule_check"]["note"]


def test_a_thumbnail_is_refused_instead_of_guessed(client):
    r = client.post(
        "/agents/diagnostician/photo",
        data={"student_id": ASHA_ID, "question_id": "P1"},
        files={"image": ("tiny.png", _png((48, 64)), "image/png")},
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "image_too_small"


def test_the_coach_writes_concept_names_not_ids():
    from app.agents.coach import _names

    assert _names("Raise C4 mastery") == f"Raise {get_topic().concept('C4').name} mastery"


def test_the_answer_mark_and_an_unreadable_last_line():
    from app.agents.pages import diagnose_problem

    # "//" after a final answer is a classroom mark, not part of the number
    out = diagnose_problem(["Q2) 3/5 + 1/5", "⇒ (3+1)/5", "⇒ 5/5 //"], None, None)
    assert not out["correct"] and out["error_step"] == 3 and out["misconception_tag"] == "careless_arithmetic"
    assert diagnose_problem(["Q2) 3/4 ÷ 1/2", "⇒ 3/4 × 2/1 ⇒ 6/4 ⇒ 3/2 //"], None, None)["correct"]
    # a last line we can't read is never taken as a right answer by the arithmetic
    v = verify(["3/5 + 1/5", "= 4/5", "⇒ (3+1) 15"])
    assert v.status == "unverified" and v.correct is None


def test_a_story_written_over_two_lines_is_still_the_bank_problem():
    from app.agents.pages import diagnose_problem

    out = diagnose_problem(
        ["Q1) A cake needs 3/4 cup of sugar.", "How much sugar for 2 cakes?", "= 2 + 3/4 = 2 3/4 cups"], None, None
    )
    assert out["question_id"] == "P4" and out["misconception_tag"] == "word_problem_operation"


def test_every_way_the_model_writes_line_boxes_gives_a_circle():
    from app.agents.pages import diagnose_problem

    # corner to corner with dashes, several in one string
    dashed = diagnostician.line_boxes(diagnostician.box_groups(["100,43-118,369;197,43-219,796;200,652-218,796"]), 3)
    assert dashed == [[100, 43, 118, 369], [197, 43, 219, 796], [200, 652, 218, 796]]
    # one box around the whole problem: cut into evenly ruled rows, top to bottom
    out = diagnose_problem(["Q1) 3/4 + 1/4", "= (3+1)/(4+4)", "= 4/8"], None, None, ["79,16,319,854"])
    assert out["line_boxes"] == [[79, 16, 159, 854], [159, 16, 239, 854], [239, 16, 319, 854]]
    assert diagnostician.split_block("79,16,90,854", 4) == []  # too thin to hold four lines
    # one box that is really the first line's alone (the model stopped early) is never cut: no circle beats a wrong one
    first_line_only = ["280,95,350, 531],    "]
    assert diagnose_problem(["3/4 + 1/4", "= (3+1)/(4+4)", "= 4/8"], None, None, first_line_only)["line_boxes"] is None
    photo = PhotoDiagnosis(
        steps=["3/4 + 1/4", "= (3+1)/(4+4)", "= 4/8"],
        final_answer_read="4/8",
        correct=False,
        error_step=2,
        misconception_tag="add_denominators",
        confidence=0.9,
        feedback_student="",
        boxes=first_line_only,
    )
    assert diagnostician.combine(get_topic().question("P1"), photo, photo.steps)["line_boxes"] is None


def test_a_page_read_one_line_per_problem_is_put_back_together():
    from app.agents.pages import diagnose_problem, join_continued
    from app.llm.schemas import PageRead

    read = PageRead(
        problems=["Q1) 2/3 + 1/6", "= 4/6 + 1/6", "=> 5/6", "Q2) 3/5 + 1/5", "=> (3+1)/5", "=> 5/5 //"],
        tags=["", "", "", "", "", "careless_arithmetic"],
        error_steps=[0, 0, 0, 0, 0, 1],
        boxes=[
            "94,36,160,683",
            "200,36,290,739",
            "300,530,380,739",
            "400,20,470,504",
            "480,68,550,560",
            "560,460,640,590",
        ],
    )
    joined = join_continued(read)
    assert [len(lines) for lines, *_ in joined] == [3, 3]
    lines, tag, step, boxes = joined[1]
    assert tag == "careless_arithmetic" and step == 3 and len(boxes) == 3
    out = diagnose_problem(lines, tag, step, boxes)
    assert out["error_step"] == 3 and out["line_boxes"][2] == [560, 460, 640, 590]
    assert diagnose_problem(*joined[0])["correct"]


def test_a_fill_in_the_blank_keeps_its_blank_in_the_title():
    from app.agents.pages import diagnose_problem

    out = diagnose_problem(["Q3) 2/3 = ?/6", "= (2+3)/(3+3)", "= 5/6"], None, None)
    assert out["problem"] == "2/3 = ?/6" and out["misconception_tag"] == "equivalence_additive"
