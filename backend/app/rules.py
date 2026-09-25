"""Deterministic rules. The LLM never decides mastery, the next question, grading, gaps or the Analyst's verdicts."""

import hashlib
import random
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from .fraction_math import parse_answer
from .topic import CONCEPTUAL_EXCLUDED, Question, Topic

START_MASTERY = 0.5
GAP_BELOW = 0.4
READY_AT = 0.6
EXTEND_AT = 0.7
CLOSED_MASTERY = 0.6
PER_CONCEPT = 2


def stable_rng(*parts: str) -> random.Random:
    seed = int(hashlib.sha256("|".join(parts).encode()).hexdigest()[:16], 16)
    return random.Random(seed)


# ---------- mastery and gaps ----------


def update_mastery(value: float, correct: bool) -> float:
    value = value + 0.15 if correct else value - 0.20
    return round(min(1.0, max(0.0, value)), 3)


def opens_gap(correct: bool, tag: str | None, mastery_after: float) -> bool:
    return not correct and bool(tag) and tag != "unclassified" and mastery_after < GAP_BELOW


def closed_mastery(value: float) -> float:
    return max(value, CLOSED_MASTERY)


# ---------- diagnosis (rules first) ----------


@dataclass
class RuleDiagnosis:
    correct: bool
    tag: str | None
    source: str  # "key" | "rule"
    confidence: float


def diagnose_mcq(question: Question, answer: str) -> RuleDiagnosis | None:
    option = question.option(answer)
    if option is None:
        return None
    if option.correct:
        return RuleDiagnosis(True, None, "key", 1.0)
    return RuleDiagnosis(False, option.tag or "unclassified", "key", 1.0)


def diagnose_typed(question: Question, answer: str) -> RuleDiagnosis | None:
    """Rules for a typed answer. None means the rules can't tell and the LLM should look at it."""
    parsed = parse_answer(answer)
    if parsed is None:
        return RuleDiagnosis(False, "unclassified", "rule", 0.3)
    expected = parse_answer(question.answer)
    if expected is not None and parsed.value == expected.value:
        if question.simplest and not parsed.simplest:
            return RuleDiagnosis(False, "not_fully_simplified", "rule", 0.95)
        return RuleDiagnosis(True, None, "rule", 1.0)
    for wrong, tag in question.wrong_answers.items():
        known = parse_answer(wrong)
        if known is not None and known.value == parsed.value:
            return RuleDiagnosis(False, tag, "rule", 0.95)
    return None


def grade_exact(question: Question, answer: str) -> bool:
    """Retry grading: exact, no LLM."""
    if question.kind == "mcq":
        option = question.option(answer)
        return bool(option and option.correct)
    diagnosis = diagnose_typed(question, answer)
    return bool(diagnosis and diagnosis.correct)


def validate_llm_tag(topic: Topic, tag: str | None, confidence: float) -> tuple[str, float]:
    if not tag or tag not in topic.tags or confidence < 0.5:
        return "unclassified", round(min(confidence, 0.49), 2)
    return tag, round(confidence, 2)


# ---------- the Examiner ----------


def shuffled_options(question: Question, student_id: str) -> list[str]:
    texts = [o.text for o in question.options]
    stable_rng(student_id, question.id).shuffle(texts)
    return texts


def ready_concepts(topic: Topic, mastery: dict[str, float]) -> list[str]:
    return [c.id for c in topic.concepts if all(mastery.get(p, START_MASTERY) >= READY_AT for p in c.prereqs)]


def _first_unseen(topic: Topic, concept_id: str, seen: set[str], asked_here: int, kinds: tuple[str, ...]):
    pool = [q for q in topic.questions_for(concept_id, kinds) if q.id not in seen]
    if not pool:
        return None
    # alternate: the first question on a concept is multiple choice, the second is typed when there is one
    preferred = "text" if asked_here % 2 == 1 else "mcq"
    return next((q for q in pool if q.kind == preferred), pool[0])


def pick_next(
    topic: Topic,
    mastery: dict[str, float],
    asked: dict[str, int],
    seen: set[str],
    kinds: tuple[str, ...] = ("mcq", "text"),
) -> tuple[Question, str] | None:
    order = {cid: i for i, cid in enumerate(topic.concept_ids)}

    def candidates(concept_ids):
        out = []
        for cid in concept_ids:
            if asked.get(cid, 0) >= PER_CONCEPT:
                continue
            q = _first_unseen(topic, cid, seen, asked.get(cid, 0), kinds)
            if q:
                out.append((mastery.get(cid, START_MASTERY), order[cid], cid, q))
        return sorted(out)

    ready = ready_concepts(topic, mastery)
    pool = candidates(ready)
    fallback = False
    if not pool:
        pool = candidates(topic.concept_ids)
        fallback = True
    if not pool:
        return None
    value, _, cid, question = pool[0]
    concept = topic.concept(cid)
    prereqs = ", ".join(f"{p} {mastery.get(p, START_MASTERY):.2f}" for p in concept.prereqs) or "none"
    if fallback:
        reason = f"{cid} {concept.short}: no ready concept left to test, so checking the lowest remaining ({value:.2f})"
    else:
        reason = f"{cid} {concept.short} has the lowest ready mastery ({value:.2f}); prerequisites: {prereqs}"
    return question, reason


