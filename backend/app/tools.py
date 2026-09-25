"""Team tools, run from backend/:

python -m app.tools warm-lessons     pre-generate lessons into data/lessons_cache.json (then a native reader checks)
python -m app.tools lessons-review   write docs/research/LESSONS_REVIEW.md for Risheeth
python -m app.tools smoke <api-url>  run the demo path against a deployed API and print PASS/FAIL per beat
python -m app.tools warm <api-url>   run every demo beat in demo order (fills the AI cache), then reset the class
python -m app.tools load <api-url> [students=40] [pages=36]
                                     load test on its OWN class: simulated students answering at once (rules path,
                                     p50/p95/errors) and pages read 6 at a time (throughput); never the demo class.
                                     Point it at a no-traffic tagged revision. Gemini calls are capped at ~200.
python -m app.tools cache-seed <api-url>  save the live API's LLM cache as data/llm_cache_seed.jsonl (needs
                                     PROD_ADMIN_TOKEN in the environment or backend/.env; the token is never printed)
"""

import asyncio
import io
import json
import os
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
        s = c.post("/sessions/create", json={"class_name": "Smoke test"}).json()
        j = c.post("/students/join", json={"code": s["code"], "nickname": "Smoke test", "language": "kn"}).json()
        state["sid"] = j["student_id"]
        return f"class {s['code']}"

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


def warm(base: str) -> int:
    """The demo in demo order through the public API, so every AI answer it needs is cached; then a reset.

    Mirrors the "Warm the demo" button on /present, for the command line and the deploy protocol."""
    token = os.getenv("PROD_ADMIN_TOKEN") or settings.admin_token
    c = httpx.Client(base_url=base.rstrip("/"), timeout=120, headers={"X-Admin-Token": token})
    samples = settings.data_dir.parent / "frontend" / "public" / "samples"
    asha, session = "stu_asha_7b", "ses_7b"
    topic = get_topic()
    failures = 0

    def step(name, fn):
        nonlocal failures
        t = time.perf_counter()
        try:
            detail = fn()
            print(f"OK    {name:44} {time.perf_counter() - t:5.1f}s  {detail or ''}")
        except Exception as exc:  # keep going; the summary says what failed
            failures += 1
            print(f"FAIL  {name:44} {time.perf_counter() - t:5.1f}s  {repr(exc)[:140]}")

    def reset():
        r = c.post("/admin/reset", json={})
        r.raise_for_status()
        return "fresh Asha"

    def photo(student_id, qid, name):
        r = c.post(
            "/agents/diagnostician/photo",
            data={"student_id": student_id, "question_id": qid},
            files={"image": (name, (samples / name).read_bytes(), "image/jpeg")},
        ).json()
        tel = " / ".join("cached" if t.get("cached") else f"{t.get('ms')} ms" for t in r.get("telemetry", []))
        return f"step {r.get('error_step')} {r.get('misconception_tag')} [{tel}]"

    def analyze():
        r = c.post("/agents/analyst/analyze", json={"session_id": session}).json()
        cached = sum(1 for t in r["telemetry"] if t.get("cached"))
        return (
            " -> ".join(f"{s['agent']}:{s['action']}" for s in r["steps"]) + f"; {cached}/{len(r['telemetry'])} cached"
        )

    def wrong_answer():
        n = c.post("/agents/examiner/next", json={"student_id": asha}).json()
        if n["done"]:
            return "quiz complete"
        q = topic.question(n["question"]["id"])
        wrong = next((o.text for o in q.options if o.tag == "add_denominators"), None) or next(
            o.text for o in q.options if not o.correct
        )
        a = c.post(
            "/agents/diagnostician/answer", json={"student_id": asha, "question_id": q.id, "answer": wrong}
        ).json()
        return f"{q.id} '{wrong}' -> {a.get('misconception_tag')}; gap open {a.get('gap_open')}"

    def lesson():
        for _ in range(30):
            r = c.post("/agents/curator/lesson", json={"student_id": asha}).json()
            if r["status"] != "generating":
                return f"{r['status']} {r['lesson']['language'] if r.get('lesson') else ''}"
            time.sleep(1.5)
        return "still generating"

    def parent():
        r = c.post("/agents/coach/parent-message", json={"student_id": asha}).json()
        if r.get("audio_url"):
            c.get(r["audio_url"])
        return f"{r['language']} {len(r['message'])} chars, voice {'ready' if r.get('audio_url') else 'off'}"

    def others():
        d = c.get("/teacher/dashboard", params={"session_id": session}).json()
        who = {s["nickname"].lower(): s["id"] for s in d["heatmap"]["students"]}
        out = []
        for name, qid, file in [
            ("asha", "P2", "asha-p2-photo.jpg"),
            ("asha", "P3", "asha-p3-photo.jpg"),
            ("rahul", "P3", "rahul-p3.jpg"),
            ("meera", "P4", "meera-p4.jpg"),
        ]:
            out.append(f"{qid}:" + photo(who.get(name, asha), qid, file).split(" ")[1])
        return " ".join(out)

    def pile():
        d = c.get("/teacher/dashboard", params={"session_id": session}).json()
        sims = [s["id"] for s in d["heatmap"]["students"] if s["kind"] == "simulated"]
        files = [
            ("images", (f"p1-{i}.jpg", (samples / "pile" / f"p1-{i}.jpg").read_bytes(), "image/jpeg"))
            for i in range(1, 7)
        ]
        r = c.post(
            "/agents/diagnostician/stack", data={"question_id": "P1", "student_ids": sims[:6]}, files=files
        ).json()
        return " ".join(str(x.get("error_step", "?")) for x in r["results"])

    for name, fn in [
        ("reset", reset),
        ("scan Asha P1", lambda: photo(asha, "P1", "asha-p1-photo.jpg")),
        ("plan tomorrow's lesson", analyze),
        ("Asha answers wrong", wrong_answer),
        ("Asha's Kannada lesson", lesson),
        ("parent message + voice note", parent),
        ("other sample pages", others),
        ("sample pile", pile),
        ("reset again", reset),
    ]:
        step(name, fn)
    print("warm complete" if not failures else f"{failures} step(s) failed")
    return 1 if failures else 0


