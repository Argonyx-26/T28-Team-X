"""Evaluations. Every number is reported as k/n with its method, and lands in data/evals/results.json for /judges.

python -m app.evals typed    30 wrong answers built by applying a known wrong procedure to new problems
python -m app.evals photos   the handwriting cards in data/evidence/photos, against data/evidence/labels.csv
python -m app.evals verifier the 12 labelled pages diagnosed from their transcribed lines by exact arithmetic alone
"""

import asyncio
import csv
import json
import random
import statistics
import sys
from fractions import Fraction

from .agents.diagnostician import TEXT_THINKING, _question_block, check_steps, prepare_image, read_photo
from .config import settings
from .db import init_db
from .fraction_math import parse_answer
from .llm import prompts
from .llm.providers import generate
from .llm.schemas import TextDiagnosis
from .rules import validate_llm_tag
from .topic import Question, get_topic

RESULTS = settings.data_dir / "evals" / "results.json"


def _f(x: Fraction) -> str:
    return str(x.numerator) if x.denominator == 1 else f"{x.numerator}/{x.denominator}"


def typed_items(seed: int = 26) -> list[dict]:
    """New problems (not in the bank) answered with a known wrong procedure; the label is the procedure."""
    rng = random.Random(seed)
    items: list[dict] = []

    def add(tag, stem, answer, method, wrong):
        w, a = parse_answer(wrong), parse_answer(answer)
        if w and a and w.value != a.value and not any(i["stem"] == stem for i in items):
            items.append({"tag": tag, "stem": stem, "answer": answer, "method": method, "student": wrong})

    while len(items) < 30:
        kind = len(items) // 3
        b = rng.choice([5, 7, 8, 9, 11])
        a, c = rng.randint(1, b // 2), rng.randint(1, b // 2)
        if kind == 0:
            add(
                "add_denominators",
                f"{a}/{b} + {c}/{b} = ?",
                _f(Fraction(a + c, b)),
                "Same denominator: add the numerators only.",
                f"{a + c}/{2 * b}",
            )
        elif kind == 1:
            d = b * 2
            add(
                "unlike_denominators",
                f"{a}/{b} + {c}/{d} = ?",
                _f(Fraction(a, b) + Fraction(c, d)),
                f"Make the denominators the same ({d}) first.",
                f"{a + c}/{d}",
            )
        elif kind == 2:
            d = rng.choice([3, 4, 5])
            add(
                "divide_no_flip",
                f"{a}/{b} ÷ {c}/{d} = ?",
                _f(Fraction(a, b) / Fraction(c, d)),
                "Keep the first, flip the second, multiply.",
                f"{a * c}/{b * d}",
            )
        elif kind == 3:
            d = rng.choice([3, 4, 5])
            add(
                "divide_flip_first",
                f"{a}/{b} ÷ {c}/{d} = ?",
                _f(Fraction(a, b) / Fraction(c, d)),
                "Keep the first, flip the second, multiply.",
                f"{b * c}/{a * d}",
            )
        elif kind == 4:
            n = rng.randint(2, 5)
            add(
                "whole_times_both",
                f"{n} x {a}/{b} = ?",
                _f(n * Fraction(a, b)),
                "Multiply only the numerator by the whole number.",
                f"{n * a}/{n * b}",
            )
        elif kind == 5:
            d = rng.choice([3, 4, 5, 6])
            add(
                "multiply_cross",
                f"{a}/{b} x {c}/{d} = ?",
                _f(Fraction(a, b) * Fraction(c, d)),
                "Top times top, bottom times bottom.",
                f"{a * d}/{b * c}",
            )
        elif kind == 6:
            k = rng.choice([2, 3])
            add(
                "equivalence_additive",
                f"{a}/{b} = ?/{b * k}. What goes in the blank?",
                str(a * k),
                f"Multiply top and bottom by {k}.",
                str(a + b * k - b),
            )
        elif kind == 7:
            k = rng.choice([2, 3, 4])
            p, q = rng.choice([(1, 3), (2, 3), (3, 4), (2, 5), (3, 5)])
            add(
                "simplify_one_part",
                f"Simplify {p * k}/{q * k}.",
                f"{p}/{q}",
                f"Divide top and bottom by {k}.",
                f"{p}/{q * k}",
            )
        elif kind == 8:
            n = rng.randint(2, 5)
            add(
                "word_problem_operation",
                f"Each packet holds {a}/{b} kg of dal. How much dal is in {n} packets?",
                _f(n * Fraction(a, b)),
                "Equal packets means multiply.",
                f"{n} {a}/{b}",
            )
        else:
            p, q = rng.choice([(3, 7), (4, 9), (5, 8), (2, 6), (6, 10)])
            add(
                "bigger_denominator_bigger",
                f"Write the bigger fraction: 1/{p} or 1/{q}.",
                f"1/{p}",
                "Same numerator: the smaller denominator gives bigger pieces.",
                f"1/{q}",
            )
    return items


async def run_typed() -> dict:
    init_db()
    topic = get_topic()
    right, rows, ms = 0, [], []
    for i, item in enumerate(typed_items()):
        q = Question(
            id=f"E{i}", concept_id="C4", kind="text", stem=item["stem"], answer=item["answer"], method=item["method"]
        )
        prompt = (
            f"{_question_block(q)}\n\nStudent's typed answer: {item['student']}\nWrite feedback_student in English."
        )
        result, telemetry = await generate(
            "Diagnostician",
            "eval_typed",
            prompts.DIAGNOSE_TEXT,
            prompt,
            TextDiagnosis,
            use_cache=False,
            thinking=TEXT_THINKING,
        )
        tag = validate_llm_tag(topic, result.misconception_tag, result.confidence)[0] if result else "none"
        ok = tag == item["tag"]
        right += ok
        ms += [t["ms"] for t in telemetry if t["ok"]]
        rows.append({**item, "predicted": tag, "ok": ok})
        print(f"{'OK ' if ok else 'XX '} {item['tag']:26} predicted {tag:26} {item['stem']}  ->  {item['student']}")
    n = len(rows)
    number = {
        "label": "Mistake named correctly from a typed answer alone (LLM fallback)",
        "value": f"{right}/{n}",
        "n": n,
        "method": "wrong answers built by applying a known wrong procedure to new problems (label by "
        "construction); final answer only, no working shown",
    }
    print(number, f"median {statistics.median(ms) / 1000:.1f}s" if ms else "")
    _save("typed", [number], rows)
    return number


async def run_photos() -> list[dict]:
    init_db()
    topic = get_topic()
    folder = settings.data_dir / "evidence" / "photos"
    labels = list(csv.DictReader(open(settings.data_dir / "evidence" / "labels.csv", encoding="utf-8")))
    rows, ms, paise, writers, cards = [], [], [], set(), set()
    for label in labels:
        for photo in sorted(folder.glob(f"{label['card']}_*")):
            writers.add(label["writer"])
            cards.add(label["card"])
            q = topic.question(label["question_id"])
            reading, telemetry = await read_photo(q, prepare_image(photo.read_bytes()), use_cache=False)
            ms += [t["ms"] for t in telemetry if t["ok"]]
            paise += [t["cost_paise"] for t in telemetry if t["ok"]]
            truth_correct = label["correct"] == "true"
            got = reading or {}
            row = {
                "photo": photo.name,
                "truth_correct": truth_correct,
                "truth_tag": label["tag"] or None,
                "truth_step": int(label["error_step"]) if label["error_step"] else None,
                "read": got.get("steps"),
                "correct": got.get("correct"),
                "tag": got.get("misconception_tag"),
                "step": got.get("error_step"),
            }
            rows.append(row)
            print(
                photo.name,
                "truth",
                truth_correct,
                row["truth_tag"],
                row["truth_step"],
                "| got",
                row["correct"],
                row["tag"],
                row["step"],
            )
    if not rows:
        print(f"no photos in {folder}")
        return []
    n = len(rows)
    verdict = sum(r["correct"] == r["truth_correct"] for r in rows)
    wrong = [r for r in rows if not r["truth_correct"]]
    tag_ok = sum(r["tag"] == r["truth_tag"] for r in wrong)
    step_ok = sum(r["step"] == r["truth_step"] for r in wrong)
    who = f"{len(writers)} writer" + ("s" if len(writers) != 1 else "")
    method = f"{n} phone photos of {len(cards)} handwritten pages by {who}, labelled before running the model"
    numbers = [
        {
            "label": "Handwritten work marked right or wrong correctly",
            "value": f"{verdict}/{n}",
            "n": n,
            "method": method,
        },
        {
            "label": "Wrong step circled correctly",
            "value": f"{step_ok}/{len(wrong)}",
            "n": len(wrong),
            "method": method + "; wrong answers only",
        },
        {
            "label": "Misconception named correctly from a photo",
            "value": f"{tag_ok}/{len(wrong)}",
            "n": len(wrong),
            "method": method + "; wrong answers only",
        },
    ]
    if ms:
        ordered = sorted(ms)
        numbers.append(
            {
                "label": "Photo diagnosis time (median / p95)",
                "value": f"{statistics.median(ms) / 1000:.1f} s / {ordered[int(0.95 * (len(ms) - 1))] / 1000:.1f} s",
                "n": len(ms),
                "method": "server-side model time per photo during the evaluation",
            }
        )
        numbers.append(
            {
                "label": "Cost per photo diagnosis",
                "value": f"₹{statistics.mean(paise) / 100:.2f}",
                "n": len(paise),
                "method": "measured tokens x published price per token, ₹88 per USD",
            }
        )
    for x in numbers:
        print(x)
    _save("photos", numbers, rows)
    return numbers


def run_verifier() -> list[dict]:
    """No model: the labelled lines go straight to the verifier. The label was written before any model ran."""
    topic = get_topic()
    labels = list(csv.DictReader(open(settings.data_dir / "evidence" / "labels.csv", encoding="utf-8")))
    rows, writers = [], set()
    for label in labels:
        writers.add(label["writer"])
        q = topic.question(label["question_id"])
        lines = [x.strip() for x in label["lines"].split("|")]
        v = check_steps(q, lines)
        truth_correct = label["correct"] == "true"
        truth_step = int(label["error_step"]) if label["error_step"] else None
        truth_tag = label["tag"] or None
        row = {
            "card": label["card"],
            "lines": lines,
            "truth_correct": truth_correct,
            "truth_step": truth_step,
            "truth_tag": truth_tag,
            "correct": v.correct,
            "step": v.error_step,
            "tag": v.tag,
            "reproduced_by": v.reproduced_by,
            "evidence": v.evidence,
            "line_values": [x.value for x in v.lines],
        }
        rows.append(row)
        ok = row["correct"] == truth_correct and row["step"] == truth_step and row["tag"] == truth_tag
        print("OK " if ok else "XX ", label["card"], v.evidence)
    n = len(rows)
    wrong = [r for r in rows if not r["truth_correct"]]
    verdict_ok = sum(r["correct"] == r["truth_correct"] for r in rows)
    step_ok = sum(r["step"] == r["truth_step"] for r in wrong)
    tag_ok = sum(r["tag"] == r["truth_tag"] for r in wrong)
    method = (
        f"{n} handwritten pages by {len(writers)} writers, transcribed by hand and labelled before any model ran "
        "(data/evidence/labels.csv); the lines are checked by exact fraction arithmetic and mal-rules only, no AI call"
    )
    numbers = [
        {"label": "Right or wrong decided by arithmetic alone", "value": f"{verdict_ok}/{n}", "n": n, "method": method},
        {
            "label": "Wrong step found by arithmetic alone",
            "value": f"{step_ok}/{len(wrong)}",
            "n": len(wrong),
            "method": method + "; wrong answers only",
        },
        {
            "label": "Mistake reproduced exactly by a mal-rule",
            "value": f"{tag_ok}/{len(wrong)}",
            "n": len(wrong),
            "method": method + "; wrong answers only: a rule that recomputes the wrong line exactly names the mistake",
        },
    ]
    for x in numbers:
        print(x)
    _save("verifier", numbers, rows)
    return numbers


def _save(kind: str, numbers: list[dict], rows: list[dict]) -> None:
    RESULTS.parent.mkdir(parents=True, exist_ok=True)
    data = json.loads(RESULTS.read_text(encoding="utf-8")) if RESULTS.exists() else {"numbers": [], "runs": {}}
    keep = [x for x in data.get("numbers", []) if x.get("kind") != kind]
    data["numbers"] = keep + [{**x, "kind": kind} for x in numbers]
    data.setdefault("runs", {})[kind] = rows
    RESULTS.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"saved to {RESULTS}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # ₹ in the output crashes a Windows console
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "typed":
        asyncio.run(run_typed())
    elif cmd == "photos":
        asyncio.run(run_photos())
    elif cmd == "verifier":
        run_verifier()
    else:
        print(__doc__)
