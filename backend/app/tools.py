"""Team tools, run from backend/:

python -m app.tools warm-lessons     pre-generate lessons into data/lessons_cache.json (then a native reader checks)
python -m app.tools lessons-review   write docs/research/LESSONS_REVIEW.md for Risheeth
python -m app.tools smoke <api-url>  run the demo path against a deployed API and print PASS/FAIL per beat
"""

import asyncio
import io
import json
import sys
import time

import httpx

from .agents import curator
from .config import settings
from .db import init_db
from .topic import get_topic


async def warm_lessons() -> None:
    init_db()
    lessons = await curator.warm(curator.DEMO_PAIRS)
    path = settings.data_dir / "lessons_cache.json"
    path.write_text(json.dumps(lessons, ensure_ascii=False, indent=1), encoding="utf-8")
    expected = len(curator.DEMO_PAIRS) * 3
    print(f"{len(lessons)} of {expected} lessons verified and saved to {path}")


def lessons_review() -> None:
    topic = get_topic()
    lessons = json.loads((settings.data_dir / "lessons_cache.json").read_text(encoding="utf-8"))
    out = ["# Lesson review (native reader: mark each OK or FIX, with the fix)\n"]
    for key, lesson in lessons.items():
        _, cid, tag, lang = key.split("|")
        out.append(f"## {topic.concept(cid).name} · {topic.tag(tag).label()} · {lang}\n")
        out.append(lesson["lesson_md"] + "\n")
        out += [f"- {p['question']} → {p['answer']}" for p in lesson["practice"]]
        out.append("\n**Verdict:** OK / FIX: \n")
    path = settings.data_dir.parent / "docs" / "research" / "LESSONS_REVIEW.md"
    path.write_text("\n".join(out), encoding="utf-8")
    print(f"wrote {path}")


def _png() -> bytes:
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (900, 500), "white")
    d = ImageDraw.Draw(img)
    for i, line in enumerate(["3/4 + 1/4", "= (3+1)/(4+4)", "= 4/8"]):
        d.text((60, 60 + i * 120), line, fill="navy")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def smoke(base: str) -> int:
    """The judged demo path against a live API. Uses a fresh student so Asha stays untouched."""
    c = httpx.Client(base_url=base.rstrip("/"), timeout=60)
    results: list[tuple[str, bool, str]] = []

    def check(name, fn):
        t = time.perf_counter()
        try:
            detail = fn()
            results.append((name, True, f"{(time.perf_counter() - t):.1f}s {detail or ''}"))
        except Exception as exc:  # report and keep going
            results.append((name, False, repr(exc)[:160]))

    state: dict = {}
    topic = get_topic()

    def health():
        h = c.get("/health").json()
        assert h["ok"], h
        return h["providers"]

    def join():
        j = c.post("/students/join", json={"code": "7B", "nickname": "Smoke test", "language": "kn"}).json()
        state["sid"] = j["student_id"]

    def quiz():
        wrong_given = False
        for _ in range(5):
            n = c.post("/agents/examiner/next", json={"student_id": state["sid"]}).json()
            if n["done"]:
                break
            q = topic.question(n["question"]["id"])
            if q.kind == "mcq" and not wrong_given and any(o.tag for o in q.options):
                ans, wrong_given = next(o.text for o in q.options if o.tag), True
            else:
                ans = q.answer
            a = c.post(
                "/agents/diagnostician/answer", json={"student_id": state["sid"], "question_id": q.id, "answer": ans}
            ).json()
            assert "correct" in a, a
        return f"wrong answer given: {wrong_given}"

    def lesson():
        for _ in range(40):
            r = c.post("/agents/curator/lesson", json={"student_id": state["sid"]}).json()
            if r["status"] != "generating":
                break
            time.sleep(1.5)
        assert r["status"] in ("ready", "none"), r
        state["lesson"] = r
        return f"{r['status']} {r['lesson']['language'] if r.get('lesson') else ''}"

    def retry():
        r = state["lesson"]
        if r["status"] != "ready":
            return "no gap to close"
        answers = [{"question_id": q["id"], "answer": topic.question(q["id"]).answer} for q in r["retry"]]
        out = c.post("/agents/examiner/retry", json={"student_id": state["sid"], "answers": answers}).json()
        assert out["gap_closed"], out
        return "gap closed"

    def photo():
        r = c.post(
            "/agents/diagnostician/photo",
            data={"student_id": state["sid"], "question_id": "P1"},
            files={"image": ("p1.png", _png(), "image/png")},
        ).json()
        assert "steps" in r, r
        return f"step {r['error_step']} {r['misconception_tag']}"

    def dashboard():
        d = c.get("/teacher/dashboard", params={"session_id": "ses_7b"}).json()
        assert d["focus_concept"], d
        return f"{d['n_students']} students, focus {d['focus_concept']}"

    def analyze():
        r = c.post("/agents/analyst/analyze", json={"session_id": "ses_7b"}).json()
        assert r["final"], r
        return " -> ".join(f"{s['agent']}:{s['action']}" for s in r["steps"])

    for name, fn in [
        ("health", health),
        ("join", join),
        ("quiz x5", quiz),
        ("lesson", lesson),
        ("retry", retry),
        ("photo", photo),
        ("dashboard", dashboard),
        ("analyze", analyze),
    ]:
        check(name, fn)
    for name, ok, detail in results:
        print(f"{'PASS' if ok else 'FAIL'}  {name:10} {detail}")
    return 0 if all(ok for _, ok, _ in results) else 1


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "warm-lessons":
        asyncio.run(warm_lessons())
    elif cmd == "lessons-review":
        lessons_review()
    elif cmd == "smoke":
        sys.exit(smoke(sys.argv[2]))
    else:
        print(__doc__)
