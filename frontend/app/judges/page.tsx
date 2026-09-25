import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { AllNumbers, ApiStatus, JoinQr, ProjectLinks } from "@/components/site/live";
import { ROUTES, SITE, repoFile } from "@/lib/site";

export const metadata: Metadata = {
  title: "For judges",
  description: "Check GuruGraph in 90 seconds: a guided tour of the live app, every measured number with its n and method, and how it's built.",
};

const TOUR = [
  {
    title: "Scan a notebook",
    href: ROUTES.scan,
    cta: "Open the scan screen",
    doThis: "Pick a problem and tap “Asha's page (real photo)”, or photograph your own working for any of the four problems.",
    lookFor:
      "Step 2 circled in red, the mistake named in plain words, and the arithmetic proof under it. One tap lets the teacher agree or correct it.",
  },
  {
    title: "Plan tomorrow's lesson",
    href: ROUTES.dashboard,
    cta: "Open the class dashboard",
    doThis: "On the dashboard, press “Plan tomorrow's lesson”.",
    lookFor:
      "The Coach drafts, the Analyst sends a plan back with numbers from the class, the Coach revises. Approve a plan to get its printable worksheet.",
  },
  {
    title: "Be a student",
    href: ROUTES.asha,
    cta: "Be Asha",
    doThis: "Scan the QR code below with your phone, or open Asha. Answer one question wrong, then tap “Fix this now”.",
    lookFor: "A short lesson in Kannada, two retry questions and “Gap closed”. The class meter on the dashboard moves.",
  },
  {
    title: "Read a pile of notebooks",
    href: ROUTES.pile,
    cta: "Open the notebook pile",
    doThis: "Tap “Use 6 sample notebooks”.",
    lookFor: "Six photos read six at a time into a live grid, then a summary of who got what wrong and the most common mistakes.",
  },
];

const AGENTS = [
  { name: "Examiner", job: "Picks each student's next question and grades retries exactly", engine: "Rules" },
  { name: "Diagnostician", job: "Names the mistake behind an answer or a photo of working", engine: "Answer key → rules → Gemini" },
  { name: "Curator", job: "Writes a short lesson in the student's language, picks 2 retries from the verified bank", engine: "Gemini + a script check" },
  { name: "Coach", job: "Drafts and revises tomorrow's 5-minute plan", engine: "Gemini" },
  { name: "Analyst", job: "Aggregates the class and audits every plan; its veto is binding", engine: "Rules" },
  { name: "Simulator", job: "A seeded class of 30 students answering through the same rules", engine: "Rules, 0 AI calls" },
];

const STACK = [
  { title: "Phones", lines: ["Teacher: scan + dashboard", "Student: quiz + lesson"] },
  { title: "Next.js on Cloud Run", lines: ["This site", "/backend/* proxied to the API"] },
  { title: "FastAPI on Cloud Run", lines: ["One endpoint per agent action", "Telemetry on every AI call"] },
];

const ENGINES = [
  { title: "Rules engine", lines: ["Exact fraction arithmetic", "Mastery, gaps, the Analyst's veto"] },
  {
    title: "Gemini on Vertex AI",
    lines: ["3 Flash reads photos (2.5 Flash hedges after 6 s)", "2.5 Flash writes; 2.5 Flash-Lite backs it up", "Chirp 3 HD speaks Kannada, Hindi, English"],
  },
  { title: "SQLite", lines: ["Answers, gaps, the agent feed", "Photos stay in memory and are discarded"] },
];

const RESILIENCE = [
  "Photo reads are hedged: if the first model takes more than 6 s, a second one starts and the first valid answer wins.",
  "If a photo can't be read, the teacher types the final answer and the rules take over.",
  "Every AI call in the teacher's feed shows the model, time and cost in ₹. Repeats are served from a cache and marked “cached”.",
  "The teacher confirms or corrects any diagnosis in one tap; the teacher's word replaces the AI's.",
];

function Box({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="gg-panel flex flex-1 flex-col gap-1 p-4">
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {lines.map((l) => (
        <p key={l} className="text-[13px] leading-snug text-graphite">
          {l}
        </p>
      ))}
    </div>
  );
}