def pick_retry(topic: Topic, concept_id: str, tag: str | None, seen: set[str], n: int = 2) -> list[Question]:
    """Retry items always come from the verified bank, never from the LLM."""
    mcqs = [q for q in topic.questions_for(concept_id, ("mcq",))]
    texts = [q for q in topic.questions_for(concept_id, ("text",))]
    ranked: list[Question] = []
    ranked += [q for q in mcqs if q.id not in seen and tag in q.distractor_tags]
    ranked += [q for q in texts if q.id not in seen and tag in q.wrong_answers.values()]
    ranked += [q for q in mcqs + texts if q.id not in seen]
    ranked += [q for q in mcqs + texts]
    out: list[Question] = []
    for q in ranked:
        if q not in out:
            out.append(q)
        if len(out) == n:
            break
    return out


# ---------- the Analyst ----------


@dataclass
class ConceptStats:
    id: str
    name: str
    short: str
    avg: float | None
    responders: int
    below_gap: int
    open_gaps: int
    top: list[tuple[str, int]]
    slips: int
    affected_by_tag: dict[str, int]


@dataclass
class ClassAnalysis:
    n_students: int
    concepts: list[ConceptStats]
    focus_concept: str | None
    groups: dict[str, list[str]]
    gaps_open: int
    gaps_closed: int
    students_by_tag: dict[str, dict[str, list[str]]] = field(default_factory=dict)

    @property
    def gap_rate(self) -> float:
        total = self.gaps_open + self.gaps_closed
        return round(self.gaps_closed / total, 3) if total else 0.0

    def stats(self, concept_id: str) -> ConceptStats | None:
        return next((c for c in self.concepts if c.id == concept_id), None)


def aggregate(
    topic: Topic,
    student_ids: list[str],
    mastery: dict[str, dict[str, float]],
    responses: list[dict],
    gaps: list[dict],
) -> ClassAnalysis:
    """responses: {student_id, concept_id, correct, tag, phase}; gaps: {student_id, concept_id, status, tag}."""
    n = len(student_ids)
    answered: dict[str, set[str]] = defaultdict(set)
    showing: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    slips: dict[str, set[str]] = defaultdict(set)
    for r in responses:
        answered[r["concept_id"]].add(r["student_id"])
        if r["correct"] or not r["tag"] or r.get("phase") == "retry":
            continue
        if r["tag"] in CONCEPTUAL_EXCLUDED:
            slips[r["concept_id"]].add(r["student_id"])
        else:
            showing[r["concept_id"]][r["tag"]].add(r["student_id"])
    open_by_concept = Counter(g["concept_id"] for g in gaps if g["status"] == "open")

    stats = []
    for c in topic.concepts:
        who = answered.get(c.id, set())
        values = [mastery.get(s, {}).get(c.id, 0.5) for s in who]
        by_tag = {t: len(s) for t, s in showing[c.id].items()}
        top = sorted(by_tag.items(), key=lambda kv: (-kv[1], kv[0]))[:3]
        stats.append(
            ConceptStats(
                id=c.id,
                name=c.name,
                short=c.short,
                avg=round(sum(values) / len(values), 3) if values else None,
                responders=len(who),
                below_gap=sum(1 for v in values if v < GAP_BELOW),
                open_gaps=open_by_concept.get(c.id, 0),
                top=top,
                slips=len(slips[c.id]),
                affected_by_tag=by_tag,
            )
        )

    focus = _focus_concept(stats, n)
    groups: dict[str, list[str]] = {"reteach": [], "practice": [], "extend": [], "not_assessed": []}
    if focus:
        assessed = answered.get(focus, set())
        for s in student_ids:
            if s not in assessed:
                groups["not_assessed"].append(s)
                continue
            v = mastery.get(s, {}).get(focus, 0.5)
            key = "reteach" if v < GAP_BELOW else "extend" if v >= EXTEND_AT else "practice"
            groups[key].append(s)

    return ClassAnalysis(
        n_students=n,
        concepts=stats,
        focus_concept=focus,
        groups=groups,
        gaps_open=sum(1 for g in gaps if g["status"] == "open"),
        gaps_closed=sum(1 for g in gaps if g["status"] == "closed"),
        students_by_tag={cid: {t: sorted(s) for t, s in tags.items()} for cid, tags in showing.items()},
    )


