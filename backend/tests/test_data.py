"""The question bank is checked by arithmetic, not by eye."""

from fractions import Fraction

import pytest

from app.fraction_math import parse_answer
from app.topic import get_topic

TOPIC = get_topic()


def _eval(expr: str) -> Fraction:
    return eval(expr, {"__builtins__": {}}, {"F": Fraction, "max": max, "min": min})  # noqa: S307 - our own data


@pytest.mark.parametrize("q", TOPIC.questions, ids=lambda q: q.id)
def test_answer_matches_expression(q):
    if q.expr:
        assert parse_answer(q.answer).value == _eval(q.expr)


@pytest.mark.parametrize("q", [q for q in TOPIC.questions if q.kind == "mcq"], ids=lambda q: q.id)
def test_mcq_has_one_correct_option_and_tagged_distractors(q):
    correct = [o for o in q.options if o.correct]
    assert len(correct) == 1 and correct[0].text == q.answer
    texts = [o.text for o in q.options]
    assert len(texts) == len(set(texts))
    answer = parse_answer(q.answer)
    for o in q.options:
        if o.correct:
            continue
        assert o.tag in TOPIC.tags
        value = parse_answer(o.text)
        if answer and value and o.tag != "not_fully_simplified":
            assert value.value != answer.value, f"{q.id}: distractor {o.text} equals the answer"


@pytest.mark.parametrize("q", [q for q in TOPIC.questions if q.kind in ("text", "photo")], ids=lambda q: q.id)
def test_typed_wrong_answers_are_wrong_and_unambiguous(q):
    answer = parse_answer(q.answer).value
    seen: dict[Fraction, str] = {}
    for wrong, tag in q.wrong_answers.items():
        assert tag in TOPIC.tags
        value = parse_answer(wrong).value
        assert value != answer, f"{q.id}: wrong answer {wrong} equals the answer"
        assert seen.setdefault(value, tag) == tag, f"{q.id}: {wrong} maps to two tags"


def test_every_concept_has_enough_questions_for_quiz_and_retry():
    for c in TOPIC.concepts:
        assert len(TOPIC.questions_for(c.id)) >= 4, c.id
    assert {q.id for q in TOPIC.questions if q.kind == "photo"} == {"P1", "P2", "P3", "P4"}


def test_labels_exist_in_three_languages():
    for t in TOPIC.tags.values():
        assert set(t.labels) >= {"en", "hi", "kn"}, t.tag
    for c in TOPIC.concepts:
        assert set(c.names) >= {"hi", "kn"}, c.id