function Arrow({ down = false }: { down?: boolean }) {
  return (
    <span aria-hidden className={`self-center font-hand text-[26px] text-ink-2 ${down ? "" : "md:-rotate-90"}`}>
      ↓
    </span>
  );
}

export default function JudgesPage() {
  return (
    <>
      <SiteHeader page="judges" />

      <main className="flex flex-col">
        {/* intro */}
        <section className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-12 pt-4 sm:px-8 md:pt-8">
          <p className="font-hand text-[20px] text-red-pen">for judges</p>
          <h1 className="max-w-4xl text-[clamp(38px,6vw,60px)] font-bold leading-[1.05] tracking-tight text-ink">
            Check our work in 90 seconds.
          </h1>
          <p className="max-w-3xl text-[18px] leading-relaxed text-graphite">
            Everything here is live: the same app, API and numbers we demo on stage. Every number shows its sample size
            (n) and how we measured it, and we say plainly what we haven&apos;t done yet.
          </p>
          <ApiStatus />
          <ProjectLinks />
        </section>

        {/* tour */}
        <section aria-labelledby="tour" className="border-y border-rule bg-white/70">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-8">
            <h2 id="tour" className="mb-8 text-[clamp(26px,3.6vw,34px)] font-bold tracking-tight text-ink">
              The tour: four stops, about 20 seconds each
            </h2>
            <ol className="grid gap-4 md:grid-cols-2">
              {TOUR.map((t, i) => (
                <li key={t.title} className="gg-panel flex flex-col gap-4 p-6">
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-red-pen font-hand text-[20px] font-bold text-red-pen"
                    >
                      {i + 1}
                    </span>
                    <h3 className="text-[20px] font-semibold text-ink">{t.title}</h3>
                  </div>
                  <dl className="grid gap-3 text-[15px] leading-relaxed">
                    <div>
                      <dt className="text-[13px] font-semibold uppercase tracking-[0.1em] text-graphite">Do</dt>
                      <dd className="text-ink">{t.doThis}</dd>
                    </div>
                    <div>
                      <dt className="text-[13px] font-semibold uppercase tracking-[0.1em] text-graphite">Look for</dt>
                      <dd className="text-ink">{t.lookFor}</dd>
                    </div>
                  </dl>
                  <Link href={t.href} className="gg-btn mt-auto w-full sm:w-fit">
                    {t.cta} <span aria-hidden>→</span>
                  </Link>
                </li>
              ))}
            </ol>

            <div className="gg-panel mt-6 flex flex-col items-center gap-6 p-6 sm:flex-row sm:items-center">
              <JoinQr size={148} />
              <div className="flex flex-col gap-2">
                <h3 className="text-[20px] font-semibold text-ink">Join class 7B from your phone</h3>
                <p className="max-w-xl text-[15px] leading-relaxed text-graphite">
                  Pick any nickname and a language. You&apos;ll appear on the teacher&apos;s heatmap as you answer. Only
                  one person should play Asha at a time, so on your own phone, join as yourself.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* numbers */}
        <section aria-labelledby="numbers" className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-8">
          <div className="mb-8 flex flex-col gap-2">
            <h2 id="numbers" className="text-[clamp(26px,3.6vw,34px)] font-bold tracking-tight text-ink">
              The numbers
            </h2>
            <p className="max-w-3xl text-[16px] leading-relaxed text-graphite">
              Loaded live from <code className="rounded bg-muted px-1.5 py-0.5 text-[14px]">GET /judges/summary</code>.
              The raw rows are in{" "}
              <a href={repoFile("data/evals/results.json")} target="_blank" rel="noreferrer" className="gg-link">
                data/evals/results.json
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              .
            </p>
          </div>
          <AllNumbers />
        </section>

        {/* how it's built */}
        <section aria-labelledby="built" className="border-y border-rule bg-white/70">
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-14 sm:px-8">
            <h2 id="built" className="text-[clamp(26px,3.6vw,34px)] font-bold tracking-tight text-ink">
              How it&apos;s built
            </h2>

            <figure className="flex flex-col gap-3" aria-label="Architecture">
              <div className="flex flex-col gap-3 md:flex-row md:items-stretch">
                {STACK.map((b, i) => (
                  <div key={b.title} className="flex flex-1 flex-col gap-3 md:flex-row">
                    <Box {...b} />
                    {i < STACK.length - 1 && <Arrow />}
                  </div>
                ))}
              </div>
              <Arrow down />
              <div className="flex flex-col gap-3 md:flex-row">
                {ENGINES.map((b) => (
                  <Box key={b.title} {...b} />
                ))}
              </div>
            </figure>

            <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
              <div className="gg-panel overflow-hidden">
                <table className="w-full text-left text-[14px]">
                  <caption className="px-5 pb-2 pt-5 text-left text-[16px] font-semibold text-ink">
                    Six agents: three call Gemini, three are pure rules. The Analyst can veto the Coach.
                  </caption>
                  <thead>
                    <tr className="border-b border-rule text-[13px] uppercase tracking-[0.08em] text-graphite">
                      <th scope="col" className="px-5 py-2 font-semibold">
                        Agent
                      </th>
                      <th scope="col" className="px-2 py-2 font-semibold">
                        Does
                      </th>
                      <th scope="col" className="px-5 py-2 font-semibold">
                        Engine
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {AGENTS.map((a) => (
                      <tr key={a.name} className="border-b border-rule last:border-0 align-top">
                        <th scope="row" className="px-5 py-3 font-semibold text-ink">
                          {a.name}
                        </th>
                        <td className="px-2 py-3 text-graphite">{a.job}</td>
                        <td className="px-5 py-3 text-ink">{a.engine}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="gg-panel p-6">
                <h3 className="mb-4 text-[16px] font-semibold text-ink">When something goes wrong</h3>
                <ul className="flex flex-col gap-3 text-[14px] leading-relaxed text-graphite">
                  {RESILIENCE.map((r) => (
                    <li key={r} className="flex gap-2">
                      <span aria-hidden className="text-green">
                        ✓
                      </span>
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* honesty + team */}
        <section className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-14 sm:px-8 md:grid-cols-2">
          <div className="gg-panel flex flex-col gap-3 border-l-4 border-l-red-pen p-6">
            <h2 className="text-[22px] font-bold text-ink">What we don&apos;t claim</h2>
            <ul className="flex list-disc flex-col gap-2 pl-5 text-[15px] leading-relaxed text-graphite">
              <li>No classroom trial, no users and no learning-gain data yet.</li>
              <li>The 30 students in class 7B are simulated; Asha is a demo student.</li>
              <li>Lessons in Kannada and Hindi pass an automatic script check; a native-speaker review is pending.</li>
              <li>Teacher pages have no login in this demo build.</li>
            </ul>
          </div>
          <div className="gg-panel flex flex-col gap-4 p-6">
            <h2 className="text-[22px] font-bold text-ink">Team X</h2>
            <ul className="flex flex-col gap-3 text-[15px]">
              <li>
                <span className="font-semibold text-ink">Samartha Puthraya K</span>
                <span className="text-graphite"> · backend, agents and evaluation</span>
              </li>
              <li>
                <span className="font-semibold text-ink">Rishabh Arun</span>
                <span className="text-graphite"> · frontend and design system</span>
              </li>
              <li>
                <span className="font-semibold text-ink">Risheeth S</span>
                <span className="text-graphite"> · research, evidence and pitch</span>
              </li>
            </ul>
            <p className="mt-auto flex flex-wrap gap-x-5 gap-y-2 text-[15px]">
              <a href={SITE.repo} target="_blank" rel="noreferrer" className="gg-link">
                Source code<span className="sr-only"> (opens in a new tab)</span>
              </a>
              <a href={repoFile("docs/research/EVIDENCE.md")} target="_blank" rel="noreferrer" className="gg-link">
                Evidence brief<span className="sr-only"> (opens in a new tab)</span>
              </a>
              <a href={SITE.apiDocs} target="_blank" rel="noreferrer" className="gg-link">
                API reference<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </p>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
