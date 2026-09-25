from fractions import Fraction

from app import rules
from app.fraction_math import parse_answer
from app.topic import get_topic

TOPIC = get_topic()


def test_parse_forms():
    assert parse_answer("3/4").value == Fraction(3, 4)
    assert parse_answer(" 3 / 4 ").value == Fraction(3, 4)
    assert parse_answer("1 1/2").value == Fraction(3, 2)
    assert parse_answer("= 2 3/4 cups").value == Fraction(11, 4)
    assert parse_answer("0.6/2").value == Fraction(3, 10)
    assert parse_answer("1.5").value == Fraction(3, 2)
    assert parse_answer("4 kg").value == 4
    assert parse_answer("-1 1/2").value == Fraction(-3, 2)
    assert parse_answer("5/0") is None
    assert parse_answer("idk") is None


def test_simplest_form():
    assert parse_answer("3/5").simplest
    assert not parse_answer("6/10").simplest
    assert not parse_answer("0.6/2").simplest
    assert parse_answer("1.5").simplest
    assert parse_answer("1 1/2").simplest
    assert not parse_answer("1 2/4").simplest


def test_mastery_is_clamped_and_rounded():
    assert rules.update_mastery(0.5, True) == 0.65
    assert rules.update_mastery(0.5, False) == 0.3
    assert rules.update_mastery(0.95, True) == 1.0
    assert rules.update_mastery(0.1, False) == 0.0


def test_gap_opens_only_for_tagged_wrong_answers_below_threshold():
    assert rules.opens_gap(False, "add_denominators", 0.3)
    assert not rules.opens_gap(False, "add_denominators", 0.45)
    assert not rules.opens_gap(False, "unclassified", 0.1)
    assert not rules.opens_gap(True, None, 0.1)


def test_mcq_diagnosis_uses_the_answer_key():
    q = TOPIC.question("Q13")
    assert rules.diagnose_mcq(q, "2/3").correct
    d = rules.diagnose_mcq(q, "2/6")
    assert not d.correct and d.tag == "add_denominators" and d.source == "key"
    assert rules.diagnose_mcq(q, "7/9") is None


def test_typed_diagnosis_rules_first():
    q16 = TOPIC.question("Q16")
    assert rules.diagnose_typed(q16, "4/5").correct
    assert rules.diagnose_typed(q16, "8/10").correct  # equal value, simplest form not required
    assert rules.diagnose_typed(q16, "4/10").tag == "add_denominators"
    assert rules.diagnose_typed(q16, "2/5").tag == "add_denominators"  # 4/10 simplified
    assert rules.diagnose_typed(q16, "3/7") is None  # unknown: goes to the LLM
    assert rules.diagnose_typed(q16, "no idea").tag == "unclassified"
    q08 = TOPIC.question("Q08")
    assert rules.diagnose_typed(q08, "6/10").tag == "not_fully_simplified"
    assert rules.diagnose_typed(q08, "3/5").correct
    p1 = TOPIC.question("P1")
    assert rules.diagnose_typed(p1, "4/8").tag == "add_denominators"
    assert rules.diagnose_typed(p1, "1").correct


def test_llm_tags_are_validated():
    assert rules.validate_llm_tag(TOPIC, "made_up_tag", 0.9) == ("unclassified", 0.49)
    assert rules.validate_llm_tag(TOPIC, "add_denominators", 0.3) == ("unclassified", 0.3)
    assert rules.validate_llm_tag(TOPIC, "add_denominators", 0.87) == ("add_denominators", 0.87)


def test_examiner_starts_at_the_root_and_respects_prerequisites():
    q, reason = rules.pick_next(TOPIC, {}, {}, set())
    assert q.concept_id == "C1" and q.kind == "mcq"
    assert "C1" in reason
    mastery = {"C1": 0.8, "C2": 0.65, "C3": 0.65}
    asked = {"C1": 2, "C2": 1, "C3": 1}
    q, _ = rules.pick_next(TOPIC, mastery, asked, {"Q01", "Q02", "Q05", "Q09"})
    assert q.concept_id == "C4"


def test_examiner_alternates_mcq_then_typed_on_a_concept():
    q, _ = rules.pick_next(TOPIC, {}, {"C1": 1}, {"Q01"})
    assert q.concept_id == "C1" and q.kind == "text"