def load(base: str, n_students: int = 40, n_pages: int = 36) -> int:
    """A load test that never touches class 7B. Answers go through the rules path (0 Gemini calls); pages go through
    the vision model 6 at a time (capped). Writes data/evals/load.json with p50/p95 and errors."""
    import concurrent.futures as cf
    import statistics

    topic = get_topic()
    samples = settings.data_dir.parent / "frontend" / "public" / "samples"
    client = httpx.Client(base_url=base.rstrip("/"), timeout=120)
    session = client.post("/sessions/create", json={"class_name": "Load test"}).json()
    code, session_id = session["code"], session["session_id"]
    out: dict = {"api": base, "class": code, "students": n_students, "pages": n_pages}

    # 1) many students answering at once: join + 5 answers each, in parallel threads
    statuses: dict[int, int] = {}

    def note(r) -> bool:
        statuses[r.status_code] = statuses.get(r.status_code, 0) + 1
        return r.status_code == 200

    def student(i: int) -> list[tuple[float, bool]]:
        c = httpx.Client(base_url=base.rstrip("/"), timeout=60)
        times: list[tuple[float, bool]] = []
        t = time.perf_counter()
        r = c.post("/students/join", json={"code": code, "nickname": f"Load {i}", "language": "kn", "roll_no": i + 1})
        times.append((time.perf_counter() - t, note(r)))
        if r.status_code != 200:
            return times
        sid = r.json()["student_id"]
        for _ in range(5):
            t = time.perf_counter()
            n = c.post("/agents/examiner/next", json={"student_id": sid})
            ok = note(n)
            times.append((time.perf_counter() - t, ok))
            if not ok or n.json()["done"]:
                break
            q = topic.question(n.json()["question"]["id"])
            answer = q.answer if q.kind != "mcq" else next(o.text for o in q.options if o.correct)
            if _ % 2 == 1:  # every second answer is a known wrong answer, so gaps open (still rules only)
                if q.kind == "mcq":
                    answer = next((o.text for o in q.options if o.tag), answer)
                elif q.wrong_answers:
                    answer = next(iter(q.wrong_answers))
            t = time.perf_counter()
            a = c.post("/agents/diagnostician/answer", json={"student_id": sid, "question_id": q.id, "answer": answer})
            times.append((time.perf_counter() - t, note(a)))
        return times

    started = time.perf_counter()
    with cf.ThreadPoolExecutor(max_workers=min(n_students, 40)) as pool:
        results = list(pool.map(student, range(n_students)))
    wall = time.perf_counter() - started
    flat = [x for r in results for x in r]
    ms = sorted(t * 1000 for t, _ in flat)
    errors = sum(1 for _, ok in flat if not ok)
    out["answers"] = {
        "requests": len(flat),
        "wall_s": round(wall, 1),
        "rps": round(len(flat) / wall, 1),
        "p50_ms": round(statistics.median(ms)) if ms else None,
        "p95_ms": round(ms[int(0.95 * (len(ms) - 1))]) if ms else None,
        "errors": errors,
        "status_codes": dict(sorted(statuses.items())),
        "gemini_calls": 0,
    }
    print("answers", out["answers"])
    statuses.clear()

    # 2) pages read 6 at a time (the vision model), capped
    n_pages = min(n_pages, 60)
    files = sorted((samples / "pile").glob("p1-*.jpg")) + [samples / "asha-p1-photo.jpg", samples / "asha-p2-photo.jpg"]
    dash = client.get("/teacher/dashboard", params={"session_id": session_id}).json()
    ids = [s["id"] for s in dash["heatmap"]["students"]] or []
    if not ids:
        print("no students joined; skipping pages")
    else:
        started = time.perf_counter()
        durations: list[float] = []
        errs = 0
        calls = 0

        def one(i: int) -> tuple[float, bool, int]:
            c = httpx.Client(base_url=base.rstrip("/"), timeout=120)
            f = files[i % len(files)]
            t = time.perf_counter()
            r = c.post(
                "/agents/diagnostician/photo",
                data={"student_id": ids[i % len(ids)], "question_id": "P1"},
                files={"image": (f.name, f.read_bytes(), "image/jpeg")},
            )
            n_calls = (
                len([t for t in r.json().get("telemetry", []) if not t.get("cached")]) if r.status_code == 200 else 0
            )
            return time.perf_counter() - t, r.status_code == 200, n_calls

        with cf.ThreadPoolExecutor(max_workers=6) as pool:
            for d, ok, n_calls in pool.map(one, range(n_pages)):
                durations.append(d)
                errs += int(not ok)
                calls += n_calls
        wall = time.perf_counter() - started
        ds = sorted(durations)
        out["pages"] = {
            "pages": n_pages,
            "parallel": 6,
            "wall_s": round(wall, 1),
            "pages_per_min": round(n_pages / wall * 60, 1),
            "p50_s": round(statistics.median(ds), 2),
            "p95_s": round(ds[int(0.95 * (len(ds) - 1))], 2),
            "errors": errs,
            "status_codes": dict(sorted(statuses.items())),
            "gemini_calls": calls,
        }
        print("pages", out["pages"])
    out["method"] = (
        f"{n_students} simulated students joining and answering 5 questions each at once through the rules path "
        f"(no AI call), then {n_pages} notebook photos read 6 at a time through the vision model; run on its own "
        "class on a no-traffic tagged revision of the API with 1 instance, 1 worker"
    )
    path = settings.data_dir / "evals" / "load.json"
    path.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"saved to {path}")
    return 0


