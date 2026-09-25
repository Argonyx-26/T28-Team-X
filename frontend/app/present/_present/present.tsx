"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ROUTES, SITE } from "@/lib/site";

import { type AdminHealth, ApiError, admin, adminToken, api } from "../../teacher/[code]/_dashboard/api";
import s from "../../teacher/[code]/_dashboard/dashboard.module.css";
import { fontVars } from "../../teacher/[code]/_dashboard/fonts";

const ASHA_ID = "stu_asha_7b";
const SESSION_ID = "ses_7b";

// the demo, in order; every tab opens in its own window so the presenter can Alt-Tab through them
const TABS = [
  { n: 1, label: "Landing page", href: "/", note: "30 s: the red-pen demo plays by itself" },
  { n: 2, label: "Scan a notebook", href: ROUTES.scan, note: "Asha's page (real photo) → step 2 circled → Yes, that's the mistake" },
  { n: 3, label: "Class dashboard", href: ROUTES.dashboard, note: "Asha's C4 cell is red → Plan tomorrow's lesson → Approve → worksheet" },
  { n: 4, label: "Be Asha (phone)", href: ROUTES.asha, note: "wrong answer → Fix this now → Kannada lesson → 2 retries → Gap closed" },
  { n: 5, label: "Any problem (scan)", href: ROUTES.scan, note: "“Any other fraction problem” → photograph 2/5 + 1/3 = 3/8 → the ledger and the mal-rule evidence" },
  { n: 6, label: "School view", href: ROUTES.school, note: "7A, 7B, 7C: classes × concepts, top mistakes, which class needs which re-teach" },
  { n: 7, label: "Notebook pile", href: ROUTES.pile, note: "6 sample notebooks read six at a time" },
  { n: 8, label: "For judges", href: ROUTES.judges, note: "every number with its n and method" },
];

const NOTES = [
  "Teachers don't upload anything. Homework comes back already marked, and when they do check notebooks, flipping pages under a phone is faster than a red pen.",
  "The AI reads; arithmetic judges. A model can never mark a right answer wrong.",
  "The Coach plans from the mark book; the Analyst checks every child's answers and its veto is binding; the teacher has the last word.",
  "Every number on /judges carries n and method. We have no users and no trial yet, and we say so.",
  "If the Wi-Fi dies: the phone hotspot; the cache serves every demo answer; the video is the last fallback.",
];

type Step = { name: string; state: "todo" | "running" | "ok" | "fail"; detail?: string; ms?: number };

async function blobOf(path: string): Promise<Blob> {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.blob();
}

/** The demo, in demo order, through the public API: every AI answer it needs is then in the cache. */
function warmPlan(): { name: string; run: () => Promise<string> }[] {
  return [
    { name: "Reset the demo class", run: async () => (await admin.reset(), "fresh Asha") },
    {
      name: "Scan Asha's page (3/4 + 1/4)",
      run: async () => {
        const r = await api.photo(ASHA_ID, "P1", await blobOf("/samples/asha-p1-photo.jpg"));
        return `step ${r.error_step}, ${r.misconception_tag}, ${r.telemetry.map((t) => (t.cached ? "cached" : `${t.ms} ms`)).join(" / ")}`;
      },
    },
    {
      name: "Plan tomorrow's lesson (Coach vs Analyst)",
      run: async () => {
        const r = await api.analyze(SESSION_ID);
        return `${r.steps.map((x) => `${x.agent}:${x.action}`).join(" → ")}; ${r.telemetry.filter((t) => t.cached).length} of ${r.telemetry.length} cached`;
      },
    },
    {
      name: "Asha answers one question wrong",
      run: async () => {
        const n = await api.next(ASHA_ID);
        if (n.done || !n.question) return "quiz already complete";
        const options = n.question.options ?? [];
        const wrong = options.find((o) => o.includes("2/6")) ?? options[options.length - 1] ?? "4/8";
        const a = await api.answer(ASHA_ID, n.question.id, wrong);
        return `${n.question.id} '${wrong}' → ${a.misconception_tag ?? "correct"}; gap ${a.gap_open ? "open" : "closed"}`;
      },
    },
    {
      name: "Asha's Kannada lesson",
      run: async () => {
        for (let i = 0; i < 30; i++) {
          const r = await api.lesson(ASHA_ID);
          if (r.status !== "generating") return `${r.status} ${r.lesson?.language_label ?? ""} ${r.lesson?.translated ? "" : "(English fallback)"}`;
          await new Promise((ok) => setTimeout(ok, 1500));
        }
        return "still generating after 45 s";
      },
    },
    {
      name: "Parent message and voice note for Asha",
      run: async () => {
        const r = await api.parentMessage(ASHA_ID);
        if (r.audio_url) await fetch(`/backend${r.audio_url}`, { cache: "no-store" });
        return `${r.language}, ${r.message.length} chars, voice ${r.audio_url ? "ready" : "off"}`;
      },
    },
    {
      name: "The other sample pages (P2, P3, P4)",
      run: async () => {
        const dash = await api.dashboard(SESSION_ID);
        const who = (name: string) => dash.heatmap.students.find((x) => x.nickname.toLowerCase() === name)?.id ?? ASHA_ID;
        const pages = [
          ["asha", "P2", "/samples/asha-p2-photo.jpg"],
          ["asha", "P3", "/samples/asha-p3-photo.jpg"],
          ["rahul", "P3", "/samples/rahul-p3.jpg"],
          ["meera", "P4", "/samples/meera-p4.jpg"],
        ] as const;
        const out: string[] = [];
        for (const [name, q, src] of pages) {
          const r = await api.photo(who(name), q, await blobOf(src));
          out.push(`${q}:${r.error_step ?? "✓"}`);
        }
        return out.join(" ");
      },
    },
    {
      name: "The sample pile (6 pages)",
      run: async () => {
        const dash = await api.dashboard(SESSION_ID);
        const sims = dash.heatmap.students.filter((x) => x.kind === "simulated");
        const results = await Promise.all(
          Array.from({ length: 6 }, (_, i) =>
            blobOf(`/samples/pile/p1-${i + 1}.jpg`).then((b) => api.photo(sims[i % sims.length].id, "P1", b)),
          ),
        );
        return results.map((r) => (r.correct ? "✓" : `${r.error_step}`)).join(" ");
      },
    },
    { name: "Reset again, so the class is fresh", run: async () => (await admin.reset(), "done") },
  ];
}

