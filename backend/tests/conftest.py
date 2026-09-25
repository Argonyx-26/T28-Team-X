"""Tests never touch the network: both providers are replaced by a fake that answers per schema."""

import json

import pytest

from app import voice
from app.config import settings
from app.llm import providers

CALLS: list[tuple[str, str]] = []


def _fake_payload(schema_name: str, prompt: str) -> dict:
    if schema_name == "TextDiagnosis":
        return {
            "correct": False,
            "misconception_tag": "careless_arithmetic",
            "error_step": "last line",
            "confidence": 0.8,
            "feedback_student": "Check the last step.",
        }
    if schema_name == "PhotoDiagnosis":
        return {
            "steps": ["3/4 + 1/4", "= (3+1)/(4+4)", "= 4/8"],
            "final_answer_read": "4/8",
            "correct": False,
            "error_step": 2,
            "misconception_tag": "add_denominators",
            "confidence": 0.92,
            "feedback_student": "In line 2 you added the denominators. Keep the denominator 4.",
        }
    if schema_name == "LessonOut":
        if "Kannada" in prompt:
            md = "ಛೇದವನ್ನು (denominator) ಕೂಡಿಸಬೇಡಿ. ಅಂಶಗಳನ್ನು ಮಾತ್ರ ಕೂಡಿಸಿ: 3/4 + 1/4 = 4/4 = 1."
            lang = "kn"
        elif "Hindi" in prompt:
            md = "हर (denominator) को मत जोड़िए। केवल अंश जोड़िए: 3/4 + 1/4 = 4/4 = 1."
            lang = "hi"
        else:
            md = "Keep the denominator. Add only the numerators: 3/4 + 1/4 = 4/4 = 1."
            lang = "en"
        return {
            "language": lang,
            "lesson_md": md,
            "practice": [
                {"question": "1/5 + 2/5", "answer": "3/5"},
                {"question": "2/7 + 3/7", "answer": "5/7"},
                {"question": "1/3 + 1/3", "answer": "2/3"},
            ],
        }
    if schema_name == "CoachPlan":
        audience = "reteach_group" if "analyst_verdicts" in prompt else "whole_class"
        return {
            "recommendations": [
                {
                    "audience": audience,
                    "group_label": "Group A" if audience == "reteach_group" else "Whole class",
                    "concept_id": "C4",
                    "misconception_tag": "add_denominators",
                    "headline": "Fix adding denominators",
                    "plan_5min": ["Show a fraction strip", "Work 3/4 + 1/4", "Practise"],
                    "worked_example": "3/4 + 1/4 = 4/4 = 1",
                    "why": "Most gaps are on C4.",
                }
            ]
        }
    if schema_name == "ParentMessageOut":
        return {"language": "kn", "message": "ನಮಸ್ಕಾರ! ಇಂದು ಆಶಾ ಭಿನ್ನರಾಶಿಗಳ ಸಂಕಲನ ಅಭ್ಯಾಸ ಮಾಡಿದರು."}
    if schema_name == "Out":
        return {"answer": "4/4"}
    raise AssertionError(schema_name)


async def fake_caller(system, prompt, schema, image, mime, thinking=0):
    CALLS.append((schema.__name__, "image" if image else "text"))
    return json.dumps(_fake_payload(schema.__name__, prompt), ensure_ascii=False), (100, 50), "fake-model"


@pytest.fixture(autouse=True)
def offline(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "db_path", tmp_path / "test.db")
    monkeypatch.setattr(settings, "nebius_api_key", "test-key")
    monkeypatch.setattr(settings, "gcp_project", "test-project")
    monkeypatch.setattr(settings, "demo_mode", "live")
    monkeypatch.setattr(settings, "admin_token", "secret")
    monkeypatch.setitem(providers.CALLERS, "nebius", fake_caller)
    monkeypatch.setitem(providers.CALLERS, "vertex", fake_caller)
    monkeypatch.setitem(providers.CALLERS, "vertex_alt", fake_caller)

    async def fake_voice(text, language):
        return b"ID3-fake-mp3"

    monkeypatch.setattr(voice, "synthesize", fake_voice)
    CALLS.clear()
    yield