def cache_seed(base: str) -> int:
    token = os.getenv("PROD_ADMIN_TOKEN") or settings.admin_token
    r = httpx.get(f"{base.rstrip('/')}/admin/cache-export", headers={"X-Admin-Token": token}, timeout=60)
    r.raise_for_status()
    rows = r.json()["rows"]
    path = settings.data_dir / "llm_cache_seed.jsonl"
    with open(path, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    by_agent: dict[str, int] = {}
    for row in rows:
        agent = row.get("agent") or "?"
        by_agent[agent] = by_agent.get(agent, 0) + 1
    print(f"saved {len(rows)} cached answers to {path}: {by_agent}")
    return 0


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "cache-seed":
        sys.exit(cache_seed(sys.argv[2]))
    elif cmd == "load":
        sys.exit(
            load(
                sys.argv[2],
                int(sys.argv[3]) if len(sys.argv) > 3 else 40,
                int(sys.argv[4]) if len(sys.argv) > 4 else 36,
            )
        )
    elif cmd == "warm":
        sys.exit(warm(sys.argv[2]))
    elif cmd == "warm-lessons":
        asyncio.run(warm_lessons())
    elif cmd == "lessons-review":
        lessons_review()
    elif cmd == "smoke":
        sys.exit(smoke(sys.argv[2]))
    else:
        print(__doc__)