export function Present() {
  const [token, setToken] = useState("");
  const [saved, setSaved] = useState(false);
  const [health, setHealth] = useState<AdminHealth | null>(null);
  const [healthError, setHealthError] = useState("");
  const [busy, setBusy] = useState<"" | "reset" | "warm">("");
  const [message, setMessage] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);

  useEffect(() => {
    const t = adminToken.get();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(t);
    setSaved(t.length > 0);
  }, []);

  const checkHealth = useCallback(async () => {
    setHealthError("");
    try {
      setHealth(await admin.health());
    } catch (e) {
      setHealth(null);
      setHealthError(e instanceof ApiError ? (e.status === 401 ? "The admin token is wrong." : e.message) : "Can't reach the API.");
    }
  }, []);

  useEffect(() => {
    if (!saved) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void checkHealth();
  }, [saved, checkHealth]);

  function saveToken() {
    adminToken.set(token.trim());
    setSaved(token.trim().length > 0);
    setMessage(token.trim() ? "Token saved in this browser." : "Token cleared.");
  }

  async function reset() {
    setBusy("reset");
    setMessage("");
    try {
      await admin.reset();
      setMessage("Demo class reset: 30 simulated students and a fresh Asha.");
      await checkHealth();
    } catch (e) {
      setMessage(e instanceof ApiError ? `Reset failed: ${e.message}` : "Reset failed: can't reach the API.");
    }
    setBusy("");
  }

  async function warm() {
    setBusy("warm");
    setMessage("");
    const plan = warmPlan();
    const list: Step[] = plan.map((p) => ({ name: p.name, state: "todo" }));
    setSteps([...list]);
    for (let i = 0; i < plan.length; i++) {
      list[i] = { ...list[i], state: "running" };
      setSteps([...list]);
      const t0 = performance.now();
      try {
        const detail = await plan[i].run();
        list[i] = { ...list[i], state: "ok", detail, ms: performance.now() - t0 };
      } catch (e) {
        list[i] = {
          ...list[i],
          state: "fail",
          detail: e instanceof ApiError ? e.message : e instanceof Error ? e.message : "failed",
          ms: performance.now() - t0,
        };
      }
      setSteps([...list]);
    }
    setMessage(list.every((x) => x.state === "ok") ? "Warm and reset. The demo starts from a clean class." : "Some steps failed; see below.");
    await checkHealth();
    setBusy("");
  }

  const vertexOk = health?.providers.vertex ?? false;

  return (
    <main className={`${s.root} ${fontVars} min-h-dvh`}>
      <div className="mx-auto flex max-w-[900px] flex-col gap-4 px-4 pb-12 pt-4">
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <Link href="/" className={`${s.hand} text-[1.6em] font-bold`}>
              GuruGraph
            </Link>
            <span className={s.muted}>Presenter</span>
          </div>
          <span className={`${s.muted} text-[0.85em]`}>Private page for the team. Nothing here is linked from the app.</span>
        </header>

        <section className={`${s.sheet} flex flex-col gap-3 p-4`} aria-label="Admin token">
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Admin token</span>
            <span className={`${s.muted} text-[0.85em]`}>Typed once, kept in this browser&apos;s storage, sent only as a header. Never put it in a URL.</span>
            <div className="flex gap-2">
              <input
                className={`${s.button} ${s.focusable} flex-1 text-base`}
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                aria-label="Admin token"
              />
              <button type="button" className={`${s.button} ${s.primary}`} onClick={saveToken}>
                Save
              </button>
            </div>
          </label>
        </section>

        <section className={`${s.sheet} flex flex-col gap-3 p-4`} aria-label="Health">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className={s.sheetTitle}>Health</h2>
            <button type="button" className={s.button} disabled={!saved} onClick={() => void checkHealth()}>
              Check again
            </button>
          </div>
          {healthError && (
            <p role="alert" style={{ color: "var(--red-pen)" }}>
              {healthError}
            </p>
          )}
          {health && (
            <ul className="grid gap-2 sm:grid-cols-2">
              <Row ok={health.ok} label="API" detail={`v${health.version}, mode ${health.demo_mode}`} />
              <Row
                ok={vertexOk}
                label="Vertex AI"
                detail={vertexOk ? `${health.vision_model} reads, ${health.text_model} writes` : "not configured"}
              />
              <Row
                ok={health.cache.llm > 0}
                label="AI cache"
                detail={`${health.cache.llm} answers, ${health.cache.lessons} lessons`}
              />
              <Row
                ok={health.demo_class.students >= 31}
                label="Class 7B"
                detail={`${health.demo_class.students} students, ${health.demo_class.real_joins} real joins`}
              />
              <Row
                ok={health.last_photo_ms.length === 0 || health.last_photo_ms[0] < 8000}
                label="Last photo reads"
                detail={health.last_photo_ms.length ? health.last_photo_ms.map((x) => `${(x / 1000).toFixed(1)} s`).join(", ") : "none since reset"}
              />
            </ul>
          )}
          {!saved && <p className={s.muted}>Save the admin token to check the API.</p>}
        </section>

        <section className={`${s.sheet} flex flex-col gap-3 p-4`} aria-label="Actions">
          <h2 className={s.sheetTitle}>Before the demo</h2>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`${s.button} ${s.primary}`} disabled={!saved || busy !== ""} onClick={() => void warm()}>
              {busy === "warm" ? "Warming…" : "Warm the demo (runs every beat, then resets)"}
            </button>
            <button type="button" className={s.button} disabled={!saved || busy !== ""} onClick={() => void reset()}>
              {busy === "reset" ? "Resetting…" : "Reset the demo class"}
            </button>
          </div>
          {message && <p aria-live="polite">{message}</p>}
          {steps.length > 0 && (
            <ol className="flex flex-col gap-1 text-[0.95em]">
              {steps.map((st) => (
                <li key={st.name} className={`${s.feedItem} ${st.state === "fail" ? s.challenge : st.state === "ok" ? s.accepted : ""}`}>
                  <span className="mr-2" aria-hidden>
                    {st.state === "ok" ? "✓" : st.state === "fail" ? "✗" : st.state === "running" ? "…" : "·"}
                  </span>
                  <strong>{st.name}</strong>
                  {st.ms !== undefined && <span className={`${s.muted} ml-2`}>{(st.ms / 1000).toFixed(1)} s</span>}
                  {st.detail && <div className={`${s.muted} mt-0.5 text-[0.9em]`}>{st.detail}</div>}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className={`${s.sheet} flex flex-col gap-3 p-4`} aria-label="Demo tabs">
          <h2 className={s.sheetTitle}>The demo tabs, in order</h2>
          <ol className="flex flex-col gap-2">
            {TABS.map((t) => (
              <li key={t.n} className="flex flex-wrap items-center gap-3">
                <a className={`${s.button} min-w-[220px]`} href={t.href} target={`gg-tab-${t.n}`} rel="noreferrer">
                  <span className={`${s.hand} text-[1.2em]`} style={{ color: "var(--red-pen)" }}>
                    {t.n}
                  </span>
                  {t.label}
                </a>
                <span className={`${s.muted} text-[0.9em]`}>{t.note}</span>
              </li>
            ))}
          </ol>
          <p className={`${s.muted} text-[0.85em]`}>
            Phone: open {SITE.url}
            {ROUTES.asha} on the demo phone before the pitch, and keep it on the join screen.
          </p>
        </section>

        <section className={`${s.sheet} flex flex-col gap-3 p-4`} aria-label="Presenter notes">
          <h2 className={s.sheetTitle}>Presenter notes</h2>
          <ul className="flex list-disc flex-col gap-1.5 pl-5">
            {NOTES.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

function Row({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className={`${s.feedItem} ${ok ? s.accepted : s.challenge} flex items-start gap-2`}>
      <span aria-hidden style={{ color: ok ? "var(--green)" : "var(--red-pen)" }}>
        {ok ? "✓" : "✗"}
      </span>
      <span>
        <strong>{label}</strong>
        <span className={`${s.muted} ml-2`}>{detail}</span>
        <span className="sr-only">{ok ? " ok" : " needs attention"}</span>
      </span>
    </li>
  );
}
