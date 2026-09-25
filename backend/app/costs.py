"""Unit economics from measured calls: what one student costs per month in AI calls.

    python -m app.costs measure   make a few real calls per action and save data/evals/unit_costs.json

The per-month figure uses a stated usage pattern (below), not guesses about prices: every rupee comes from
measured tokens times the published per-token price.
"""

import asyncio
import json
import statistics
import sys
from pathlib import Path

from .agents import curator
from .agents.diagnostician import prepare_image, read_photo
from .config import settings
from .db import init_db
from .llm import prompts
from .llm.providers import generate
from .llm.schemas import ParentMessageOut
from .topic import get_topic
from .voice import synthesize

UNIT_FILE = settings.data_dir / "evals" / "unit_costs.json"

# a typical week for one student; class-level work (the Coach/Analyst plan) is shared by the class
WEEKLY_USE = {"diagnose_photo": 1, "lesson": 1, "parent_message": 1, "voice_note": 1}
CLASS_WEEKLY_USE = {"plan": 1}
CLASS_SIZE = 30
WEEKS_PER_MONTH = 4


def per_student_month(unit_paise: dict[str, float]) -> float:
    weekly = sum(unit_paise.get(action, 0.0) * n for action, n in WEEKLY_USE.items())
    weekly += sum(unit_paise.get(action, 0.0) * n for action, n in CLASS_WEEKLY_USE.items()) / CLASS_SIZE
    return round(weekly * WEEKS_PER_MONTH / 100, 2)


def load_units() -> dict | None:
    return json.loads(UNIT_FILE.read_text(encoding="utf-8")) if UNIT_FILE.exists() else None


async def measure(repeats: int = 3) -> dict:
    init_db()
    topic = get_topic()
    samples = Path(settings.data_dir).parent / "frontend" / "public" / "samples"
    out: dict[str, list[float]] = {}

    def add(action: str, telemetry: list[dict]):
        out.setdefault(action, []).extend(t["cost_paise"] for t in telemetry if t["ok"] and not t["cached"])

    photo = prepare_image((samples / "asha-p1-photo.jpg").read_bytes())
    for _ in range(repeats):
        _, tel = await read_photo(topic.question("P1"), photo, use_cache=False)
        add("diagnose_photo", tel)
    for language in ("en", "hi", "kn"):
        key = f"measure|C4|add_denominators|{language}"
        await curator._generate(key, "C4", "add_denominators", language)
        add("lesson", curator._last_telemetry.get(key, []))
    facts = json.dumps({"child_name": "Asha", "practised": "Adding fractions", "target_language": "Kannada"})
    for _ in range(repeats):
        result, tel = await generate(
            "Coach", "parent_message", prompts.PARENT, facts, ParentMessageOut, route=("vertex",), use_cache=False
        )
        add("parent_message", tel)
        if result:
            chars = len(result.message)
            await synthesize(result.message, "kn")
            out.setdefault("voice_note", []).append(round(chars / 1e6 * 30.0 * 88 * 100, 3))
    from .agents import coach, state
    from .db import get_conn
    from .seed import DEMO_SESSION_ID, seed

    seed()
    with get_conn() as conn:
        state.require_session(conn, DEMO_SESSION_ID)
    plan = await coach.analyze(DEMO_SESSION_ID)
    out["plan"] = [sum(t["cost_paise"] for t in plan["telemetry"] if t["ok"] and not t["cached"])]

    units = {a: round(statistics.mean(v), 3) for a, v in out.items() if v}
    data = {
        "unit_paise": units,
        "n": {a: len(v) for a, v in out.items()},
        "per_student_month_inr": per_student_month(units),
        "usage": {"per_student_per_week": WEEKLY_USE, "per_class_per_week": CLASS_WEEKLY_USE, "class_size": CLASS_SIZE},
        "method": "real calls on 25 Sep 2026; measured tokens x published price per token (Gemini on Vertex AI, "
        "Chirp 3 HD at $30 per million characters), ₹88 per USD",
    }
    UNIT_FILE.parent.mkdir(parents=True, exist_ok=True)
    UNIT_FILE.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    return data


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "measure":
        result = asyncio.run(measure())
        print(result["unit_paise"], result["n"], "per student per month: Rs", result["per_student_month_inr"])
    else:
        print(__doc__)
