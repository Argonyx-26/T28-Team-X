"""The topic: concepts, misconception tags and the question bank, loaded from data/fractions.json."""

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from .config import settings

CONCEPTUAL_EXCLUDED = {"careless_arithmetic", "unclassified"}
LANGUAGES = ("en", "hi", "kn")


@dataclass(frozen=True)
class Concept:
    id: str
    name: str
    short: str
    prereqs: tuple[str, ...]
    names: dict[str, str]

    def name_in(self, language: str) -> str:
        return self.names.get(language) or self.name


@dataclass(frozen=True)
class Tag:
    tag: str
    definition: str
    labels: dict[str, str]

    def label(self, language: str = "en") -> str:
        return self.labels.get(language) or self.labels["en"]


@dataclass(frozen=True)
class Option:
    text: str
    correct: bool
    tag: str | None


@dataclass(frozen=True)
class Question:
    id: str
    concept_id: str
    kind: str  # "mcq" | "text" | "photo"
    stem: str
    answer: str
    method: str
    options: tuple[Option, ...] = ()
    wrong_answers: dict[str, str] = field(default_factory=dict)
    simplest: bool = False
    expr: str | None = None

    def option(self, text: str) -> Option | None:
        wanted = text.strip()
        return next((o for o in self.options if o.text == wanted), None)

    @property
    def distractor_tags(self) -> set[str]:
        return {o.tag for o in self.options if o.tag}


@dataclass(frozen=True)
class Topic:
    id: str
    name: str
    concepts: tuple[Concept, ...]
    tags: dict[str, Tag]
    questions: tuple[Question, ...]

    @property
    def concept_ids(self) -> list[str]:
        return [c.id for c in self.concepts]

    def concept(self, concept_id: str) -> Concept:
        return next(c for c in self.concepts if c.id == concept_id)

    def has_concept(self, concept_id: str) -> bool:
        return any(c.id == concept_id for c in self.concepts)

    def question(self, question_id: str) -> Question | None:
        return next((q for q in self.questions if q.id == question_id), None)

    def questions_for(self, concept_id: str, kinds: tuple[str, ...] = ("mcq", "text")) -> list[Question]:
        return [q for q in self.questions if q.concept_id == concept_id and q.kind in kinds]

    def tag(self, tag: str) -> Tag:
        return self.tags.get(tag) or self.tags["unclassified"]

    @property
    def edges(self) -> list[tuple[str, str]]:
        return [(p, c.id) for c in self.concepts for p in c.prereqs]


def load_topic(path: Path) -> Topic:
    raw = json.loads(path.read_text(encoding="utf-8"))
    concepts = tuple(
        Concept(c["id"], c["name"], c.get("short", c["name"]), tuple(c.get("prereqs", [])), c.get("names", {}))
        for c in raw["concepts"]
    )
    tags = {t["tag"]: Tag(t["tag"], t["definition"], t["labels"]) for t in raw["tags"]}
    questions = []
    for q in raw["questions"]:
        options = tuple(Option(o["text"], bool(o.get("correct")), o.get("tag")) for o in q.get("options", []))
        questions.append(
            Question(
                id=q["id"],
                concept_id=q["concept"],
                kind=q["kind"],
                stem=q["stem"],
                answer=q["answer"],
                method=q.get("method", ""),
                options=options,
                wrong_answers=dict(q.get("wrong_answers", {})),
                simplest=bool(q.get("simplest", False)),
                expr=q.get("expr"),
            )
        )
    return Topic(raw["topic"]["id"], raw["topic"]["name"], concepts, tags, tuple(questions))


@lru_cache(maxsize=1)
def get_topic() -> Topic:
    return load_topic(settings.data_dir / "fractions.json")