def test_retry_prefers_unseen_items_targeting_the_same_mistake():
    items = rules.pick_retry(TOPIC, "C4", "add_denominators", {"Q13"})
    assert len(items) == 2
    assert all(q.concept_id == "C4" and q.id != "Q13" for q in items)
    assert "add_denominators" in items[0].distractor_tags


def test_options_are_shuffled_stably_per_student():
    q = TOPIC.question("Q14")
    a = rules.shuffled_options(q, "s1")
    assert a == rules.shuffled_options(q, "s1")
    assert sorted(a) == sorted(o.text for o in q.options)


def test_script_check():
    assert rules.is_in_language("ಛೇದವನ್ನೂ ಕೂಡಿಸಿದ್ದೀರಿ (denominator)", "kn")
    assert not rules.is_in_language("You added the denominators", "kn")
    assert rules.is_in_language("हर को भी जोड़ दिया", "hi")


def _class(n_add=9, n_other=21):
    students = [f"a{i}" for i in range(n_add)] + [f"o{i}" for i in range(n_other)]
    mastery = {s: {"C4": 0.1 if s.startswith("a") else 0.8} for s in students}
    responses = [
        {"student_id": s, "concept_id": "C4", "correct": False, "tag": "add_denominators", "phase": "quiz"}
        for s in students
        if s.startswith("a")
    ]
    responses += [
        {"student_id": s, "concept_id": "C4", "correct": True, "tag": None, "phase": "quiz"}
        for s in students
        if s.startswith("o")
    ]
    gaps = [
        {"student_id": s, "concept_id": "C4", "status": "open", "tag": "add_denominators"}
        for s in students
        if s.startswith("a")
    ]
    return students, mastery, responses, gaps


def test_analyst_aggregation_and_focus():
    a = rules.aggregate(TOPIC, *_class())
    assert a.focus_concept == "C4"
    c4 = a.stats("C4")
    assert c4.responders == 30 and c4.open_gaps == 9 and c4.top[0] == ("add_denominators", 9)
    assert len(a.groups["reteach"]) == 9 and len(a.groups["extend"]) == 21


def test_analyst_vetoes_a_whole_class_plan_with_numbers():
    a = rules.aggregate(TOPIC, *_class())
    rec = {
        "concept_id": "C4",
        "misconception_tag": "add_denominators",
        "audience": "whole_class",
        "plan_5min": ["a", "b", "c"],
        "worked_example": "3/4 + 1/4 = 4/4 = 1",
    }
    verdict, reason = rules.critique(TOPIC, a, [rec], 0)
    assert verdict == "revise" and reason.startswith("Only 9 of 30 students")
    rec["audience"] = "reteach_group"
    verdict, reason = rules.critique(TOPIC, a, [rec], 0)
    assert verdict == "accept" and "9 of 30" in reason


def test_analyst_rejects_plans_without_evidence_or_too_long():
    a = rules.aggregate(TOPIC, *_class())
    base = {
        "concept_id": "C4",
        "misconception_tag": "add_denominators",
        "audience": "reteach_group",
        "plan_5min": ["a", "b", "c"],
        "worked_example": "x",
    }
    assert rules.critique(TOPIC, a, [{**base, "concept_id": "C99"}], 0)[0] == "revise"
    assert rules.critique(TOPIC, a, [{**base, "misconception_tag": "divide_no_flip"}], 0)[0] == "revise"
    assert rules.critique(TOPIC, a, [{**base, "plan_5min": list("abcdef")}], 0)[0] == "revise"
    assert rules.critique(TOPIC, a, [{**base, "worked_example": " "}], 0)[0] == "revise"


def test_simulator_is_deterministic_and_uses_preferred_mistakes():
    q = TOPIC.question("Q14")
    rng = rules.stable_rng("x")
    assert rules.simulate_answer(rng, q, 0.0, "add_denominators") == "2/6"
    assert rules.simulate_answer(rules.stable_rng("y"), q, 1.0, None) == "3/4"
    t = TOPIC.question("Q17")
    assert rules.simulate_answer(rules.stable_rng("z"), t, 0.0, "unlike_denominators") == "1/6"