def _focus_concept(stats: list[ConceptStats], n: int) -> str | None:
    most = max((c.open_gaps for c in stats), default=0)
    if most > 0:
        tied = [c for c in stats if c.open_gaps == most]
    else:
        floor = max(1, min(5, n // 4))
        tied = [c for c in stats if c.avg is not None and c.responders >= floor]
    if not tied:
        return None
    return min(tied, key=lambda c: (c.avg if c.avg is not None else 1.0, stats.index(c))).id


WHOLE_CLASS = "whole_class"


PRACTICE_AUDIENCES = {"practice_group", "extend_group"}


def critique(topic: Topic, analysis: ClassAnalysis, recs: list[dict], index: int) -> tuple[str, str]:
    """Binding verdict for recommendation `index`: ("accept" | "revise", reason). The LLM may only reword it."""
    rec = recs[index]
    cid, tag = rec.get("concept_id"), rec.get("misconception_tag")
    if not cid or not topic.has_concept(cid):
        return "revise", f"{cid} is not part of {topic.name}; pick a concept from this topic."
    stats = analysis.stats(cid)
    concept = topic.concept(cid)
    n = analysis.n_students
    steps = rec.get("plan_5min") or []
    if len(steps) > 5:
        return "revise", f"The plan has {len(steps)} steps; a 5-minute plan needs 5 or fewer."
    if not (rec.get("worked_example") or "").strip():
        return "revise", "The plan has no worked example."
    if rec.get("audience") in PRACTICE_AUDIENCES:
        # practice and extension plans are for students who don't show the mistake, so no mistake check applies
        group = "practice" if rec.get("audience") == "practice_group" else "extend"
        m = len(analysis.groups.get(group, [])) if cid == analysis.focus_concept else None
        who = f"{m} students" if m is not None else "The students"
        return "accept", f"Fits the data: {who} can move on with practice on {concept.name} while others re-learn."
    label = topic.tag(tag).label() if tag in topic.tags else tag
    k = stats.affected_by_tag.get(tag, 0) if stats else 0
    if k == 0:
        return "revise", f"No student shows '{label}' on {concept.name}; target a mistake the class actually makes."
    if rec.get("audience") == WHOLE_CLASS and k / max(n, 1) < 0.5:
        return "revise", (
            f"Only {k} of {n} students show '{label}' on {concept.name}; re-teaching everyone wastes the period. "
            "Split the class."
        )
    if stats and tag not in [t for t, _ in stats.top]:
        top = ", ".join(topic.tag(t).label() for t, _ in stats.top)
        return "revise", f"'{label}' is not among the top mistakes on {concept.name} ({top})."
    if index == 0 and analysis.focus_concept and not any(r.get("concept_id") == analysis.focus_concept for r in recs):
        focus = topic.concept(analysis.focus_concept)
        return "revise", f"No plan targets {focus.name}, the concept with the most open gaps."
    return "accept", f"Matches the data: {k} of {n} students show '{label}' on {concept.name}."


# ---------- the simulator (zero LLM) ----------


def _slip(question: Question) -> str:
    """A small calculation slip on a typed answer: right method, numerator off by one."""
    value = parse_answer(question.answer).value
    return f"{value.numerator + 1}/{value.denominator}" if value.denominator != 1 else str(value.numerator + 1)


def simulate_answer(rng: random.Random, question: Question, p_correct: float, preferred_tag: str | None) -> str:
    if rng.random() < p_correct:
        return question.answer if question.kind != "mcq" else next(o.text for o in question.options if o.correct)
    # students without a known misconception on this concept mostly make slips, not conceptual mistakes
    slip = preferred_tag is None and rng.random() < 0.6
    if question.kind == "mcq":
        wrong = [o for o in question.options if not o.correct]
        wanted = "careless_arithmetic" if slip else preferred_tag
        preferred = [o for o in wrong if o.tag == wanted]
        return (preferred[0] if preferred else rng.choice(wrong)).text
    wrong_answers = list(question.wrong_answers.items())
    if slip or not wrong_answers:
        return _slip(question)
    preferred = [a for a, t in wrong_answers if t == preferred_tag]
    return preferred[0] if preferred else rng.choice(wrong_answers)[0]


# ---------- language check for localized lessons ----------

_SCRIPTS = {"kn": (0x0C80, 0x0CFF), "hi": (0x0900, 0x097F)}


def script_share(text: str, language: str) -> float:
    if language not in _SCRIPTS:
        return 1.0
    lo, hi = _SCRIPTS[language]
    letters = [ch for ch in text if unicodedata.category(ch).startswith(("L", "M"))]
    if not letters:
        return 0.0
    return sum(1 for ch in letters if lo <= ord(ch) <= hi) / len(letters)


def is_in_language(text: str, language: str) -> bool:
    return script_share(text, language) >= 0.5
