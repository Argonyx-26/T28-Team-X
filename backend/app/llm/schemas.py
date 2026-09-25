"""What each LLM call must return. Anything that doesn't validate is treated as a failed call."""

from pydantic import BaseModel, Field


class TextDiagnosis(BaseModel):
    correct: bool
    misconception_tag: str
    error_step: str | None = None
    confidence: float = Field(ge=0, le=1)
    feedback_student: str


class PhotoDiagnosis(BaseModel):
    steps: list[str]
    final_answer_read: str | None = None
    correct: bool
    error_step: int | None = None
    misconception_tag: str
    confidence: float = Field(ge=0, le=1)
    feedback_student: str
    boxes: list[str] = []  # parallel to steps: "ymin,xmin,ymax,xmax" on a 0-1000 scale (kept flat on purpose)


class PracticeItem(BaseModel):
    question: str
    answer: str


class LessonOut(BaseModel):
    language: str
    lesson_md: str
    practice: list[PracticeItem]


class RecommendationOut(BaseModel):
    audience: str
    group_label: str
    concept_id: str
    misconception_tag: str
    headline: str
    plan_5min: list[str]
    worked_example: str
    why: str


class CoachPlan(BaseModel):
    recommendations: list[RecommendationOut]


class ParentMessageOut(BaseModel):
    language: str
    message: str


class PageRead(BaseModel):
    """One notebook page: the header and every problem. Kept flat on purpose (nested schemas hang the vision model)."""

    roll_no: int | None = None
    name_on_page: str | None = None
    problems: list[str]  # one entry per problem: its lines of working joined with " | ", exactly as written
    tags: list[str] = []  # parallel to problems: the best misconception tag, or "" when right
    error_steps: list[int] = []  # parallel to problems: the 1-based wrong line, or 0 when right
    boxes: list[str] = []  # parallel to problems: "ymin,xmin,ymax,xmax;..." one box per line, 0-1000 scale
